package dev.sidekick.engine

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.util.Log
import android.os.Process
import java.io.File
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionHandler
import java.util.concurrent.ThreadFactory
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import kotlin.math.log10
import kotlin.math.sqrt
import org.json.JSONArray
import org.json.JSONObject

/**
 * The one microphone reader in the app. Runs while something needs it: background listening
 * (wake word + ambient transcripts) and/or push-to-talk. The mic thread only runs the wake word and
 * the VAD; heavy work (speech-to-text, then the voiceprint) happens on one worker thread behind a
 * bounded queue, so the mic thread never waits and audio is never dropped.
 */
object MicLoop {
  private const val TAG = "SidekickMic"
  /** After the wake word, how long to wait for the question to start. */
  private const val QUESTION_WINDOW_MS = 8000L

  @Volatile var ambient = false
    private set
  @Volatile private var ptt: MutableList<FloatArray>? = null
  @Volatile private var paused = false
  @Volatile private var running = false
  private var thread: Thread? = null
  /** True while the mic loop holds the microphone (the system recogniser then answers "busy"). */
  val busy: Boolean
    get() = running && thread?.isAlive == true
  /** Segments waiting for speech-to-text. If it ever falls this far behind, the oldest is dropped. */
  private const val MAX_QUEUED_SEGMENTS = 8
  private val worker =
    ThreadPoolExecutor(
      1,
      1,
      0L,
      TimeUnit.MILLISECONDS,
      ArrayBlockingQueue(MAX_QUEUED_SEGMENTS),
      ThreadFactory { r -> Thread(r, "sidekick-speech") },
      RejectedExecutionHandler { r, pool ->
        if (!pool.isShutdown) {
          Log.w(TAG, "speech worker behind; dropping the oldest segment")
          pool.queue.poll()
          pool.execute(r)
        }
      },
    )

  /** Shorter segments are skipped (the VAD's own minimum is ~0.41 s, so this only drops blips). */
  private const val MIN_TRANSCRIBE_SEC = 0.4f
  /**
   * Below this level a segment is digital near-silence. Parakeet still transcribes normal speech
   * at -78 dBFS (measured), so a higher "quiet" cut would drop real, distant speech.
   */
  private const val MIN_TRANSCRIBE_DBFS = -80.0
  /** Voiceprints of shorter clips are unreliable (CAM++ EER 13% on noisy 1.5 s clips). */
  private const val MIN_VOICEPRINT_SEC = 1.5f
  /** Short replies that still get a voiceprint: consent needs to know which voice said yes. */
  private val AGREEMENT =
    Regex(
      "^(yes|yeah|yep|yup|sure|of course|ok|okay|fine|go ahead|no problem|absolutely|that's fine|that is fine|i don't mind|no i don't mind|not at all)\\b",
      RegexOption.IGNORE_CASE,
    )

  /** Settings pushed from JS. */
  // "Hey Sidekick" or plain "Sidekick" (one keyword per line; gigaspeech KWS tokens).
  @Volatile var wakeKeywords = "▁HE Y ▁ SIDE K IC K :2.0 #0.25 @HEY_SIDEKICK\n▁ SIDE K IC K :2.0 #0.25 @SIDEKICK"
  @Volatile var wakePhrase = "hey sidekick"
  @Volatile var recordAmbient = true
  /** Instructions only: transcribe nothing but wake-word questions and follow-ups. */
  @Volatile var commandsOnly = false

  /** (event name, payload) — set by the module so JS hears about wakes and questions. */
  @Volatile var listener: ((String, Map<String, Any?>) -> Unit)? = null
  /** Called with a spoken question when JS isn't there to answer it (app in background). */
  @Volatile var nativeAnswerer: ((question: String, followUp: Boolean) -> Unit)? = null
  @Volatile var jsAnswers = false

  private var awaitingQuestionUntil = 0L

  /** Why ambient listening is auto-paused (quiet hours, a paused place), or null. */
  @Volatile var pauseReason: String? = null
    private set
  /** Told when [pauseReason] changes (the service updates its notification). */
  @Volatile var onPauseChange: ((String?) -> Unit)? = null
  private const val PAUSE_CHECK_MS = 10_000L

