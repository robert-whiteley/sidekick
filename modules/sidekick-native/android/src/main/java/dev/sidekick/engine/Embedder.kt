package dev.sidekick.engine

import android.app.ActivityManager
import android.content.Context
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.EmbeddingEngine
import com.google.ai.edge.litertlm.EmbeddingEngineConfig
import com.google.ai.edge.litertlm.EmbeddingOptions
import com.google.ai.edge.litertlm.InputData
import java.io.File

/**
 * EmbeddingGemma 2 (text + vision, 440M) on LiteRT-LM: turns text and photos into vectors in one
 * space for memory search. Loaded on demand; the vision encoder loads on the first photo. On phones under 6 GB RAM the chat model is unloaded first (and loading the
 * chat model unloads this), so the two big models are never resident together there.
 */
object Embedder {
  @Volatile private var engine: EmbeddingEngine? = null
  @Volatile private var path: String? = null

  @Synchronized
  fun embed(ctx: Context, modelPath: String, texts: List<String>, dims: Int): List<FloatArray> {
    val e = load(ctx, modelPath)
    val opts = EmbeddingOptions(normalize = true, outputSize = dims)
    return texts.map { e.computeEmbedding(listOf(InputData.Text(it)), opts).embedding }
  }

  /** Photo vectors (same space as [embed]); each photo is shrunk to [IMAGE_EDGE] px first. */
  @Synchronized
  fun embedImages(ctx: Context, modelPath: String, photoPaths: List<String>, dims: Int): List<FloatArray> {
    val e = load(ctx, modelPath)
    val opts = EmbeddingOptions(normalize = true, outputSize = dims)
    return photoPaths.map { p ->
      val small = ModelImage.prepare(p, IMAGE_EDGE, "embed-input.jpg")
      e.computeEmbedding(listOf(InputData.Image(File(small).readBytes())), opts).embedding
    }
  }

  /** The vision encoder rescales to its own patch grid; 512 px keeps decoding cheap. */
  private const val IMAGE_EDGE = 512

  @Synchronized
  fun unload() {
    engine?.close()
    engine = null
    path = null
  }

  /** Called before the chat model loads: on small or memory-short phones the two never stay together. */
  @Synchronized
  fun unloadIfLowRam(ctx: Context) {
    if (mustBeAlone(ctx)) unload()
  }

  /**
   * True when the chat model and the embedder must not be loaded together: a phone under 6 GB, or
   * Android reporting low memory right now (other apps, a long camera run).
   */
  fun mustBeAlone(ctx: Context): Boolean {
    val mem = ActivityManager.MemoryInfo()
    (ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(mem)
    return Residency.alone(mem.totalMem / (1024 * 1024), mem.lowMemory)
  }

  private fun load(ctx: Context, modelPath: String): EmbeddingEngine {
    engine?.takeIf { path == modelPath }?.let { return it }
    unload()
    Ocr.unload() // small, but frees room for a big model; reloads on the next photo
    if (mustBeAlone(ctx)) Engines.llm(ctx).unload()
    val e = EmbeddingEngine(EmbeddingEngineConfig(modelPath = modelPath, backend = Backend.CPU(), visionBackend = Backend.CPU(), cacheDir = modelCacheDir(ctx)))
    e.initialize()
    pruneModelCache(modelCacheDir(ctx), modelPath)
    engine = e
    path = modelPath
    return e
  }

}

/** The residency rule, kept pure for tests. */
object Residency {
  const val SMALL_PHONE_MB = 6 * 1024L
  fun alone(totalRamMb: Long, lowMemory: Boolean): Boolean = lowMemory || totalRamMb < SMALL_PHONE_MB
}
