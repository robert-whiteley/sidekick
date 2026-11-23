package dev.sidekick.engine

import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.KeywordSpotter
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineMoonshineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
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
  val vad = "$modelsDir/silero_vad.onnx"
  private val kwsDir = "$modelsDir/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01-mobile"
  val kwsEncoder = "$kwsDir/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx"
  val kwsDecoder = "$kwsDir/decoder-epoch-12-avg-2-chunk-16-left-64.onnx"
  val kwsJoiner = "$kwsDir/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx"
  val kwsTokens = "$kwsDir/tokens.txt"
  private val asrDir = "$modelsDir/sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27"
  val asrEncoder = "$asrDir/encoder_model.ort"
  val asrDecoder = "$asrDir/decoder_model_merged.ort"
  val asrTokens = "$asrDir/tokens.txt"
  val speaker = "$modelsDir/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx"

  fun missing(): List<String> =
    listOf(vad, kwsEncoder, kwsDecoder, kwsJoiner, kwsTokens, asrEncoder, asrDecoder, asrTokens, speaker)
      .filterNot { File(it).canRead() }
}

/**
 * The speech models, loaded once per process. Everything runs on the CPU and is small (~80 MB),
 * so it can stay resident next to the LLM.
 */
class SpeechEngine(private val paths: SpeechPaths, keywordsFile: File) {
  val asr =
    OfflineRecognizer(
      null,
      OfflineRecognizerConfig(
        featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80),
        modelConfig =
          OfflineModelConfig(
            moonshine =
              OfflineMoonshineModelConfig(encoder = paths.asrEncoder, mergedDecoder = paths.asrDecoder),
            tokens = paths.asrTokens,
            numThreads = 2,
          ),
      ),
    )

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

  /** Voice fingerprint for clustering speakers; null if the clip is too short. */
  fun voiceprint(samples: FloatArray): FloatArray? {
    val s = speaker.createStream()
    try {
      s.acceptWaveform(samples, SAMPLE_RATE)
      s.inputFinished()
      return if (speaker.isReady(s)) speaker.compute(s) else null
    } finally {
      s.release()
    }
  }

  companion object {
    const val VAD_WINDOW = 512

    @Volatile private var instance: SpeechEngine? = null

    /** Loads the models on first use. [keywords] is written to the file sherpa requires. */
    @Synchronized
    fun get(modelsDir: String, cacheDir: File, keywords: String): SpeechEngine {
      instance?.let { return it }
      val paths = SpeechPaths(modelsDir)
      val missing = paths.missing()
      check(missing.isEmpty()) { "Speech models missing: ${missing.joinToString { File(it).name }}" }
      val kwFile = File(cacheDir, "keywords.txt").apply { writeText(keywords + "\n") }
      return SpeechEngine(paths, kwFile).also { instance = it }
    }
  }
}
