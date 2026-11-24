package dev.sidekick.engine

import android.content.Context
import android.util.Log
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.ExperimentalApi
import com.google.ai.edge.litertlm.ExperimentalFlags
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.MessageCallback
import com.google.ai.edge.litertlm.SpeculativeDecodingConfig
import com.google.ai.edge.litertlm.SpeculativeDecodingMode
import java.io.File

/** One candidate way to run the model: a model file plus the hardware to run it on. */
data class LlmCandidate(val modelPath: String, val backend: String)

data class LlmLoadResult(val modelPath: String, val backend: String, val initMs: Long, val failures: List<String>)

/** [scratch]: run in a separate throwaway conversation, leaving the chat and its history as they are. */
data class GenerateOptions(
  val maxTokens: Int? = null,
  val keepHistory: Boolean = false,
  val system: String? = null,
  val scratch: Boolean = false,
)

/**
 * Speed knobs a bench can try. Null means "library default". [threads], [speculative] and
 * [maxTokens] apply on the next load; [visualTokenBudget] on the next conversation; [maxImageEdge]
 * on the next photo.
 */
/** Image tokens per photo: on a Pixel 5, 140 answers in 18 s vs 28 s at the default and still reads sign text. */
const val DEFAULT_VISUAL_TOKENS = 140

data class LlmTuning(
  /** CPU backend worker threads. */
  val threads: Int? = null,
  /** Speculative decoding (multi-token prediction): "off", "on" or "adaptive". */
  val speculative: String? = null,
  /** Image tokens per photo (Gemma 4 supports e.g. 70, 140, 280, 560, 1120); fewer = faster read. */
  val visualTokenBudget: Int? = DEFAULT_VISUAL_TOKENS,
  /** Context size (prompt + answer) the KV cache is sized for. */
  val maxTokens: Int? = null,
  /** Longest photo edge handed to the model, px. */
  val maxImageEdge: Int = ModelImage.DEFAULT_MAX_EDGE,
)

data class LlmStats(
  val ttftMs: Double,
  val prefillTokens: Int,
  val prefillTokensPerSec: Double,
  val decodeTokens: Int,
  val decodeTokensPerSec: Double,
  val totalMs: Long,
)

/**
 * Wraps a single LiteRT-LM engine. Tries candidates in order (fastest hardware first) and keeps the
 * first one that initializes, so every phone gets the best backend it supports.
 */
@OptIn(ExperimentalApi::class)
class LlmEngine(private val cacheDir: String, private val nativeLibDir: String) {
  private var engine: Engine? = null
  @Volatile private var conversation: Conversation? = null
  /** The last side task's conversation; closed at the next generate (not inside its own callback). */
  @Volatile private var scratch: Conversation? = null
  /** A conversation with only the system prompt read in; fresh questions start from a clone of it. */
  private var base: Conversation? = null
  private var baseSystem: String? = null
  @Volatile var tuning = LlmTuning()
  var loaded: LlmLoadResult? = null
    private set

  @Synchronized
  fun load(candidates: List<LlmCandidate>): LlmLoadResult {
    unload()
    ExperimentalFlags.enableBenchmark = true
    val failures = mutableListOf<String>()
    for (c in candidates) {
      if (!File(c.modelPath).canRead()) {
        failures += "${c.backend}: model not found at ${c.modelPath}"
        continue
      }
      val start = System.nanoTime()
      try {
        val config =
          EngineConfig(
            modelPath = c.modelPath,
            backend = backendFor(c.backend),
            visionBackend = visionBackendFor(c.backend),
            maxNumTokens = tuning.maxTokens,
            cacheDir = cacheDir,
            speculativeDecodingConfig = speculativeConfig(),
          )
        val e = Engine(config)
        e.initialize()
        // Some backends initialize but fail on first use (e.g. GPU without a usable OpenCL), so
        // prove the backend with a one-token answer before accepting it.
        try {
          e.createConversation(ConversationConfig()).use { it.sendMessage("Hi", maxOutputToken = 1) }
        } catch (t: Throwable) {
          e.close()
          throw t
        }
        pruneModelCache(cacheDir, c.modelPath)
        engine = e
        val result = LlmLoadResult(c.modelPath, c.backend, (System.nanoTime() - start) / 1_000_000, failures)
        loaded = result
        return result
      } catch (t: Throwable) {
        Log.w(TAG, "backend ${c.backend} failed", t)
        failures += "${c.backend}: ${t.message ?: t.javaClass.simpleName}"
      }
    }
    throw IllegalStateException("No backend could load the model. ${failures.joinToString("; ")}")
  }

