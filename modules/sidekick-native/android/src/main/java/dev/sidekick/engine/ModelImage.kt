package dev.sidekick.engine

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import java.io.File

/**
 * Camera photos are ~12 MP; the model sees images at well under 1 MP and was given a black image
 * when handed the full-size file. Shrink (and turn upright) to [MAX_EDGE] px before the model sees
 * it; this is also much faster to encode.
 */
object ModelImage {
  private const val MAX_EDGE = 768

  fun prepare(path: String): String {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    val w = bounds.outWidth
    val h = bounds.outHeight
    if (w <= 0 || h <= 0) return path
    val rotation = exifRotation(path)
    if (maxOf(w, h) <= MAX_EDGE && rotation == 0) return path

    var sample = 1
    while (maxOf(w, h) / (sample * 2) >= MAX_EDGE) sample *= 2
    val decoded =
      BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
        ?: return path
    val scale = minOf(1f, MAX_EDGE.toFloat() / maxOf(decoded.width, decoded.height))
    val m = Matrix().apply {
      postScale(scale, scale)
      postRotate(rotation.toFloat())
    }
    val out = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, m, true)
    if (out !== decoded) decoded.recycle()
    val file = File(System.getProperty("java.io.tmpdir") ?: File(path).parent, "model-input.jpg")
    file.outputStream().use { out.compress(Bitmap.CompressFormat.JPEG, 90, it) }
    out.recycle()
    return file.absolutePath
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