  fun startAmbient(ctx: Context) {
    ambient = true
    ensureRunning(ctx)
  }

  fun stopAmbient() {
    ambient = false
    pauseReason = null
    stopIfIdle()
  }

  fun startPtt(ctx: Context) {
    ptt = mutableListOf()
    ensureRunning(ctx)
  }

  /** Ends push-to-talk and returns the recorded audio. */
  fun stopPtt(): FloatArray {
    val chunks = ptt ?: return FloatArray(0)
    ptt = null
    stopIfIdle()
    return concat(chunks)
  }

  /** Mute processing while Sidekick itself is talking, so it doesn't transcribe its own voice. */
  fun setPaused(p: Boolean) {
    paused = p
  }

  /** Keeps the mic (and speech models) on for a reply while Sidekick speaks and just after. */
  fun startConversation(ctx: Context) = ensureRunning(ctx)

  private fun needed(now: Long) = ambient || ptt != null || Voice.turns.active(now)

  private fun stopIfIdle() {
    if (!needed(System.currentTimeMillis())) running = false
  }

  /**
   * During a conversation the mic uses the call-style input with the platform echo canceller, so
   * Sidekick's own voice is mostly removed before the VAD hears it. Otherwise the plain
   * speech-recognition input (no call processing, best for transcripts).
   */
  @SuppressLint("MissingPermission")
  private fun openRecorder(conversation: Boolean): Pair<AudioRecord, AcousticEchoCanceler?> {
    val minBuf =
      AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
    val rec =
      AudioRecord(
        if (conversation) MediaRecorder.AudioSource.VOICE_COMMUNICATION else MediaRecorder.AudioSource.VOICE_RECOGNITION,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_FLOAT,
        maxOf(minBuf, SAMPLE_RATE * 4),
      )
    val aec =
      if (conversation && AcousticEchoCanceler.isAvailable()) {
        runCatching { AcousticEchoCanceler.create(rec.audioSessionId)?.apply { enabled = true } }.getOrNull()
      } else null
    rec.startRecording()
    return rec to aec
  }

  @SuppressLint("MissingPermission") // JS asks for RECORD_AUDIO before starting either mode.
  @Synchronized
  private fun ensureRunning(ctx: Context) {
    if (running && thread?.isAlive == true) return
    running = true
    val app = ctx.applicationContext
    thread =
      Thread({ loop(app) }, "sidekick-mic").apply { start() }
  }

