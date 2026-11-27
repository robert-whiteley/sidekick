package dev.sidekick.engine

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * A few still pictures from a video, evenly spread through it (not the very first or last
 * moment), as JPEGs no larger than [maxEdge] px, for the chat model to describe. The speech is
 * read separately (Recordings.kt takes a video's sound track like a recording).
 */
object VideoFrames {
  fun extract(context: Context, path: String, count: Int, outDir: String, maxEdge: Int): Map<String, Any> {
    val r = MediaMetadataRetriever()
    try {
      val u = Uri.parse(path)
      if (u.scheme == null || u.scheme == "file") r.setDataSource(u.path ?: path)
      else r.setDataSource(context, u)
      val durationMs =
        r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
      val n = count.coerceIn(1, 8)
      File(outDir).mkdirs()
      val frames = mutableListOf<Map<String, Any>>()
      for (i in 0 until n) {
        val atMs = if (durationMs > 0) durationMs * (2 * i + 1) / (2 * n) else 0L
        val bmp = frameAt(r, atMs * 1000, maxEdge) ?: continue
        val out = File(outDir, "frame$i.jpg")
        try {
          FileOutputStream(out).use { bmp.compress(Bitmap.CompressFormat.JPEG, 88, it) }
        } finally {
          bmp.recycle()
        }
        frames.add(mapOf("path" to out.absolutePath, "atMs" to atMs.toDouble()))
      }
      return mapOf("durationMs" to durationMs.toDouble(), "frames" to frames)
    } finally {
      r.release()
    }
  }

  private fun frameAt(r: MediaMetadataRetriever, us: Long, maxEdge: Int): Bitmap? {
    val opt = MediaMetadataRetriever.OPTION_CLOSEST_SYNC
    val w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
    val h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
    if (Build.VERSION.SDK_INT >= 27 && w > 0 && h > 0) {
      val scale = minOf(1f, maxEdge.toFloat() / max(w, h))
      return r.getScaledFrameAtTime(us, opt, max(1, (w * scale).roundToInt()), max(1, (h * scale).roundToInt()))
    }
    val full = r.getFrameAtTime(us, opt) ?: return null
    val scale = minOf(1f, maxEdge.toFloat() / max(full.width, full.height))
    if (scale >= 1f) return full
    val small = Bitmap.createScaledBitmap(full, max(1, (full.width * scale).roundToInt()), max(1, (full.height * scale).roundToInt()), true)
    full.recycle()
    return small
  }
}
