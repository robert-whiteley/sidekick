package dev.sidekick.engine

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import java.io.File
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Phone search (gallery photos and picked folders): a small upright JPEG copy of a photo the user
 * allowed (a MediaStore item, a picked-folder document or a file), for on-device text reading and
 * the photo vector, plus its EXIF date and place. The original is never changed. Also opens a
 * found photo or file in the phone's own viewer.
 */
object Gallery {
  private fun uriOf(ref: String): Uri =
    if (ref.startsWith("content://") || ref.startsWith("file://")) Uri.parse(ref) else Uri.fromFile(File(ref))

  /**
   * MediaStore hides a photo's GPS position unless the app holds ACCESS_MEDIA_LOCATION and asks
   * for the original; picked-folder documents are read as they are.
   */
  private fun exifUri(ctx: Context, u: Uri): Uri {
    if (u.authority != MediaStore.AUTHORITY || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return u
    val granted = ctx.checkSelfPermission(Manifest.permission.ACCESS_MEDIA_LOCATION) == PackageManager.PERMISSION_GRANTED
    return if (granted) MediaStore.setRequireOriginal(u) else u
  }

  /** [ref] shrunk to [maxEdge] px into [outPath]; null if it can't be read (deleted, no access). */
  fun prepare(ctx: Context, ref: String, maxEdge: Int, outPath: String): Map<String, Any?>? {
    val u = uriOf(ref)
    val cr = ctx.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    try {
      // Bounds only: decodeStream returns null here, so only a missing stream means "can't read".
      val stream = cr.openInputStream(u) ?: return null
      stream.use { BitmapFactory.decodeStream(it, null, bounds) }
    } catch (_: Exception) {
      return null
    }
    val w = bounds.outWidth
    val h = bounds.outHeight
    if (w <= 0 || h <= 0) return null
    val edge = maxEdge.coerceIn(64, 4096)
    var sample = 1
    while (maxOf(w, h) / (sample * 2) >= edge) sample *= 2
    val decoded =
      try {
        cr.openInputStream(u)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
      } catch (_: OutOfMemoryError) {
        null
      } catch (_: Exception) {
        null
      } ?: return null
    var rotation = 0
    var lat: Double? = null
    var lon: Double? = null
    var takenAt: Long? = null
    try {
      val src = try { exifUri(ctx, u) } catch (_: Exception) { u }
      val stream = try { cr.openInputStream(src) } catch (_: SecurityException) { cr.openInputStream(u) }
      stream?.use { s ->
        val exif = ExifInterface(s)
        rotation =
          when (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90
            ExifInterface.ORIENTATION_ROTATE_180 -> 180
            ExifInterface.ORIENTATION_ROTATE_270 -> 270
            else -> 0
          }
        val ll = FloatArray(2)
        if (exif.getLatLong(ll) && !(ll[0] == 0f && ll[1] == 0f)) {
          lat = ll[0].toDouble()
          lon = ll[1].toDouble()
        }
        takenAt = exifTime(exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL))
      }
    } catch (_: Exception) {
      // No EXIF (PNG screenshots): the date comes from the media store or the file.
    }
    val scale = minOf(1f, edge.toFloat() / maxOf(decoded.width, decoded.height))
    val out =
      if (scale == 1f && rotation == 0) decoded
      else {
        val m = Matrix().apply {
          postScale(scale, scale)
          postRotate(rotation.toFloat())
        }
        Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, m, true).also { if (it !== decoded) decoded.recycle() }
      }
    val file = File(outPath)
    file.parentFile?.mkdirs()
    file.outputStream().use { out.compress(Bitmap.CompressFormat.JPEG, 88, it) }
    val ow = out.width
    val oh = out.height
    out.recycle()
    return mapOf(
      "path" to file.absolutePath,
      "width" to ow,
      "height" to oh,
      "lat" to lat,
      "lon" to lon,
      "takenAt" to takenAt?.toDouble(),
    )
  }

  /** EXIF "2026:11:20 14:05:09" in the phone's time zone (EXIF has no zone), or null. */
  private fun exifTime(v: String?): Long? {
    if (v.isNullOrBlank()) return null
    return try {
      SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US).parse(v.trim())?.time
    } catch (_: Exception) {
      null
    }
  }

  /** Opens a found photo or file in the phone's own app for it; false if none can. */
  fun open(ctx: Context, ref: String, mime: String?): Boolean {
    val u = uriOf(ref)
    if (u.scheme == "file") return false // Android refuses file:// links to other apps.
    val type = mime ?: try { ctx.contentResolver.getType(u) } catch (_: Exception) { null }
    val intent =
      Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(u, type ?: "*/*")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
    return try {
      ctx.startActivity(intent)
      true
    } catch (_: ActivityNotFoundException) {
      false
    } catch (_: SecurityException) {
      false
    }
  }
}
