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
import com.google.ai.edge.litertlm.ThinkingConfig
import java.io.File

/** One candidate way to run the model: a model file plus the hardware to run it on. */
data class LlmCandidate(val modelPath: String, val backend: String)

data class LlmLoadResult(val modelPath: String, val backend: String, val initMs: Long, val failures: List<String>)

/**
 * [scratch]: run in a separate throwaway conversation, leaving the chat and its history as they are.
 * [undoable]: keep a copy of the chat from before this turn, so [LlmEngine.undoLast] can drop it.
 * [offRecord]: use the separate "Off the record" chat; the main chat is left as it is. The next main
 *   chat turn closes it (leaving the mode returns to the main chat).
 */
data class GenerateOptions(
  val maxTokens: Int? = null,
  val keepHistory: Boolean = false,
  val system: String? = null,
  val scratch: Boolean = false,
  val undoable: Boolean = false,
  val offRecord: Boolean = false,
  /**
   * Gemma's thinking mode for this turn: null leaves the library default (off for Gemma 4), 0 turns
   * it off, -1 turns it on with no limit, a positive number turns it on with that many thinking
   * tokens at most. Thoughts never
   * reach [onText] or the chat history (see [LlmEngine.load]).
   */
  val thinkingBudget: Int? = null,
  /**
   * With [scratch]: keep [system] read in for next time (one of the kept bases, see
   * [LlmEngine.bases]), for short side passes asked every question, like the request sorter.
   */
  val cacheSystem: Boolean = false,
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
  /** From the request to the first answer text (thoughts excluded), ms; 0 if none. */
  val firstTextMs: Long = 0,
  /** Characters of thinking the model wrote before answering (0 with thinking off). */
  val thoughtChars: Int = 0,
)

/**
 * Wraps a single LiteRT-LM engine. Tries candidates in order (fastest hardware first) and keeps the
 * first one that initializes, so every phone gets the best backend it supports.
 */
@OptIn(ExperimentalApi::class)
class LlmEngine(private val cacheDir: String, private val nativeLibDir: String) {
  private var engine: Engine? = null
  @Volatile private var conversation: Conversation? = null
  /** The "Off the record" chat, kept apart so nothing said there reaches the main chat. */
  @Volatile private var offRecord: Conversation? = null
  /** Whether [before] is a copy of [offRecord] (else of [conversation]). */
  @Volatile private var beforeOffRecord = false
  /** The last side task's conversation; closed at the next generate (not inside its own callback). */
  @Volatile private var scratch: Conversation? = null
  /** The chat as it was before the last undoable turn (see [undoLast]); dropped at the next chat turn. */
  @Volatile private var before: Conversation? = null
  /** A conversation with only the system prompt read in; fresh questions start from a clone of it. */
  // Up to [MAX_BASES] system prompts stay read in (the chat's, and the request sorter's in
  // decide-logic.ts), most recently used kept, so switching between them re-reads neither.
  private val bases = LinkedHashMap<String, Conversation>(4, 0.75f, true)
  @Volatile var tuning = LlmTuning()
  var loaded: LlmLoadResult? = null
    private set

