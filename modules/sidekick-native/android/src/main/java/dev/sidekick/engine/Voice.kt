package dev.sidekick.engine

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import com.k2fsa.sherpa.onnx.GenerationConfig
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsPocketModelConfig
import java.io.File
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Sidekick's spoken voice, shared by the app and the background service. Sentences are queued as
 * the answer streams in; each is synthesised with Kyutai Pocket TTS (sherpa-onnx) and streamed to
 * an AudioTrack while it is still being generated.
 *
 * One voice per phone, never switching mid-use: Pocket is timed once in the background (after it
 * is downloaded) and kept only if its first sound comes within [VoiceChoice.MAX_FIRST_SOUND_MS];
 * otherwise, and until that is decided, the system voice speaks. The owner can force either.
 *
 * [Turns] is kept in step so the mic knows when Sidekick is talking (barge-in, echo) and when the
 * follow-up window is open.
 */
object Voice {
  private const val TAG = "SidekickVoice"
  const val DIR = "sherpa-onnx-pocket-tts-int8-2026-01-26"
  private const val PREFS = "sidekick"
  private const val KEY_CHOICE = "voice.choice"
  private const val KEY_MEASURED = "voice.measuredMs"
  private const val KEY_OVERRIDE = "voice.override"
  private const val TEST_SENTENCE = "Sure, here is what I found."
  private const val DUCK_VOLUME = 0.25f

  val turns = Turns()

