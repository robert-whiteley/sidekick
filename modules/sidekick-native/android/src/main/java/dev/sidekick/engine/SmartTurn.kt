package dev.sidekick.engine

import java.io.File

/**
 * Smart Turn v3.2 (pipecat-ai, BSD-2-Clause): from the sound of the last ≤8 s of speech, has the
 * speaker finished their turn? Runs on the ORT bridge (OrtShim). The fp32 export (upstream calls
 * it "gpu"; it runs on the CPU) is used: the int8 one swung by up to 0.44 on 1e-5 input noise and
 * cut off nearly twice as many unfinished sentences in our test (docs/decisions/0006).
 */
class SmartTurn private constructor(private val handle: Long) {
  /** Probability that the turn is complete. */
  @Synchronized
  fun completeProbability(audio: FloatArray): Float =
    OrtShim.run(handle, WhisperMel.features(audio), SHAPE, LongArray(4))[0]

  companion object {
    /** Same name as src/engine/models.ts (MODEL_FILES.smartTurn). */
    const val FILE = "smart-turn-v3.2-gpu.onnx"
    /**
     * Above this the turn is treated as finished. Laptop test (TTS clips): 0.9 ends 65% of finished
     * questions early and cuts off 13% of unfinished ones; 0.8 gave 70% but 23%.
     */
    const val COMPLETE = 0.9f
    private val SHAPE = longArrayOf(1, WhisperMel.MELS.toLong(), WhisperMel.FRAMES.toLong())

    @Volatile private var instance: SmartTurn? = null

    /** Loads the model once; null while it isn't downloaded. Throws if it fails to load. */
    @Synchronized
    fun get(modelsDir: String): SmartTurn? {
      instance?.let { return it }
      val f = File(modelsDir, FILE)
      if (!f.canRead()) return null
      return SmartTurn(OrtShim.create(f.absolutePath, 2)).also { instance = it }
    }
  }
}
