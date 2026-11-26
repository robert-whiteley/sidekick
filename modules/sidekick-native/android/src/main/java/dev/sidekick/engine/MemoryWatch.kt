package dev.sidekick.engine

import android.app.ActivityManager
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.util.Log
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Android's low-memory signals (onTrimMemory, onLowMemory, and the "low memory" flag while a
 * model sits loaded): frees what can be freed before Android kills the app. Everything freed loads
 * again on demand (the chat model at the next question, the embedder at the next search, OCR at
 * the next photo). An answer being written is never cut off. Process-wide, so it also covers the
 * background listen service with the app closed.
 */
object MemoryWatch : ComponentCallbacks2 {
  @Volatile private var app: Context? = null
  /** Tells JS (it drops its own caches); null while no JS is running. */
  @Volatile var listener: ((Map<String, Any?>) -> Unit)? = null

  private val worker = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "sidekick-memory").apply { isDaemon = true } }

  @Synchronized
  fun install(ctx: Context) {
    if (app != null) return
    val a = ctx.applicationContext
    app = a
    a.registerComponentCallbacks(this)
    // Newer Android sends few trim levels to an app with a foreground service; the flag is checked
    // too, but only matters while both big models are loaded (Residency handles every new load).
    worker.scheduleWithFixedDelay({ runCatching { poll() } }, CHECK_S, CHECK_S, TimeUnit.SECONDS)
  }

  override fun onTrimMemory(level: Int) {
    val free = MemoryPressure.forTrim(level)
    if (free != MemoryPressure.Free.NONE) worker.execute { release(free, "trim level $level") }
  }

  @Deprecated("Deprecated in Java")
  override fun onLowMemory() {
    worker.execute { release(MemoryPressure.Free.ALL, "low memory") }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {}

  private fun poll() {
    val ctx = app ?: return
    if (!(Embedder.isLoaded && Engines.llm(ctx).isLoaded)) return
    val mem = ActivityManager.MemoryInfo()
    (ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(mem)
    if (mem.lowMemory) release(MemoryPressure.Free.ONE_MODEL, "Android reports low memory")
  }

  private fun release(free: MemoryPressure.Free, why: String) {
    val ctx = app ?: return
    val llm = Engines.llm(ctx)
    val plan = MemoryPressure.plan(free, llmLoaded = llm.isLoaded, embedderLoaded = Embedder.isLoaded)
    val freed = mutableListOf<String>()
    Ocr.unload()
    PhotoEdit.unload()
    if (ImageGen.unloadIfIdle(0)) freed += "picture model"
    if (plan.embedder) {
      Embedder.unload()
      freed += "embedder"
    }
    if (plan.llm && llm.unloadIfIdle()) freed += "chat model"
    Log.i(TAG, "$why: freed ${if (freed.isEmpty()) "small caches" else freed.joinToString()}")
    listener?.invoke(mapOf("level" to if (free == MemoryPressure.Free.ALL) "critical" else "low", "freed" to freed))
  }

  private const val CHECK_S = 30L
  private const val TAG = "SidekickMemory"
}

/** What to free for each signal; pure, for tests. */
object MemoryPressure {
  enum class Free { NONE, ONE_MODEL, ALL }

  /** Android's trim levels (ComponentCallbacks2), as numbers so tests need no Android classes. */
  private const val RUNNING_MODERATE = 5
  private const val RUNNING_CRITICAL = 15
  private const val UI_HIDDEN = 20
  private const val BACKGROUND = 40

  fun forTrim(level: Int): Free =
    when {
      // In the background list: next in line to be killed. Free both (an answer still finishes).
      level >= BACKGROUND -> Free.ALL
      // Only that the screen was left: not memory pressure.
      level == UI_HIDDEN -> Free.NONE
      level >= RUNNING_CRITICAL -> Free.ALL
      level >= RUNNING_MODERATE -> Free.ONE_MODEL
      else -> Free.NONE
    }

  data class Plan(val embedder: Boolean, val llm: Boolean)

  /**
   * ONE_MODEL: the two big models must not stay together (ARCHITECTURE "Memory budget"): the
   * embedder goes (questions need the chat model; search reloads it in ~1.6 s). A single model
   * stays. ALL: both go.
   */
  fun plan(free: Free, llmLoaded: Boolean, embedderLoaded: Boolean): Plan =
    when (free) {
      Free.NONE -> Plan(embedder = false, llm = false)
      Free.ONE_MODEL -> Plan(embedder = embedderLoaded && llmLoaded, llm = false)
      Free.ALL -> Plan(embedder = embedderLoaded, llm = llmLoaded)
    }
}
