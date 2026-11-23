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
 * an AudioTrack while it is still being generated. The system voice is used while the model isn't
 * downloaded, if it fails to load, or if this phone turns out too slow for it.
 *
 * [Turns] is kept in step so the mic knows when Sidekick is talking (barge-in, echo) and when the
 * follow-up window is open.
 */
object Voice {
  private const val TAG = "SidekickVoice"
  const val DIR = "sherpa-onnx-pocket-tts-int8-2026-01-26"
  /** A short sentence whose first sound takes longer than this means the phone is too slow. */
  private const val MAX_FIRST_SOUND_MS = 2500L
  private const val DUCK_VOLUME = 0.25f

  val turns = Turns()

  private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "sidekick-voice") }
  /** Bumped by [stop]; work queued under an older generation is skipped. */
  private val generation = AtomicInteger(0)
  private val pending = AtomicInteger(0)
  @Volatile private var endRequested = false

  @Volatile private var tts: OfflineTts? = null
  @Volatile private var ttsFailed = false
  @Volatile private var tooSlow = false
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

  /** Which voice answers: "pocket" (downloaded and fast enough) or "system". */
  fun engineName(ctx: Context): String = if (!tooSlow && !ttsFailed && modelReady(ctx)) "pocket" else "system"

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
    worker.execute {
      try {
        if (gen != generation.get()) return@execute
        if (!speakNeural(app, text, gen)) speakSystem(app, text)
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

  /** Speaks [text] with Pocket TTS; false if the system voice should say it instead. */
  private fun speakNeural(ctx: Context, text: String, gen: Int): Boolean {
    if (tooSlow) return false
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
    if (firstChunkMs > MAX_FIRST_SOUND_MS && audioSec < 3f) {
      Log.w(TAG, "Pocket TTS too slow on this phone; switching to the system voice")
      tooSlow = true
    }
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
