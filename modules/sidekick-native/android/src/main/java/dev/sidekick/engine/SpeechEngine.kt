package dev.sidekick.engine

import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.KeywordSpotter
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineTransducerModelConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineStream
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractor
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import java.io.File

const val SAMPLE_RATE = 16000

/** Where each speech model lives inside the models directory (matches src/engine/models.ts). */
class SpeechPaths(modelsDir: String) {
  val vad = "$modelsDir/silero_vad_v6.2.3.onnx"
  private val kwsDir = "$modelsDir/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"
  val kwsEncoder = "$kwsDir/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx"
  val kwsDecoder = "$kwsDir/decoder-epoch-12-avg-2-chunk-16-left-64.onnx"
  val kwsJoiner = "$kwsDir/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx"
  val kwsTokens = "$kwsDir/tokens.txt"
  /** The chosen speech-to-text folder (language-logic.ts), else English Parakeet v2. */
  private val asrDir = "$modelsDir/${AsrChoice.dir(modelsDir)}"
  val asrEncoder = "$asrDir/encoder.int8.onnx"
  val asrDecoder = "$asrDir/decoder.int8.onnx"
  val asrJoiner = "$asrDir/joiner.int8.onnx"
  val asrTokens = "$asrDir/tokens.txt"
  val speaker = "$modelsDir/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx"

  fun missing(): List<String> =
    listOf(vad, kwsEncoder, kwsDecoder, kwsJoiner, kwsTokens, asrEncoder, asrDecoder, asrJoiner, asrTokens, speaker)
      .filterNot { File(it).canRead() }
}

/**
 * Which Parakeet build transcribes: v2 (English) or v3 (25 European languages). Saved as a file
 * next to the models so the listen service uses it with the app closed. Falls back to v2 when the
 * chosen folder isn't fully there.
 */
object AsrChoice {
  const val V2 = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"
  const val V3 = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"
  private const val FILE = "asr-model.txt"
  private val PARTS = listOf("encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt")

  fun complete(modelsDir: String, dir: String): Boolean = PARTS.all { File("$modelsDir/$dir/$it").canRead() }

  fun dir(modelsDir: String): String {
    val chosen = runCatching { File(modelsDir, FILE).readText().trim() }.getOrNull()
    return if (chosen == V3 && complete(modelsDir, V3)) V3 else V2
  }

  /** Saves [dir]; false if it isn't one of the builds or isn't downloaded. */
  fun save(modelsDir: String, dir: String): Boolean {
    if (dir != V2 && dir != V3) return false
    if (!complete(modelsDir, dir)) return false
    File(modelsDir, FILE).writeText(dir)
    return true
  }
}

/**
 * The speech models, loaded once per process. Everything runs on the CPU and is small (~80 MB),
 * so it can stay resident next to the LLM.
 */
class SpeechEngine(private var paths: SpeechPaths, keywordsFile: File) {
  /** Speech-to-text; swapped by [setAsrThreads], so only touch it under the engine's lock. */
  private var asr = newAsr(asrThreads)
  private var asrThreadsInUse = asrThreads

