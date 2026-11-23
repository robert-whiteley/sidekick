package dev.sidekick.engine

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import java.io.File
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

/**
 * The one microphone reader in the app. Runs while something needs it: background listening
 * (wake word + ambient transcripts) and/or push-to-talk. Heavy work (speech-to-text, voiceprints)
 * happens on a worker thread so audio is never dropped.
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
  private val worker = Executors.newSingleThreadExecutor()

  /** Settings pushed from JS. */
  @Volatile var wakeKeywords = "▁HE Y ▁ SIDE K IC K :2.0 #0.25 @HEY_SIDEKICK"
  @Volatile var wakePhrase = "hey sidekick"
  @Volatile var recordAmbient = true

  /** (event name, payload) — set by the module so JS hears about wakes and questions. */
  @Volatile var listener: ((String, Map<String, Any?>) -> Unit)? = null
  /** Called with a spoken question when JS isn't there to answer it (app in background). */
  @Volatile var nativeAnswerer: ((String) -> Unit)? = null
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

  private fun stopIfIdle() {
    if (!ambient && ptt == null) running = false
  }

  @SuppressLint("MissingPermission") // JS asks for RECORD_AUDIO before starting either mode.
  @Synchronized
  private fun ensureRunning(ctx: Context) {
    if (running && thread?.isAlive == true) return
    running = true
    val app = ctx.applicationContext
    thread =
      Thread({ loop(app) }, "sidekick-mic").apply {
        priority = Thread.MAX_PRIORITY
        start()
      }
  }

  @SuppressLint("MissingPermission")
  private fun loop(ctx: Context) {
    val minBuf =
      AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
    val rec =
      AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_FLOAT,
        maxOf(minBuf, SAMPLE_RATE * 4),
      )
    val engine =
      if (ambient) runCatching { Speech.engine(ctx, wakeKeywords) }.onFailure { emitError(it) }.getOrNull()
      else null
    val vad = engine?.newVad()
    var wake = engine?.newWakeStream(wakeKeywords)
    var keywordsInUse = wakeKeywords
    val chunk = FloatArray(SpeechEngine.VAD_WINDOW)
    var samplesSeen = 0L
    val startedAt = System.currentTimeMillis()
    var pauseCheckedAt = 0L
    try {
      rec.startRecording()
      while (running) {
        val n = rec.read(chunk, 0, chunk.size, AudioRecord.READ_BLOCKING)
        if (n <= 0) continue
        val samples = if (n == chunk.size) chunk.copyOf() else chunk.copyOf(n)
        samplesSeen += n
        ptt?.add(samples)
        val nowMs = System.currentTimeMillis()
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
        if (!ambient || paused || engine == null || vad == null || ptt != null) continue
        if (keywordsInUse != wakeKeywords) {
          wake?.release()
          wake = engine.newWakeStream(wakeKeywords)
          keywordsInUse = wakeKeywords
        }
        if (wake != null && engine.wakeHeard(wake, samples)) {
          awaitingQuestionUntil = System.currentTimeMillis() + QUESTION_WINDOW_MS
          emit("onWake", emptyMap())
        }
        vad.acceptWaveform(samples)
        while (!vad.empty()) {
          val seg = vad.front()
          vad.pop()
          val atMs = startedAt + (seg.start * 1000 / SAMPLE_RATE)
          val audio = seg.samples
          worker.execute { handleSegment(ctx, engine, audio, atMs) }
        }
      }
    } catch (t: Throwable) {
      Log.e(TAG, "mic loop failed", t)
      emitError(t)
    } finally {
      runCatching { rec.stop() }
      rec.release()
      wake?.release()
      vad?.release()
      running = false
    }
  }

  private fun handleSegment(ctx: Context, engine: SpeechEngine, audio: FloatArray, atMs: Long) {
    try {
      val raw = engine.transcribe(audio)
      if (raw.isBlank()) return
      val voice = engine.voiceprint(audio)
      val now = System.currentTimeMillis()
      val (isQuestion, text) =
        when {
          now <= awaitingQuestionUntil || startsWithWake(raw) -> true to stripWake(raw)
          else -> false to raw
        }
      if (isQuestion && text.isBlank()) {
        // Only the wake word so far; the question comes in the next segment.
        awaitingQuestionUntil = now + QUESTION_WINDOW_MS
        return
      }
      if (isQuestion) awaitingQuestionUntil = 0
      val entry =
        JSONObject()
          .put("kind", if (isQuestion) "question" else "speech")
          .put("at", atMs)
          .put("durationMs", audio.size * 1000L / SAMPLE_RATE)
          .put("text", text)
          .put("owner", isQuestion)
          .put("voice", voice?.let { v -> JSONArray().apply { v.forEach { put(it.toDouble()) } } })
      Places.tag(entry)
      if (isQuestion || recordAmbient) Journal.append(ctx, entry)
      emit("onTranscript", mapOf("kind" to entry.getString("kind"), "text" to text, "at" to atMs.toDouble()))
      if (isQuestion) {
        if (jsAnswers && listener != null) emit("onQuestion", mapOf("text" to text))
        else nativeAnswerer?.invoke(text)
      }
    } catch (t: Throwable) {
      Log.e(TAG, "segment failed", t)
    }
  }

  private fun normalize(s: String) = s.lowercase().replace(Regex("[^a-z0-9 ]"), " ").trim().replace(Regex("\\s+"), " ")

  private fun startsWithWake(raw: String): Boolean = normalize(raw).startsWith(normalize(wakePhrase))

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