  private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "sidekick-voice") }
  /** Bumped by [stop]; work queued under an older generation is skipped. */
  private val generation = AtomicInteger(0)
  private val pending = AtomicInteger(0)
  @Volatile private var endRequested = false

  @Volatile private var tts: OfflineTts? = null
  @Volatile private var ttsFailed = false
  @Volatile private var deciding = false
  @Volatile private var decideLater: Context? = null
  /** The voice of the answer being spoken, fixed when its first sentence is queued. */
  @Volatile private var answerGen = -1
  @Volatile private var answerEngine = "system"
  private var reference: FloatArray? = null
  private var referenceRate = 24000
  @Volatile private var track: AudioTrack? = null
  @Volatile private var volume = 1f

  private var system: TextToSpeech? = null
  @Volatile private var systemReady = false
  private val systemPending = AtomicInteger(0)

  /** Told when Sidekick finishes an answer (the follow-up window opens) or is stopped. */
  @Volatile var onIdle: (() -> Unit)? = null

  fun speaking(): Boolean = pending.get() > 0 || systemPending.get() > 0

  fun modelReady(ctx: Context): Boolean = File("${Speech.modelsDir(ctx)}/$DIR/lm_main.int8.onnx").canRead()

  data class Info(val choice: String?, val measuredMs: Long?, val override: String, val active: String)

  private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** What was decided for this phone ("pocket" / "system", null until measured), and what speaks now. */
  fun info(ctx: Context): Info {
    val p = prefs(ctx)
    val measured = p.getLong(KEY_MEASURED, -1L).takeIf { it >= 0 }
    return Info(p.getString(KEY_CHOICE, null), measured, p.getString(KEY_OVERRIDE, "auto") ?: "auto", engineName(ctx))
  }

  /** The owner's choice in Settings: "auto" (recommended), "pocket" or "system". */
  fun setOverride(ctx: Context, choice: String) {
    val c = if (choice in VoiceChoice.OVERRIDES) choice else "auto"
    prefs(ctx).edit().putString(KEY_OVERRIDE, c).apply()
    decideSoon(ctx)
  }

  /** Which voice answers now: "pocket" or "system". */
  fun engineName(ctx: Context): String {
    val p = prefs(ctx)
    return VoiceChoice.active(
      override = p.getString(KEY_OVERRIDE, "auto") ?: "auto",
      decided = p.getString(KEY_CHOICE, null),
      pocketUsable = !ttsFailed && modelReady(ctx),
    )
  }

  /**
   * Times Pocket's first sound once, in the background, when it is downloaded and not yet decided.
   * Runs on the voice thread, so it never overlaps speech.
   */
  fun decideSoon(ctx: Context) {
    val app = ctx.applicationContext
    if (deciding || prefs(app).getString(KEY_CHOICE, null) != null || !modelReady(app)) return
    deciding = true
    worker.execute {
      try {
        val ms = measureFirstSound(app)
        val choice = VoiceChoice.decide(ms)
        prefs(app).edit().putString(KEY_CHOICE, choice).putLong(KEY_MEASURED, ms ?: -1L).apply()
        Log.i(TAG, "voice for this phone: $choice (Pocket first sound ${ms ?: "failed"} ms)")
        if (choice == "system") releaseTts()
      } catch (t: Throwable) {
        Log.w(TAG, "voice timing failed", t)
      } finally {
        deciding = false
      }
    }
  }

  /** Best first-sound time of two silent runs (the first includes warm-up); null if Pocket fails. */
  private fun measureFirstSound(ctx: Context): Long? {
    val engine = loadTts(ctx) ?: return null
    val cfg =
      GenerationConfig().apply {
        referenceAudio = reference
        referenceSampleRate = referenceRate
      }
    var best: Long? = null
    repeat(2) {
      val start = System.nanoTime()
      var first = -1L
      engine.generateWithConfigAndCallback(
        TEST_SENTENCE,
        cfg,
        TtsChunks {
          if (first < 0) first = (System.nanoTime() - start) / 1_000_000
          0 // first chunk is enough: stop generating
        },
      )
      if (first >= 0) best = minOf(best ?: first, first)
    }
    return best
  }

  private fun releaseTts() {
    val t = tts ?: return
    tts = null
    runCatching { t.release() }
  }

  /** Starts an answer; pass the result to [say] so a stopped answer can't speak again. */
  fun begin(): Int = generation.get()

  /** Queues one sentence of the answer started with [begin] (dropped if it was stopped since). */
  fun say(ctx: Context, sentence: String, answer: Int = generation.get()) {
    val text = sentence.replace(Regex("[*_`#>]+"), "").replace(Regex("\\[(.*?)\\]\\(.*?\\)"), "$1").trim()
    val gen = answer
    if (text.isEmpty() || gen != generation.get()) return
    val app = ctx.applicationContext
    endRequested = false
    pending.incrementAndGet()
    turns.speaking(text, System.currentTimeMillis())
    MicLoop.startConversation(app)
    // The voice is chosen once per answer: it never changes between its sentences.
    if (answerGen != gen) {
      answerGen = gen
      answerEngine = engineName(app)
      // Not now (it would hold up this answer): once it has been spoken.
      if (answerEngine == "system") decideLater = app
    }
    val engineForAnswer = answerEngine
    worker.execute {
      try {
        if (gen != generation.get()) return@execute
        if (engineForAnswer != "pocket" || !speakNeural(app, text, gen)) speakSystem(app, text)
      } catch (t: Throwable) {
        Log.w(TAG, "speak failed", t)
      } finally {
        if (pending.decrementAndGet() == 0) maybeIdle()
      }
    }
  }

  /** The answer is complete: when the queue drains, the follow-up window opens. */
  fun end(answer: Int = generation.get()) {
    if (answer != generation.get()) return
    endRequested = true
    if (!speaking()) maybeIdle()
  }

  /** Stops talking now (barge-in or the Stop button). */
  fun stop() {
    generation.incrementAndGet()
    endRequested = true
    track?.let {
      runCatching {
        it.pause()
        it.flush()
      }
    }
    system?.stop()
    systemPending.set(0)
    volume = 1f
    turns.finished(System.currentTimeMillis())
    onIdle?.invoke()
  }

  /** Turns the voice down while the user might be starting to talk over it. */
  fun duck(on: Boolean) {
    volume = if (on) DUCK_VOLUME else 1f
    track?.let { runCatching { it.setVolume(volume) } }
    if (on) Log.d(TAG, "ducked")
  }

  private fun maybeIdle() {
    if (!endRequested || speaking()) return
    turns.finished(System.currentTimeMillis())
    onIdle?.invoke()
    decideLater?.let {
      decideLater = null
      decideSoon(it)
    }
  }

  // --- Neural voice (Pocket TTS) ---

  private fun loadTts(ctx: Context): OfflineTts? {
    tts?.let { return it }
    if (ttsFailed || !modelReady(ctx)) return null
    return try {
      val d = "${Speech.modelsDir(ctx)}/$DIR"
      val cfg =
        OfflineTtsConfig(
          model =
            OfflineTtsModelConfig(
              pocket =
                OfflineTtsPocketModelConfig(
                  lmFlow = "$d/lm_flow.int8.onnx",
                  lmMain = "$d/lm_main.int8.onnx",
                  encoder = "$d/encoder.onnx",
                  decoder = "$d/decoder.int8.onnx",
                  textConditioner = "$d/text_conditioner.onnx",
                  vocabJson = "$d/vocab.json",
                  tokenScoresJson = "$d/token_scores.json",
                ),
              numThreads = 2,
            ),
        )
      val ref = Wav.readMono(File("$d/test_wavs/bria.wav"))
      reference = ref.first
      referenceRate = ref.second
      OfflineTts(null, cfg).also { tts = it }
    } catch (t: Throwable) {
      Log.w(TAG, "Pocket TTS failed to load; using the system voice", t)
      ttsFailed = true
      null
    }
  }

  /** Speaks [text] with Pocket TTS; false if it failed to load (the system voice says it). */
  private fun speakNeural(ctx: Context, text: String, gen: Int): Boolean {
    val engine = loadTts(ctx) ?: return false
    val out = ensureTrack(engine.sampleRate())
    val cfg =
      GenerationConfig().apply {
        referenceAudio = reference
        referenceSampleRate = referenceRate
      }
    // Left over from a stopped answer: never play it.
    if (out.playState != AudioTrack.PLAYSTATE_PLAYING) out.flush()
    val start = System.nanoTime()
    var firstChunkMs = -1L
    val audio =
      engine.generateWithConfigAndCallback(
        text,
        cfg,
        TtsChunks { chunk ->
          if (gen != generation.get()) return@TtsChunks 0 // stopped: end generation
          if (firstChunkMs < 0) firstChunkMs = (System.nanoTime() - start) / 1_000_000
          if (out.playState != AudioTrack.PLAYSTATE_PLAYING) out.play()
          out.write(chunk, 0, chunk.size, AudioTrack.WRITE_BLOCKING)
          1
        },
      )
    if (gen != generation.get()) return true
    // Wall time includes waiting for playback (blocking writes), so the speed signal is how long
    // the first sound took.
    val audioSec = audio.samples.size.toFloat() / audio.sampleRate
    Log.i(TAG, "pocket: ${"%.2f".format(audioSec)} s audio, first sound $firstChunkMs ms")
    if (pending.get() <= 1) drain(out)
    return true
  }

  private fun ensureTrack(rate: Int): AudioTrack {
    track?.takeIf { it.sampleRate == rate }?.let { return it }
    track?.release()
    val min = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT)
    val t =
      AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
            .setSampleRate(rate)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build()
        )
        // ~250 ms: small, so stopping is near-instant and little is left to flush.
        .setBufferSizeInBytes(maxOf(min, rate / 4 * 4))
        .setTransferMode(AudioTrack.MODE_STREAM)
        .build()
    t.setVolume(volume)
    dev.sidekick.engine.usb.AudioRoutes.applyOutput(t) // headphones / chosen speaker
    track = t
    return t
  }

  /** Waits until everything written has been heard (or [stop] was called). */
  private fun drain(t: AudioTrack) {
    val gen = generation.get()
    val deadline = System.currentTimeMillis() + 2000
    var last = -1
    while (gen == generation.get() && System.currentTimeMillis() < deadline) {
      val head = t.playbackHeadPosition
      if (head == last) break // nothing more is playing
      last = head
      Thread.sleep(60)
    }
  }

  // --- System voice (fallback) ---

  private fun speakSystem(ctx: Context, text: String) {
    val t = systemTts(ctx) ?: return
    systemPending.incrementAndGet()
    val params = Bundle().apply { putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume) }
    t.speak(text, TextToSpeech.QUEUE_ADD, params, "s${System.nanoTime()}")
  }

  @Synchronized
  private fun systemTts(ctx: Context): TextToSpeech? {
    system?.let { if (systemReady) return it }
    if (system == null) {
      val ready = java.util.concurrent.CountDownLatch(1)
      system =
        TextToSpeech(ctx) { status ->
          systemReady = status == TextToSpeech.SUCCESS
          ready.countDown()
        }
      ready.await(3, java.util.concurrent.TimeUnit.SECONDS)
      system?.language = Locale.getDefault()
      system?.setOnUtteranceProgressListener(
        object : UtteranceProgressListener() {
          override fun onStart(id: String?) {}

          override fun onDone(id: String?) = systemDone()

          @Deprecated("Deprecated in Java")
          override fun onError(id: String?) = systemDone()

          override fun onStop(id: String?, interrupted: Boolean) = systemDone()
        }
      )
    }
    return system.takeIf { systemReady }
  }

  private fun systemDone() {
    if (systemPending.get() > 0 && systemPending.decrementAndGet() == 0) maybeIdle()
  }
}