  private fun newAsr(threads: Int) =
    OfflineRecognizer(
      null,
      OfflineRecognizerConfig(
        featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80),
        modelConfig =
          OfflineModelConfig(
            transducer =
              OfflineTransducerModelConfig(
                encoder = paths.asrEncoder,
                decoder = paths.asrDecoder,
                joiner = paths.asrJoiner,
              ),
            modelType = "nemo_transducer",
            tokens = paths.asrTokens,
            numThreads = threads,
          ),
      ),
    )

  /** Switches to the speech-to-text build in [modelsDir]'s saved choice (waits for a running one). */
  @Synchronized
  fun reloadAsr(modelsDir: String) {
    val next = SpeechPaths(modelsDir)
    if (next.asrEncoder == paths.asrEncoder) return
    val old = paths
    paths = next
    try {
      val asrNext = newAsr(asrThreadsInUse)
      asr.release()
      asr = asrNext
    } catch (e: Throwable) {
      paths = old
      throw e
    }
  }

  /** Reloads speech-to-text with [threads] CPU threads (waits for a running transcription). */
  @Synchronized
  fun setAsrThreads(threads: Int) {
    if (threads == asrThreadsInUse) return
    val next = newAsr(threads)
    asr.release()
    asr = next
    asrThreadsInUse = threads
  }

  val speaker =
    SpeakerEmbeddingExtractor(null, SpeakerEmbeddingExtractorConfig(model = paths.speaker, numThreads = 1))

  private val kws =
    KeywordSpotter(
      null,
      KeywordSpotterConfig(
        featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80),
        modelConfig =
          OnlineModelConfig(
            transducer =
              OnlineTransducerModelConfig(
                encoder = paths.kwsEncoder,
                decoder = paths.kwsDecoder,
                joiner = paths.kwsJoiner,
              ),
            tokens = paths.kwsTokens,
            modelType = "zipformer2",
            numThreads = 1,
          ),
        keywordsFile = keywordsFile.absolutePath,
      ),
    )

  fun newVad(): Vad =
    Vad(
      null,
      VadModelConfig(
        sileroVadModelConfig =
          SileroVadModelConfig(
            model = paths.vad,
            threshold = 0.5f,
            minSilenceDuration = 0.6f,
            minSpeechDuration = 0.3f,
            windowSize = VAD_WINDOW,
            maxSpeechDuration = 25f,
          ),
        sampleRate = SAMPLE_RATE,
        numThreads = 1,
      ),
    )

  /** A wake-word stream for [keywords] (sherpa format, one per line). */
  fun newWakeStream(keywords: String): OnlineStream = kws.createStream(keywords.replace("\n", "/"))

  /** Feeds audio to the wake-word spotter; returns true when the wake word was heard. */
  fun wakeHeard(stream: OnlineStream, samples: FloatArray): Boolean {
    stream.acceptWaveform(samples, SAMPLE_RATE)
    var heard = false
    while (kws.isReady(stream)) {
      kws.decode(stream)
      if (kws.getResult(stream).keyword.isNotEmpty()) {
        heard = true
        kws.reset(stream)
      }
    }
    return heard
  }

  @Synchronized
  fun transcribe(samples: FloatArray): String {
    val s = asr.createStream()
    try {
      s.acceptWaveform(samples, SAMPLE_RATE)
      asr.decode(s)
      return asr.getResult(s).text.trim()
    } finally {
      s.release()
    }
  }

  private val speakerLock = Any()

  /** Voice fingerprint for clustering speakers; null if the clip is too short. */
  fun voiceprint(samples: FloatArray): FloatArray? =
    synchronized(speakerLock) { // the speech worker and the barge-in check both call it
      val s = speaker.createStream()
      try {
        s.acceptWaveform(samples, SAMPLE_RATE)
        s.inputFinished()
        if (speaker.isReady(s)) speaker.compute(s) else null
      } finally {
        s.release()
      }
    }

  companion object {
    const val VAD_WINDOW = 512

    /** Parakeet CPU threads; set from JS (speed bench) before or after loading. */
    @Volatile var asrThreads = 4

    @Volatile private var instance: SpeechEngine? = null

    /** Sets the Parakeet thread count (1-8); reloads it now if the models are already loaded. */
    fun configureAsrThreads(threads: Int) {
      asrThreads = threads.coerceIn(1, 8)
      instance?.setAsrThreads(asrThreads)
    }

    /** Saves the speech-to-text build ([AsrChoice]) and switches to it now if loaded. */
    fun configureAsrModel(modelsDir: String, dir: String): Boolean {
      if (!AsrChoice.save(modelsDir, dir)) return false
      instance?.reloadAsr(modelsDir)
      return true
    }

    /** Loads the models on first use. [keywords] is written to the file sherpa requires. */
    @Synchronized
    fun get(modelsDir: String, cacheDir: File, keywords: String): SpeechEngine {
      instance?.let { return it }
      val paths = SpeechPaths(modelsDir)
      val missing = paths.missing()
      check(missing.isEmpty()) { "Speech models missing: ${missing.joinToString { File(it).name }}" }
      val kwFile = File(cacheDir, "keywords.txt").apply { writeText(keywords + "\n") }
      return SpeechEngine(paths, kwFile).also {
        instance = it
        it.setAsrThreads(asrThreads) // in case it changed while loading
      }
    }
  }
}