  /**
   * Streams the answer to [prompt] (optionally about [imagePath]) through [onText]. With
   * [keepHistory] the previous turns stay in context (chat); otherwise a fresh conversation starts.
   */
  @Synchronized
  fun generate(
    prompt: String,
    imagePath: String?,
    opts: GenerateOptions,
    onText: (String) -> Unit,
    onFinish: (LlmStats) -> Unit,
    onFail: (Throwable) -> Unit,
  ) {
    val e = engine ?: return onFail(IllegalStateException("Model not loaded"))
    // A conversation must never be closed while it is still generating: LiteRT-LM's callback
    // thread then uses freed memory and the app dies (SIGSEGV seen on the Pixel 5 when a background
    // task and a question overlapped). Stop the running answer and wait for it to end first.
    stopRunning()
    val done = java.util.concurrent.CountDownLatch(1)
    running = done
    val finish = { done.countDown() }
    closeScratch()
    val conv =
      try {
        if (opts.scratch) {
          freshConversation(e, opts.system).also { scratch = it }
        } else {
          conversation?.takeIf { opts.keepHistory }
            ?: run {
              conversation?.close()
              conversation = null
              freshConversation(e, opts.system).also { conversation = it }
            }
        }
      } catch (t: Throwable) {
        finish()
        return onFail(t)
      }
    val parts = buildList {
      if (imagePath != null) add(Content.ImageFile(ModelImage.prepare(imagePath, tuning.maxImageEdge)))
      add(Content.Text(prompt))
    }
    val start = System.nanoTime()
    try {
      conv.sendMessageAsync(
        Message.of(parts),
        object : MessageCallback {
          override fun onMessage(message: Message) {
            val text = message.toString()
            if (text.isNotEmpty()) onText(text)
          }

          override fun onDone() {
            val b = runCatching { conv.getBenchmarkInfo() }.getOrNull()
            // Free the next generate only after the callbacks have run (it may close [conv]).
            try {
              if (b == null) return onFinish(LlmStats(0.0, 0, 0.0, 0, 0.0, (System.nanoTime() - start) / 1_000_000))
              onFinish(
                LlmStats(
                  ttftMs = b.timeToFirstTokenInSecond * 1000,
                  prefillTokens = b.lastPrefillTokenCount,
                  prefillTokensPerSec = b.lastPrefillTokensPerSecond,
                  decodeTokens = b.lastDecodeTokenCount,
                  decodeTokensPerSec = b.lastDecodeTokensPerSecond,
                  totalMs = (System.nanoTime() - start) / 1_000_000,
                )
              )
            } finally {
              finish()
            }
          }

          override fun onError(throwable: Throwable) {
            try {
              onFail(throwable)
            } finally {
              finish()
            }
          }
        },
        maxOutputToken = opts.maxTokens,
      )
    } catch (t: Throwable) {
      finish()
      onFail(t)
    }
  }

  /** Signalled when the current generation has fully ended (done, failed or cancelled). */
  @Volatile private var running: java.util.concurrent.CountDownLatch? = null

  /** Cancels any generation still running and waits until LiteRT-LM has let go of it. */
  private fun stopRunning() {
    val r = running ?: return
    if (r.count == 0L) return
    cancel()
    if (!r.await(15, java.util.concurrent.TimeUnit.SECONDS)) Log.w(TAG, "previous answer did not stop in 15 s")
  }

  /**
   * Reads [system] into a base conversation now (e.g. at app start) so the first question skips it.
   * Returns false if the model isn't loaded.
   */
  fun prepare(system: String?): Boolean {
    val e = engine ?: return false
    baseFor(e, system)
    return true
  }

  /**
   * A new conversation that already has [system] read in. Cloning the prefilled base skips
   * re-reading the system prompt every question; if cloning fails, falls back to a plain new one.
   */
  private fun freshConversation(e: Engine, system: String?): Conversation {
    try {
      return baseFor(e, system).clone()
    } catch (t: Throwable) {
      Log.w(TAG, "conversation clone failed; starting fresh", t)
    }
    return e.createConversation(conversationConfig(system, prefill = false))
  }

  @Synchronized
  private fun baseFor(e: Engine, system: String?): Conversation {
    base?.takeIf { baseSystem == system && it.isAlive }?.let { return it }
    base?.close()
    base = null
    ExperimentalFlags.visualTokenBudget = tuning.visualTokenBudget
    return e.createConversation(conversationConfig(system, prefill = true)).also {
      base = it
      baseSystem = system
    }
  }

