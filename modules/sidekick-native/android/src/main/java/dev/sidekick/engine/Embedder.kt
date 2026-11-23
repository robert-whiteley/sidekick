package dev.sidekick.engine

import android.app.ActivityManager
import android.content.Context
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.EmbeddingEngine
import com.google.ai.edge.litertlm.EmbeddingEngineConfig
import com.google.ai.edge.litertlm.EmbeddingOptions
import com.google.ai.edge.litertlm.InputData

/**
 * EmbeddingGemma 2 (text, 270M) on LiteRT-LM: turns text into vectors for memory search.
 * Loaded on demand. On phones under 6 GB RAM the chat model is unloaded first, so the two big
 * models are never resident together there.
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

  @Synchronized
  fun unload() {
    engine?.close()
    engine = null
    path = null
  }

  private fun load(ctx: Context, modelPath: String): EmbeddingEngine {
    engine?.takeIf { path == modelPath }?.let { return it }
    unload()
    if (totalRamMb(ctx) < 6 * 1024) Engines.llm(ctx).unload()
    val e = EmbeddingEngine(EmbeddingEngineConfig(modelPath = modelPath, backend = Backend.CPU(), cacheDir = ctx.cacheDir.absolutePath))
    e.initialize()
    engine = e
    path = modelPath
    return e
  }

  private fun totalRamMb(ctx: Context): Long {
    val mem = ActivityManager.MemoryInfo()
    (ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(mem)
    return mem.totalMem / (1024 * 1024)
  }
}
