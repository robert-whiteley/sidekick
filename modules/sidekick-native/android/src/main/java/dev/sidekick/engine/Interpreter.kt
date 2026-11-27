package dev.sidekick.engine

import android.content.Context
import android.content.Intent
import android.speech.tts.TextToSpeech
import android.util.Log
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineTransducerModelConfig
import com.k2fsa.sherpa.onnx.OfflineWhisperModelConfig
import java.io.File
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Speech-to-text for the interpreter (src/engine/interpreter.ts): the other person's language is
 * heard by Parakeet v3 (25 European languages) or Whisper small (told the language), loaded on
 * demand and released when the conversation ends. When Listen already runs Parakeet v3, that
 * copy is used instead of loading a second one.
 */
object InterpretAsr {
  private const val TAG = "SidekickInterpret"
  private var rec: OfflineRecognizer? = null
  private var key: String? = null

  /** [kind] "parakeet" or "whisper"; [dir] the model folder; [language] ISO 639-1 (Whisper). */
  @Synchronized
  fun transcribe(ctx: Context, kind: String, dir: String, language: String, audio: FloatArray): String {
    val models = Speech.modelsDir(ctx)
    if (kind == "parakeet" && AsrChoice.dir(models) == dir) {
      return Speech.engine(ctx, MicLoop.wakeKeywords).transcribe(audio)
    }
    val k = "$kind|$dir|$language"
    if (key != k) {
      unload()
      rec = build(models, kind, dir, language)
      key = k
    }
    val r = rec!!
    val s = r.createStream()
    try {
      s.acceptWaveform(audio, SAMPLE_RATE)
      r.decode(s)
      return clean(r.getResult(s).text)
    } finally {
      s.release()
    }
  }

  /** Whisper sometimes adds bracketed sound tags ("[Music]", "(laughs)"); they aren't speech. */
  private fun clean(t: String): String =
    t.replace(Regex("\\[[^\\]]*\\]|\\([^)]*\\)"), " ").replace(Regex("\\s+"), " ").trim()

  private fun build(models: String, kind: String, dir: String, language: String): OfflineRecognizer {
    val d = "$models/$dir"
    val model =
      if (kind == "whisper") {
        val size = dir.removePrefix("sherpa-onnx-whisper-")
        OfflineModelConfig(
          whisper =
            OfflineWhisperModelConfig(
              encoder = "$d/$size-encoder.int8.onnx",
              decoder = "$d/$size-decoder.int8.onnx",
              language = language,
              task = "transcribe",
            ),
          tokens = "$d/$size-tokens.txt",
          modelType = "whisper",
          numThreads = 4,
        )
      } else {
        OfflineModelConfig(
          transducer =
            OfflineTransducerModelConfig(
              encoder = "$d/encoder.int8.onnx",
              decoder = "$d/decoder.int8.onnx",
              joiner = "$d/joiner.int8.onnx",
            ),
          modelType = "nemo_transducer",
          tokens = "$d/tokens.txt",
          numThreads = 4,
        )
      }
    check(File(model.tokens).canRead()) { "Speech model missing: $dir" }
    Log.i(TAG, "loading $kind $dir $language")
    return OfflineRecognizer(
      null,
      OfflineRecognizerConfig(featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80), modelConfig = model),
    )
  }

  @Synchronized
  fun unload() {
    rec?.release()
    rec = null
    key = null
  }
}

/** Whether the phone has an offline voice for a language, and where to get one. */
object InterpretVoices {
  /**
   * "ready" (an installed offline voice), "download" (the engine has one but it isn't on the
   * phone yet), "missing" (no voice for this language), or "none" (no speech engine at all).
   */
  fun status(ctx: Context, tag: String): String {
    val locale = Locale.forLanguageTag(tag)
    val ready = CountDownLatch(1)
    var ok = false
    var tts: TextToSpeech? = null
    tts = TextToSpeech(ctx.applicationContext) { s ->
      ok = s == TextToSpeech.SUCCESS
      ready.countDown()
    }
    try {
      if (!ready.await(4, TimeUnit.SECONDS) || !ok) return "none"
      val t = tts
      val same = t.voices.orEmpty().filter { it.locale.language == locale.language }
      val offline = same.filter { !it.isNetworkConnectionRequired }
      if (offline.any { TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in it.features.orEmpty() }) return "ready"
      if (same.isNotEmpty()) return "download"
      return when (t.isLanguageAvailable(locale)) {
        TextToSpeech.LANG_MISSING_DATA -> "download"
        TextToSpeech.LANG_NOT_SUPPORTED -> "missing"
        else -> "ready"
      }
    } catch (e: Throwable) {
      Log.w("SidekickInterpret", "voice check failed", e)
      return "none"
    } finally {
      tts.shutdown()
    }
  }

  /** Opens the speech engine's voice download screen. */
  fun openInstall(ctx: Context): Boolean =
    runCatching {
        ctx.startActivity(
          Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        true
      }
      .getOrDefault(false)
}
