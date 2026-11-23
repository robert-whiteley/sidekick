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
import java.io.File

/** One candidate way to run the model: a model file plus the hardware to run it on. */
data class LlmCandidate(val modelPath: String, val backend: String)

data class LlmLoadResult(val modelPath: String, val backend: String, val initMs: Long, val failures: List<String>)

data class GenerateOptions(val maxTokens: Int? = null, val keepHistory: Boolean = false, val system: String? = null)

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
  private var conversation: Conversation? = null
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
            cacheDir = cacheDir,
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
  fun generate(
    prompt: String,
    imagePath: String?,
    opts: GenerateOptions,
    onText: (String) -> Unit,
    onFinish: (LlmStats) -> Unit,
    onFail: (Throwable) -> Unit,
  ) {
    val e = engine ?: return onFail(IllegalStateException("Model not loaded"))
    val conv =
      conversation?.takeIf { opts.keepHistory }
        ?: run {
          conversation?.close()
          val system = opts.system?.let { Contents.of(listOf(Content.Text(it))) }
          e.createConversation(ConversationConfig(systemInstruction = system)).also { conversation = it }
        }
    val parts = buildList {
      if (imagePath != null) add(Content.ImageFile(imagePath))
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
            val b = conv.getBenchmarkInfo()
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
          }

          override fun onError(throwable: Throwable) = onFail(throwable)
        },
        maxOutputToken = opts.maxTokens,
      )
    } catch (t: Throwable) {
      onFail(t)
    }
  }

  fun cancel() {
    conversation?.cancelProcess()
  }

  @Synchronized
  fun unload() {
    conversation?.close()
    conversation = null
    engine?.close()
    engine = null
    loaded = null
  }

  private fun backendFor(name: String): Backend =
    when (name) {
      "gpu" -> Backend.GPU()
      "npu" -> Backend.NPU(nativeLibraryDir = nativeLibDir)
      "tensor" -> Backend.GOOGLE_TENSOR()
      else -> Backend.CPU()
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
    llm ?: LlmEngine(ctx.cacheDir.absolutePath, ctx.applicationInfo.nativeLibraryDir).also { llm = it }
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