  @SuppressLint("MissingPermission")
  private fun loop(ctx: Context) {
    val turns = Voice.turns
    var conversation = turns.active(System.currentTimeMillis())
    var (rec, aec) = openRecorder(conversation)
    val engine =
      if (ambient || conversation) runCatching { Speech.engine(ctx, wakeKeywords) }.onFailure { emitError(it) }.getOrNull()
      else null
    // Raised only after the models are loaded: ONNX Runtime's worker threads are created at load
    // and inherit the creating thread's priority, and speech-to-text must not compete with the mic.
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val vad = engine?.newVad()
    // Separate VAD for talking over Sidekick: per-chunk speech probability, stricter threshold.
    val bargeVad = engine?.newVad()
    val barge = BargeIn()
    var wasTalking = false
    var bargedIn = false
    var wake = engine?.newWakeStream(wakeKeywords)
    var keywordsInUse = wakeKeywords
    val chunk = FloatArray(SpeechEngine.VAD_WINDOW)
    var samplesSeen = 0L
    val startedAt = System.currentTimeMillis()
    var pauseCheckedAt = 0L
    try {
      while (running) {
        val n = rec.read(chunk, 0, chunk.size, AudioRecord.READ_BLOCKING)
        if (n <= 0) continue
        val samples = if (n == chunk.size) chunk.copyOf() else chunk.copyOf(n)
        samplesSeen += n
        ptt?.add(samples)
        val nowMs = System.currentTimeMillis()
        val inConversation = turns.active(nowMs)
        if (!needed(nowMs)) break
        if (inConversation != conversation && ptt == null) {
          conversation = inConversation
          runCatching { rec.stop() }
          aec?.release()
          rec.release()
          openRecorder(conversation).let { rec = it.first; aec = it.second }
          continue
        }
        val talking = Voice.speaking()
        if (talking && !wasTalking) {
          barge.reset()
          bargeVad?.reset()
          bargedIn = false
        }
        wasTalking = talking
        if (talking && bargeVad != null && ptt == null) {
          when (barge.feed(bargeVad.compute(samples))) {
            BargeIn.Action.DUCK -> Voice.duck(true)
            BargeIn.Action.STOP -> {
              // The user is talking over Sidekick: stop the voice and the answer; what they say
              // becomes the next question, with the conversation kept.
              Log.i(TAG, "barge-in")
              bargedIn = true
              Voice.stop()
              turns.bargedIn(nowMs)
              runCatching { Engines.llm(ctx).cancel() }
              emit("onBargeIn", emptyMap())
            }
            BargeIn.Action.NONE -> if (!barge.ducked()) Voice.duck(false)
          }
        }
        if (ambient && nowMs - pauseCheckedAt >= PAUSE_CHECK_MS) {
          pauseCheckedAt = nowMs
          val reason = Places.pauseReason()
          if (reason != pauseReason) {
            pauseReason = reason
            if (reason != null) vad?.reset()
            runCatching { onPauseChange?.invoke(reason) }
            emit("onListenPause", mapOf("reason" to reason))
          }
        }
        // Auto-paused: nothing is heard or kept (push-to-talk still works).
        if (pauseReason != null && ptt == null) continue
        if (engine == null || vad == null || ptt != null) continue
        if (!ambient && !inConversation) continue
        if (paused && !inConversation) continue
        if (keywordsInUse != wakeKeywords) {
          wake?.release()
          wake = engine.newWakeStream(wakeKeywords)
          keywordsInUse = wakeKeywords
        }
        // Not while Sidekick talks: its own voice could say the wake word.
        if (wake != null && !talking && engine.wakeHeard(wake, samples)) {
          awaitingQuestionUntil = System.currentTimeMillis() + QUESTION_WINDOW_MS
          emit("onWake", emptyMap())
        }
        vad.acceptWaveform(samples)
        while (!vad.empty()) {
          val seg = vad.front()
          vad.pop()
          val atMs = startedAt + (seg.start * 1000 / SAMPLE_RATE)
          val audio = seg.samples
          // Ended while Sidekick was still talking and never confirmed as barge-in: its own echo.
          if (talking && !bargedIn) continue
          worker.execute { handleSegment(ctx, engine, audio, atMs) }
        }
      }
    } catch (t: Throwable) {
      Log.e(TAG, "mic loop failed", t)
      emitError(t)
    } finally {
      runCatching { rec.stop() }
      aec?.release()
      rec.release()
      bargeVad?.release()
      wake?.release()
      vad?.release()
      running = false
    }
  }

  private fun handleSegment(ctx: Context, engine: SpeechEngine, audio: FloatArray, atMs: Long) {
    try {
      if (!worthTranscribing(audio)) return
      if (commandsOnly) {
        val t = System.currentTimeMillis()
        if (t > awaitingQuestionUntil && !Voice.turns.isFollowUp(atMs, t)) return
      }
      val raw = engine.transcribe(audio)
      if (raw.isBlank()) return
      val voice =
        if (audio.size >= MIN_VOICEPRINT_SEC * SAMPLE_RATE || AGREEMENT.containsMatchIn(raw.trim())) {
          engine.voiceprint(audio)
        } else null
      val now = System.currentTimeMillis()
      val followUp = Voice.turns.isFollowUp(atMs, now)
      // Sidekick's own voice that got past the echo canceller.
      if (followUp && Voice.turns.isEcho(raw)) return
      val (isQuestion, text) =
        when {
          now <= awaitingQuestionUntil || startsWithWake(raw) -> true to stripWake(raw)
          followUp -> true to raw
          else -> false to raw
        }
      if (isQuestion && text.isBlank()) {
        // Only the wake word so far; the question comes in the next segment.
        awaitingQuestionUntil = now + QUESTION_WINDOW_MS
        return
      }
      if (isQuestion) {
        awaitingQuestionUntil = 0
        Voice.turns.questionTaken()
      }
      val entry =
        JSONObject()
          .put("kind", if (isQuestion) "question" else "speech")
          .put("at", atMs)
          .put("durationMs", audio.size * 1000L / SAMPLE_RATE)
          .put("text", text)
          .put("owner", isQuestion)
          .put("voice", voice?.let { v -> JSONArray().apply { v.forEach { put(it.toDouble()) } } })
      Places.tag(entry)
      if (isQuestion || (recordAmbient && ambient)) Journal.append(ctx, entry)
      emit("onTranscript", mapOf("kind" to entry.getString("kind"), "text" to text, "at" to atMs.toDouble()))
      if (isQuestion) {
        if (jsAnswers && listener != null) emit("onQuestion", mapOf("text" to text, "followUp" to followUp))
        else nativeAnswerer?.invoke(text, followUp)
      }
    } catch (t: Throwable) {
      Log.e(TAG, "segment failed", t)
    }
  }