  private fun conversationConfig(system: String?, prefill: Boolean) =
    ConversationConfig(
      systemInstruction = system?.let { Contents.of(listOf(Content.Text(it))) },
      prefillPrefaceOnInit = prefill,
    )

  /** Drops the prefilled base so the next question rebuilds it with the current [tuning]. */
  @Synchronized
  fun resetBase() {
    base?.close()
    base = null
    baseSystem = null
  }

  private fun speculativeConfig(): SpeculativeDecodingConfig? =
    when (tuning.speculative) {
      "on" -> SpeculativeDecodingConfig(SpeculativeDecodingMode.ON)
      "adaptive" -> SpeculativeDecodingConfig(SpeculativeDecodingMode.ADAPTIVE)
      "off" -> SpeculativeDecodingConfig(SpeculativeDecodingMode.OFF)
      else -> null
    }

  private fun closeScratch() {
    val s = scratch ?: return
    scratch = null
    try {
      s.close()
    } catch (t: Throwable) {
      Log.w(TAG, "scratch conversation close failed", t)
    }
  }

  /** Not locked (it must reach a running answer); a conversation closed meanwhile is ignored. */
  fun cancel() {
    runCatching { conversation?.cancelProcess() }
    runCatching { scratch?.cancelProcess() }
  }

  @Synchronized
  fun unload() {
    stopRunning()
    closeScratch()
    conversation?.close()
    conversation = null
    resetBase()
    engine?.close()
    engine = null
    loaded = null
  }

  private fun backendFor(name: String): Backend =
    when (name) {
      "gpu" -> Backend.GPU()
      "npu" -> Backend.NPU(nativeLibraryDir = nativeLibDir)
      "tensor" -> Backend.GOOGLE_TENSOR()
      else -> Backend.CPU(threadCount = tuning.threads)
    }

  // The vision encoder runs on the GPU when the main model does; otherwise CPU.
  private fun visionBackendFor(name: String): Backend = if (name == "gpu") Backend.GPU() else Backend.CPU()

  companion object {
    private const val TAG = "SidekickLlm"
  }
}

/** Process-wide engines, shared by the JS module and the background listen service. */
object Engines {
  @Volatile private var llm: LlmEngine? = null

  @Synchronized
  fun llm(ctx: Context): LlmEngine =
    llm ?: LlmEngine(modelCacheDir(ctx), ctx.applicationInfo.nativeLibraryDir).also { llm = it }
}

/**
 * Where LiteRT keeps its compiled-model caches (~1 GB for Gemma). Not [Context.getCacheDir]: Android
 * purges that past a small quota, which forced a full recompile on the next load.
 */
fun modelCacheDir(ctx: Context): String =
  File(ctx.noBackupFilesDir, "litert-cache").apply { mkdirs() }.absolutePath

/** Deletes caches built for older copies of [modelPath] (LiteRT names them name_mtime_size…). */
fun pruneModelCache(dir: String, modelPath: String) {
  val model = File(modelPath)
  val current = "${model.name}_${model.lastModified() / 1000}_"
  File(dir).listFiles()?.forEach {
    if (it.name.startsWith("${model.name}_") && !it.name.startsWith(current)) it.deleteRecursively()
  }
}

private const val LAST_CANDIDATES = "llm.lastCandidates"

/** Remembers what loaded, so the background service can load the same way without JS. */
fun LlmEngine.rememberLoad(ctx: Context, candidates: List<LlmCandidate>, used: LlmLoadResult) {
  val ordered = candidates.sortedBy { if (it.backend == used.backend && it.modelPath == used.modelPath) 0 else 1 }
  ctx
    .getSharedPreferences("sidekick", Context.MODE_PRIVATE)
    .edit()
    .putString(LAST_CANDIDATES, ordered.joinToString("\n") { "${it.backend}|${it.modelPath}" })
    .apply()
}

/** Loads the model the way the app last did; false if it never has. */
fun LlmEngine.ensureLoadedFromLastRun(ctx: Context): Boolean {
  if (loaded != null) return true
  val saved =
    ctx.getSharedPreferences("sidekick", Context.MODE_PRIVATE).getString(LAST_CANDIDATES, null)
      ?: return false
  val cands =
    saved.lines().mapNotNull { l -> l.split("|", limit = 2).takeIf { it.size == 2 }?.let { LlmCandidate(it[1], it[0]) } }
  return runCatching { load(cands) }.isSuccess
}
