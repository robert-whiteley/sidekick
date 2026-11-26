package dev.sidekick.engine

import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.SystemClock
import android.util.Log
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * "Make a picture", on the phone: SDXS-512 (one step, 8-bit) through stable-diffusion.cpp (MIT,
 * compiled from source into libsidekick_sd.so, see src/main/cpp/CMakeLists.txt). Which picture is
 * decided by the chat model (src/engine/picture-logic.ts); this only draws it. One picture at a
 * time; [cancel] stops it. The model is freed after 60 s idle and on memory pressure.
 */
object ImageGen {
  private const val TAG = "SidekickImageGen"
  private const val IDLE_MS = 60_000L

  private var handle = 0L
  private var key: String? = null
  @Volatile private var running = 0L
  private var lastUse = 0L
  private val lock = Any()
  private val reaper = Executors.newSingleThreadScheduledExecutor()

  /** The library is built for 64-bit ARM with dot product and FP16; checked before it is loaded. */
  val supported: Boolean by lazy {
    if (!Build.SUPPORTED_ABIS.contains("arm64-v8a")) return@lazy false
    val features =
      try {
        File("/proc/cpuinfo").readLines().firstOrNull { it.startsWith("Features") } ?: ""
      } catch (_: Exception) {
        ""
      }
    val ok = CpuFeatures.hasAll(features, listOf("asimddp", "asimdhp"))
    if (!ok) return@lazy false
    try {
      System.loadLibrary("sidekick_sd")
      true
    } catch (e: Throwable) {
      Log.w(TAG, "library not loaded: $e")
      false
    }
  }

  data class Result(val path: String, val width: Int, val height: Int, val ms: Long, val loadMs: Long)

  /** Called from the generating thread: stage ("load", "sample", "decode"…), done and total. */
  fun interface Progress {
    fun onProgress(stage: String, completed: Long, total: Long)
  }

  fun generate(
    context: Context,
    modelPath: String,
    taesdPath: String?,
    prompt: String,
    seed: Long,
    progress: Progress,
  ): Result {
    check(supported) { "not supported on this phone" }
    val t0 = SystemClock.elapsedRealtime()
    synchronized(lock) {
      val k = "$modelPath|$taesdPath"
      if (handle == 0L || key != k) {
        freeLocked()
        // Big cores only: on 1+1+6 chips (Pixel 5) 6 threads beat 4 and 8 (measured, BENCH.md).
        val threads = Runtime.getRuntime().availableProcessors().coerceIn(2, 6)
        handle = nativeCreate(modelPath, taesdPath, threads)
        key = k
      }
      running = handle
    }
    try {
      val rgb = nativeGenerate(running, prompt, SIZE, SIZE, 1, 1.0f, seed, progress)
      val px = IntArray(SIZE * SIZE)
      for (i in px.indices) {
        val r = rgb[i * 3].toInt() and 0xff
        val g = rgb[i * 3 + 1].toInt() and 0xff
        val b = rgb[i * 3 + 2].toInt() and 0xff
        px[i] = (0xff shl 24) or (r shl 16) or (g shl 8) or b
      }
      val bmp = Bitmap.createBitmap(px, SIZE, SIZE, Bitmap.Config.ARGB_8888)
      // Like photo edits: a working copy (JS keeps it in the memory database unless off the
      // record); copies older than 2 days go.
      val dir = File(context.filesDir, "edits").apply { mkdirs() }
      val old = System.currentTimeMillis() - 2 * 86_400_000L
      dir.listFiles()?.filter { it.lastModified() < old }?.forEach { it.delete() }
      val file = File(dir, "picture-${System.currentTimeMillis()}.png")
      file.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
      bmp.recycle()
      return Result(file.absolutePath, SIZE, SIZE, SystemClock.elapsedRealtime() - t0, 0)
    } finally {
      synchronized(lock) {
        running = 0L
        lastUse = SystemClock.elapsedRealtime()
      }
      reaper.schedule({ unloadIfIdle() }, IDLE_MS + 1000, TimeUnit.MILLISECONDS)
    }
  }

  /** Stops the picture being made (it ends with a "cancelled" error). */
  fun cancel() {
    val h = running
    if (h != 0L) nativeCancel(h)
  }

  val isLoaded: Boolean
    get() = synchronized(lock) { handle != 0L }

  /** Frees the model unless a picture is being made. */
  fun unloadIfIdle(minIdleMs: Long = IDLE_MS): Boolean =
    synchronized(lock) {
      if (running != 0L || handle == 0L) return false
      if (SystemClock.elapsedRealtime() - lastUse < minIdleMs) return false
      freeLocked()
      Log.i(TAG, "image model unloaded")
      true
    }

  private fun freeLocked() {
    if (handle != 0L) nativeFree(handle)
    handle = 0L
    key = null
  }

  private const val SIZE = 512

  @JvmStatic private external fun nativeCreate(model: String, taesd: String?, threads: Int): Long

  @JvmStatic private external fun nativeGenerate(
    handle: Long,
    prompt: String,
    width: Int,
    height: Int,
    steps: Int,
    cfg: Float,
    seed: Long,
    listener: Progress,
  ): ByteArray

  @JvmStatic private external fun nativeCancel(handle: Long)

  @JvmStatic private external fun nativeFree(handle: Long)
}

/** /proc/cpuinfo's "Features" line; pure, for tests. */
object CpuFeatures {
  fun hasAll(line: String, wanted: List<String>): Boolean {
    val have = line.substringAfter(':', "").trim().split(Regex("\\s+")).toSet()
    return wanted.all { it in have }
  }
}