  private fun worthTranscribing(audio: FloatArray): Boolean {
    if (audio.size < MIN_TRANSCRIBE_SEC * SAMPLE_RATE) return false
    var sum = 0.0
    for (x in audio) sum += x * x
    return 20 * log10(sqrt(sum / audio.size) + 1e-12) >= MIN_TRANSCRIBE_DBFS
  }

  private fun normalize(s: String) = s.lowercase().replace(Regex("[^a-z0-9 ]"), " ").trim().replace(Regex("\\s+"), " ")

  // The greeting is optional: "Sidekick, …" counts as well as "Hey Sidekick, …".
  private fun startsWithWake(raw: String): Boolean =
    normalize(raw).let { it.startsWith(normalize(wakePhrase)) || it.startsWith(normalize(wakePhrase).split(" ").last()) }

  /** "Hey Sidekick, what's this?" -> "what's this?" (also drops a mis-heard first word or two). */
  private fun stripWake(raw: String): String {
    val words = raw.trim().split(Regex("\\s+"))
    val wakeWords = normalize(wakePhrase).split(" ")
    val last = wakeWords.last()
    val idx = words.take(wakeWords.size + 2).indexOfFirst { normalize(it) == last }
    val rest = if (idx >= 0) words.drop(idx + 1) else words
    return rest.joinToString(" ").trimStart(',', '.', ' ', '!', '?')
  }

  private fun emit(name: String, body: Map<String, Any?>) {
    runCatching { listener?.invoke(name, body) }
  }

  private fun emitError(t: Throwable) = emit("onListenError", mapOf("message" to (t.message ?: t.toString())))

  private fun concat(chunks: List<FloatArray>): FloatArray {
    val out = FloatArray(chunks.sumOf { it.size })
    var i = 0
    for (c in chunks) {
      c.copyInto(out, i)
      i += c.size
    }
    return out
  }
}

/** Process-wide access to the speech models. */
object Speech {
  fun modelsDir(ctx: Context): String = "${(ctx.getExternalFilesDir(null) ?: ctx.filesDir).absolutePath}/models"

  fun engine(ctx: Context, keywords: String): SpeechEngine =
    SpeechEngine.get(modelsDir(ctx), ctx.cacheDir, keywords)
}

/**
 * Append-only log of what was heard, written natively so nothing is lost while the app's UI isn't
 * running. JS drains it into the encrypted memory database.
 */
object Journal {
  private fun file(ctx: Context) = File(ctx.filesDir, "data/journal.jsonl").apply { parentFile?.mkdirs() }

  @Synchronized
  fun append(ctx: Context, entry: JSONObject) {
    file(ctx).appendText(entry.toString() + "\n")
  }

  /** Returns everything logged since the last drain and clears it. */
  @Synchronized
  fun drain(ctx: Context): List<String> {
    val f = file(ctx)
    if (!f.exists()) return emptyList()
    val lines = f.readLines().filter { it.isNotBlank() }
    f.delete()
    return lines
  }
}
