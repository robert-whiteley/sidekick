package dev.sidekick.engine

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import java.io.File

/**
 * Camera photos are ~12 MP; the model sees images at well under 1 MP and was given a black image
 * when handed the full-size file. Shrink (and turn upright) to [maxEdge] px (default
 * [DEFAULT_MAX_EDGE]) before the model sees it; this is also much faster to encode.
 */
object ModelImage {
  const val DEFAULT_MAX_EDGE = 768

  /** [outName]: the temp file written; callers that may run at the same time use different names. */
  fun prepare(path: String, maxEdge: Int = DEFAULT_MAX_EDGE, outName: String = "model-input.jpg"): String {
    val edge = maxEdge.coerceIn(64, 4096)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    val w = bounds.outWidth
    val h = bounds.outHeight
    if (w <= 0 || h <= 0) return path
    val rotation = exifRotation(path)
    if (maxOf(w, h) <= edge && rotation == 0) return path

    val out = decodeUpright(path, edge) ?: return path
    val file = File(System.getProperty("java.io.tmpdir") ?: File(path).parent, outName)
    file.outputStream().use { out.compress(Bitmap.CompressFormat.JPEG, 90, it) }
    out.recycle()
    return file.absolutePath
  }

  /** The photo decoded upright (EXIF rotation applied), longest edge at most [maxEdge] px. */
  fun decodeUpright(path: String, maxEdge: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    val w = bounds.outWidth
    val h = bounds.outHeight
    if (w <= 0 || h <= 0) return null
    var sample = 1
    while (maxOf(w, h) / (sample * 2) >= maxEdge) sample *= 2
    val decoded =
      BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
        ?: return null
    val scale = minOf(1f, maxEdge.toFloat() / maxOf(decoded.width, decoded.height))
    val rotation = exifRotation(path)
    if (scale == 1f && rotation == 0) return decoded
    val m = Matrix().apply {
      postScale(scale, scale)
      postRotate(rotation.toFloat())
    }
    val out = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, m, true)
    if (out !== decoded) decoded.recycle()
    return out
  }

  private fun exifRotation(path: String): Int =
    try {
      when (
        ExifInterface(path).getAttributeInt(
          ExifInterface.TAG_ORIENTATION,
          ExifInterface.ORIENTATION_NORMAL,
        )
      ) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90
        ExifInterface.ORIENTATION_ROTATE_180 -> 180
        ExifInterface.ORIENTATION_ROTATE_270 -> 270
        else -> 0
      }
    } catch (_: Exception) {
      0
    }
}
