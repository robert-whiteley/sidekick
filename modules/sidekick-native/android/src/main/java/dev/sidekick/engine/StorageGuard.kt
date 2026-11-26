package dev.sidekick.engine

import android.content.Context
import android.os.StatFs
import dev.sidekick.engine.camera.Retention
import kotlin.math.max
import kotlin.math.min

/**
 * Free-space levels for what the native side writes (the same rule as src/engine/storage-guard.ts):
 * LOW (under the reserve): automatic recordings pause (video, camera stills, conversation audio);
 * FULL (under FLOOR_BYTES, at most the reserve): no camera keyframes either. Journal lines (a few
 * KB of text) are still written, so nothing heard is lost; JS stops moving them into the database
 * at FULL, so it never runs out of room mid-write.
 */
object StorageGuard {
  enum class Level { OK, LOW, FULL }

  const val FLOOR_BYTES = 500_000_000L
  private const val MB = 1024L * 1024

  /** The reserve the user chose (from JS, cameraConfigure); 0 = Recommended. */
  @Volatile var reserveMb = 0L

  fun floor(totalBytes: Long, reserveBytes: Long): Long = min(reserveBytes, max(FLOOR_BYTES, totalBytes / 100))

  fun level(freeBytes: Long, totalBytes: Long, reserveBytes: Long): Level =
    when {
      freeBytes < floor(totalBytes, reserveBytes) -> Level.FULL
      freeBytes < reserveBytes -> Level.LOW
      else -> Level.OK
    }

  @Volatile private var cached: Pair<Long, Level>? = null

  /** The level now, re-read at most every 5 s (checked before each clip and frame). */
  fun now(ctx: Context): Level {
    val t = System.currentTimeMillis()
    cached?.let { if (t - it.first < CACHE_MS) return it.second }
    val l =
      runCatching {
          val stat = StatFs(ctx.filesDir.absolutePath)
          val reserve = if (reserveMb > 0) reserveMb * MB else Retention.recommendedReserve(stat.totalBytes)
          level(stat.availableBytes, stat.totalBytes, reserve)
        }
        .getOrDefault(Level.OK)
    cached = t to l
    return l
  }

  private const val CACHE_MS = 5_000L
}