  @Synchronized
  fun load(candidates: List<LlmCandidate>): LlmLoadResult {
    unload()
    ExperimentalFlags.enableBenchmark = true
    // Thinking (when a turn asks for it) stays out of the chat's memory: only the answer is kept.
    ExperimentalFlags.filterChannelContentFromKvCache = true
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
    chatRunning = !opts.scratch
    val finish = { done.countDown() }
    closeScratch()
    // Gemma's thinking switch is part of the system turn, so a conversation whose system prompt
    // was already read (a clone of a prefilled base) ignores a per-message ThinkingConfig: a turn
    // with thinking on starts its own conversation with thinking set from the start.
    val thinking = opts.thinkingBudget?.takeIf { it != 0 }?.let { ThinkingConfig(enableThinking = true, thinkingTokenBudget = it) }
    val conv =
      try {
        if (opts.scratch) {
          freshConversation(e, opts.system, keepBase = opts.cacheSystem, thinking = thinking).also { scratch = it }
        } else if (opts.offRecord) {
          (
            offRecord?.takeIf { opts.keepHistory }
              ?: run {
                closeOffRecord()
                freshConversation(e, opts.system, thinking = thinking).also { offRecord = it }
              }
          ).also { chat -> keepUndoCopy(chat, opts.undoable, offRecordChat = true) }
        } else {
          // Back in the main chat: the off-the-record one is over.
          closeOffRecord()
          (
            conversation?.takeIf { opts.keepHistory }
              ?: run {
                dispose(conversation, "chat")
                conversation = null
                freshConversation(e, opts.system, thinking = thinking).also { conversation = it }
              }
          ).also { chat -> keepUndoCopy(chat, opts.undoable, offRecordChat = false) }
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
    var firstTextMs = 0L
    var thoughtChars = 0
    try {
      conv.sendMessageAsync(
        Message.of(parts),
        object : MessageCallback {
          override fun onMessage(message: Message) {
            message.channels["thought"]?.let { thoughtChars += it.length }
            val text = message.toString()
            if (text.isNotEmpty()) {
              if (firstTextMs == 0L) firstTextMs = (System.nanoTime() - start) / 1_000_000
              onText(text)
            }
          }

          override fun onDone() {
            val b = runCatching { conv.getBenchmarkInfo() }.getOrNull()
            // Free the next generate only after the callbacks have run (it may close [conv]).
            try {
              val totalMs = (System.nanoTime() - start) / 1_000_000
              if (b == null) return onFinish(LlmStats(0.0, 0, 0.0, 0, 0.0, totalMs, firstTextMs, thoughtChars))
              onFinish(
                LlmStats(
                  ttftMs = b.timeToFirstTokenInSecond * 1000,
                  prefillTokens = b.lastPrefillTokenCount,
                  prefillTokensPerSec = b.lastPrefillTokensPerSecond,
                  decodeTokens = b.lastDecodeTokenCount,
                  decodeTokensPerSec = b.lastDecodeTokensPerSecond,
                  totalMs = totalMs,
                  firstTextMs = firstTextMs,
                  thoughtChars = thoughtChars,
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
        thinkingConfig = opts.thinkingBudget?.let { ThinkingConfig(enableThinking = it != 0, thinkingTokenBudget = if (it == 0) 0 else it) },
      )
    } catch (t: Throwable) {
      finish()
      onFail(t)
    }
  }

  /** Signalled when the current generation has fully ended (done, failed or cancelled). */
  @Volatile private var running: java.util.concurrent.CountDownLatch? = null
  /** Whether the current generation runs in the chat (not a scratch conversation). */
  @Volatile private var chatRunning = false

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

  private fun keepUndoCopy(chat: Conversation, undoable: Boolean, offRecordChat: Boolean) {
    closeBefore()
    if (!undoable) return
    before = runCatching { chat.clone() }.onFailure { Log.w(TAG, "chat clone failed", it) }.getOrNull()
    beforeOffRecord = offRecordChat
  }

  private fun closeOffRecord() {
    val o = offRecord ?: return
    offRecord = null
    if (beforeOffRecord) closeBefore()
    dispose(o, "off-the-record chat")
  }

  /**
   * A new conversation that already has [system] read in. Cloning the prefilled base skips
   * re-reading the system prompt every question; if cloning fails, falls back to a plain new one.
   * With [keepBase] false (side tasks with their own prompts) the chat's prefilled base is reused
   * only if it matches, and never replaced, so the next chat question still starts instantly.
   */
  private fun freshConversation(
    e: Engine,
    system: String?,
    keepBase: Boolean = true,
    thinking: ThinkingConfig? = null,
  ): Conversation {
    if (thinking != null) {
      ExperimentalFlags.visualTokenBudget = tuning.visualTokenBudget
      return e.createConversation(conversationConfig(system, prefill = false, thinking = thinking))
    }
    try {
      if (keepBase || bases[system.orEmpty()]?.isAlive == true) return baseFor(e, system).clone()
      ExperimentalFlags.visualTokenBudget = tuning.visualTokenBudget
      return e.createConversation(conversationConfig(system, prefill = false))
    } catch (t: Throwable) {
      Log.w(TAG, "conversation clone failed; starting fresh", t)
    }
    return e.createConversation(conversationConfig(system, prefill = false))
  }

  @Synchronized
  private fun baseFor(e: Engine, system: String?): Conversation {
    val key = system.orEmpty()
    bases[key]?.let { if (it.isAlive) return it else bases.remove(key)?.close() }
    while (bases.size >= MAX_BASES) {
      val oldest = bases.keys.first()
      runCatching { bases.remove(oldest)?.close() }
    }
    ExperimentalFlags.visualTokenBudget = tuning.visualTokenBudget
    return e.createConversation(conversationConfig(system, prefill = true)).also { bases[key] = it }
  }

  private fun conversationConfig(system: String?, prefill: Boolean, thinking: ThinkingConfig? = null) =
    ConversationConfig(
      systemInstruction = system?.let { Contents.of(listOf(Content.Text(it))) },
      prefillPrefaceOnInit = prefill,
      thinkingConfig = thinking,
    )

  /** Drops the prefilled base so the next question rebuilds it with the current [tuning]. */
  @Synchronized
  fun resetBase() {
    bases.values.forEach { runCatching { it.close() } }
    bases.clear()
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
    dispose(s, "scratch conversation")
  }

  private fun closeBefore() {
    val b = before ?: return
    before = null
    runCatching { b.close() }.onFailure { Log.w(TAG, "undo copy close failed", it) }
  }

  /**
   * Drops the last undoable turn (e.g. the model's "LOOKUP" reply) from the chat, so a follow-up
   * never sees it. Returns false when there is nothing to undo.
   */
  @Synchronized
  fun undoLast(): Boolean {
    // Never close the chat mid-answer (see generate); a background pass in its scratch chat is fine.
    if (chatRunning && (running?.count ?: 0L) != 0L) return false
    val b = before ?: return false
    before = null
    if (beforeOffRecord) {
      dispose(offRecord, "off-the-record chat")
      offRecord = b
    } else {
      dispose(conversation, "chat")
      conversation = b
    }
    return true
  }

  /**
   * Not under the engine's lock (it must reach a running answer), only under [convLock], which
   * every close of these conversations also takes: cancelling one that another thread had just
   * closed crashed the app natively (SIGSEGV in cancelProcess, Pixel 5, 27 Nov).
   */
  fun cancel() {
    synchronized(convLock) {
      for (c in listOf(conversation, offRecord, scratch)) {
        if (c?.isAlive == true) runCatching { c.cancelProcess() }
      }
    }
  }

  /** Guards closing the chat, off-the-record and scratch conversations against [cancel]. */
  private val convLock = Any()

  private fun dispose(c: Conversation?, what: String) {
    c ?: return
    synchronized(convLock) { runCatching { c.close() }.onFailure { Log.w(TAG, "$what close failed", it) } }
  }

  val isLoaded: Boolean
    get() = engine != null

  /**
   * Unloads unless an answer is being written (memory pressure must not cut one off); the next
   * question loads it again. True if it is not loaded afterwards.
   */
  @Synchronized
  fun unloadIfIdle(): Boolean {
    if ((running?.count ?: 0L) > 0L) return false
    if (engine != null) unload()
    return true
  }

  @Synchronized
  fun unload() {
    stopRunning()
    closeScratch()
    closeBefore()
    closeOffRecord()
    dispose(conversation, "chat")
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
    /** System prompts kept read in at once (see [bases]): two keeps RAM use small on 4 GB phones. */
    private const val MAX_BASES = 2
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
