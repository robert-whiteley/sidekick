package dev.sidekick.engine

/**
 * ONNX Runtime for models sherpa-onnx has no wrapper for (photo OCR), through a small JNI
 * bridge (src/main/cpp/ort_shim.cpp) to the libonnxruntime.so sherpa-onnx already ships.
 */
object OrtShim {
  init {
    System.loadLibrary("onnxruntime")
    System.loadLibrary("sidekick_ort")
  }

  /** Loads a model; returns a handle. */
  @JvmStatic external fun create(path: String, threads: Int): Long

  /**
   * First input -> first output, float32. [outShape] receives the rank, then the dimensions.
   */
  @JvmStatic external fun run(handle: Long, input: FloatArray, shape: LongArray, outShape: LongArray): FloatArray

  @JvmStatic external fun release(handle: Long)
}