/**
 * sherpa-onnx's native code calls `invoke([F)Ljava/lang/Integer;` on the chunk callback by name. A
 * plain lambda is rewritten by R8 in release builds (the app aborted on the first spoken answer),
 * so this named class is kept as-is (consumer-rules.pro).
 */
class TtsChunks(private val onChunk: (FloatArray) -> Int) : (FloatArray) -> Int {
  override fun invoke(samples: FloatArray): Int = onChunk(samples)
}

/** The one-voice-per-phone rule. Pure; tested. */
object VoiceChoice {
  /** Pocket is kept only if a short sentence's first sound comes within this. */
  const val MAX_FIRST_SOUND_MS = 1000L
  val OVERRIDES = setOf("auto", "pocket", "system")

  /** From the timing run: null (Pocket failed) or too slow means the system voice. */
  fun decide(firstSoundMs: Long?): String =
    if (firstSoundMs != null && firstSoundMs <= MAX_FIRST_SOUND_MS) "pocket" else "system"

  /** The voice that speaks: the owner's override, else the decision; system until decided. */
  fun active(override: String, decided: String?, pocketUsable: Boolean): String {
    val want = if (override == "pocket" || override == "system") override else decided ?: "system"
    return if (want == "pocket" && pocketUsable) "pocket" else "system"
  }
}
