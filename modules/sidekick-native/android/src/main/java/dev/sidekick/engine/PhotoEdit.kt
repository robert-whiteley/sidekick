package dev.sidekick.engine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.os.SystemClock
import java.io.File
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Light photo edits, all on the phone: turn, mirror, crop to a shape, black and white, auto
 * enhance, and background changes (remove, white, a colour, blur). The background is found by
 * U²-Netp (Apache-2.0, 4.6 MB ONNX, through [OrtShim]); everything else is plain bitmap code.
 * The original is never changed: each edit writes a new file in the app's `edits/` folder.
 * Which edit the user wants is decided by the chat model (src/engine/photo-edit-logic.ts).
 */
object PhotoEdit {
  /** Output size cap: big enough to keep, small enough for a 4 GB phone's memory. */
  private const val MAX_EDGE = 2048
  private const val SEG_SIZE = 320
  private const val KEEP_MS = 2 * 86_400_000L

  private var seg: Long = 0
  private var segPath: String? = null
  private val lock = Any()

  data class Result(val path: String, val width: Int, val height: Int, val ms: Long, val segMs: Long)

  fun edit(
    context: Context,
    photoPath: String,
    op: String,
    args: Map<String, Any?>,
    segModelPath: String?,
  ): Result {
    val t0 = SystemClock.elapsedRealtime()
    val src = ModelImage.decodeUpright(photoPath, MAX_EDGE) ?: error("can't read the photo")
    var segMs = 0L
    var png = false
    val out: Bitmap =
      when (op) {
        "rotate" -> rotate(src, (args["degrees"] as? Number)?.toInt() ?: 90)
        "flip" -> flip(src, args["direction"] as? String ?: "horizontal")
        "crop" -> crop(src, args["shape"] as? String ?: "square")
        "grayscale" -> grayscale(src)
        "enhance" -> enhance(src)
        "background" -> {
          val model = segModelPath ?: error("background model missing")
          val t1 = SystemClock.elapsedRealtime()
          val mask = mask(model, src)
          segMs = SystemClock.elapsedRealtime() - t1
          val mode = args["mode"] as? String ?: "white"
          png = mode == "remove"
          background(src, mask, mode, args["color"] as? String)
        }
        else -> error("unknown edit $op")
      }
    if (out !== src) src.recycle()
    val dir = File(context.filesDir, "edits").apply { mkdirs() }
    // Edited copies are for saving or sharing now: older than 2 days, they go.
    val old = System.currentTimeMillis() - KEEP_MS
    dir.listFiles()?.filter { it.lastModified() < old }?.forEach { it.delete() }
    val file = File(dir, "edit-${System.currentTimeMillis()}.${if (png) "png" else "jpg"}")
    file.outputStream().use {
      out.compress(if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, 92, it)
    }
    val r = Result(file.absolutePath, out.width, out.height, SystemClock.elapsedRealtime() - t0, segMs)
    out.recycle()
    return r
  }

  fun unload() =
    synchronized(lock) {
      if (seg != 0L) OrtShim.release(seg)
      seg = 0
      segPath = null
    }

  private fun rotate(b: Bitmap, degrees: Int): Bitmap {
    val d = ((degrees % 360) + 360) % 360
    if (d == 0) return b
    val m = Matrix().apply { postRotate(d.toFloat()) }
    return Bitmap.createBitmap(b, 0, 0, b.width, b.height, m, true)
  }

  private fun flip(b: Bitmap, direction: String): Bitmap {
    val m = Matrix().apply { if (direction == "vertical") postScale(1f, -1f) else postScale(-1f, 1f) }
    return Bitmap.createBitmap(b, 0, 0, b.width, b.height, m, true)
  }

  /** Centre crop to a shape ("square", "4:3", "16:9", "3:4", "9:16", "tighter" = 80% zoom). */
  private fun crop(b: Bitmap, shape: String): Bitmap {
    val (w, h) = b.width to b.height
    if (shape == "tighter") {
      val cw = (w * 0.8).roundToInt()
      val ch = (h * 0.8).roundToInt()
      return Bitmap.createBitmap(b, (w - cw) / 2, (h - ch) / 2, cw, ch)
    }
    val ratio =
      when (shape) {
        "4:3" -> 4.0 / 3
        "3:4" -> 3.0 / 4
        "16:9" -> 16.0 / 9
        "9:16" -> 9.0 / 16
        else -> 1.0
      }
    var cw = w
    var ch = (w / ratio).roundToInt()
    if (ch > h) {
      ch = h
      cw = (h * ratio).roundToInt()
    }
    return Bitmap.createBitmap(b, (w - cw) / 2, (h - ch) / 2, cw, ch)
  }

  private fun pixels(b: Bitmap): IntArray = IntArray(b.width * b.height).also { b.getPixels(it, 0, b.width, 0, 0, b.width, b.height) }

  private fun fromPixels(px: IntArray, w: Int, h: Int, alpha: Boolean = false): Bitmap =
    Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).apply {
      setHasAlpha(alpha)
      setPixels(px, 0, w, 0, 0, w, h)
    }

  private fun grayscale(b: Bitmap): Bitmap {
    val px = pixels(b)
    for (i in px.indices) {
      val c = px[i]
      val y = (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)).roundToInt()
      px[i] = Color.rgb(y, y, y)
    }
    return fromPixels(px, b.width, b.height)
  }

  /**
   * Auto levels: each channel stretched between its 0.5th and 99.5th percentile (fixes dull or
   * colour-cast photos), then a little more colour. No model.
   */
  private fun enhance(b: Bitmap): Bitmap {
    val px = pixels(b)
    val hist = Array(3) { IntArray(256) }
    for (c in px) {
      hist[0][Color.red(c)]++
      hist[1][Color.green(c)]++
      hist[2][Color.blue(c)]++
    }
    val n = px.size
    val lo = IntArray(3)
    val hi = IntArray(3)
    for (ch in 0..2) {
      var acc = 0
      lo[ch] = (0..255).first { acc += hist[ch][it]; acc > n * 0.005 }
      acc = 0
      hi[ch] = (255 downTo 0).first { acc += hist[ch][it]; acc > n * 0.005 }
      // A nearly flat channel (a white wall) isn't stretched into noise.
      if (hi[ch] - lo[ch] < 32) {
        lo[ch] = 0
        hi[ch] = 255
      }
    }
    val lut = Array(3) { ch -> IntArray(256) { v -> ((v - lo[ch]) * 255.0 / (hi[ch] - lo[ch])).roundToInt().coerceIn(0, 255) } }
    val sat = 1.12f
    for (i in px.indices) {
      val c = px[i]
      val r = lut[0][Color.red(c)]
      val g = lut[1][Color.green(c)]
      val bl = lut[2][Color.blue(c)]
      val y = 0.299f * r + 0.587f * g + 0.114f * bl
      px[i] =
        Color.rgb(
          (y + (r - y) * sat).roundToInt().coerceIn(0, 255),
          (y + (g - y) * sat).roundToInt().coerceIn(0, 255),
          (y + (bl - y) * sat).roundToInt().coerceIn(0, 255),
        )
    }
    return fromPixels(px, b.width, b.height)
  }

  /** Foreground probability 0..1 per pixel of [b] (U²-Netp at 320 px, scaled back up). */
  private fun mask(modelPath: String, b: Bitmap): FloatArray {
    val small = Bitmap.createScaledBitmap(b, SEG_SIZE, SEG_SIZE, true)
    val px = pixels(small)
    if (small !== b) small.recycle()
    val plane = SEG_SIZE * SEG_SIZE
    val input = FloatArray(3 * plane)
    // rembg's preprocessing: divide by the max, then ImageNet mean/std.
    var maxV = 1
    for (c in px) maxV = max(maxV, max(Color.red(c), max(Color.green(c), Color.blue(c))))
    val mean = floatArrayOf(0.485f, 0.456f, 0.406f)
    val std = floatArrayOf(0.229f, 0.224f, 0.225f)
    for (i in 0 until plane) {
      val c = px[i]
      input[i] = (Color.red(c) / maxV.toFloat() - mean[0]) / std[0]
      input[plane + i] = (Color.green(c) / maxV.toFloat() - mean[1]) / std[1]
      input[2 * plane + i] = (Color.blue(c) / maxV.toFloat() - mean[2]) / std[2]
    }
    val outShape = LongArray(8)
    val raw =
      synchronized(lock) {
        if (seg == 0L || segPath != modelPath) {
          if (seg != 0L) OrtShim.release(seg)
          seg = OrtShim.create(modelPath, 4)
          segPath = modelPath
        }
        OrtShim.run(seg, input, longArrayOf(1, 3, SEG_SIZE.toLong(), SEG_SIZE.toLong()), outShape)
      }
    // First output: 1x1x320x320; normalised to 0..1 as rembg does.
    var lo = Float.MAX_VALUE
    var hi = -Float.MAX_VALUE
    for (i in 0 until plane) {
      lo = min(lo, raw[i])
      hi = max(hi, raw[i])
    }
    val span = max(1e-6f, hi - lo)
    val m = FloatArray(plane) { ((raw[it] - lo) / span) }
    // Bilinear up to the photo's size.
    val w = b.width
    val h = b.height
    val out = FloatArray(w * h)
    for (y in 0 until h) {
      val fy = (y + 0.5f) * SEG_SIZE / h - 0.5f
      val y0 = fy.toInt().coerceIn(0, SEG_SIZE - 1)
      val y1 = min(y0 + 1, SEG_SIZE - 1)
      val ty = (fy - y0).coerceIn(0f, 1f)
      for (x in 0 until w) {
        val fx = (x + 0.5f) * SEG_SIZE / w - 0.5f
        val x0 = fx.toInt().coerceIn(0, SEG_SIZE - 1)
        val x1 = min(x0 + 1, SEG_SIZE - 1)
        val tx = (fx - x0).coerceIn(0f, 1f)
        val a = m[y0 * SEG_SIZE + x0] * (1 - tx) + m[y0 * SEG_SIZE + x1] * tx
        val c = m[y1 * SEG_SIZE + x0] * (1 - tx) + m[y1 * SEG_SIZE + x1] * tx
        out[y * w + x] = a * (1 - ty) + c * ty
      }
    }
    return out
  }

  private fun parseColor(s: String?): Int =
    try {
      when (s?.trim()?.lowercase()) {
        null, "" -> Color.WHITE
        "white" -> Color.WHITE
        "black" -> Color.BLACK
        "grey", "gray" -> Color.rgb(128, 128, 128)
        "red" -> Color.rgb(220, 40, 40)
        "green" -> Color.rgb(40, 160, 70)
        "blue" -> Color.rgb(40, 90, 210)
        "yellow" -> Color.rgb(245, 210, 40)
        "pink" -> Color.rgb(240, 150, 190)
        "purple" -> Color.rgb(130, 60, 170)
        "orange" -> Color.rgb(245, 140, 30)
        else -> Color.parseColor(if (s.startsWith("#")) s else "#$s")
      }
    } catch (_: IllegalArgumentException) {
      Color.WHITE
    }

  /** remove: transparent PNG. white / color: a flat colour. blur: the photo's own background, blurred. */
  private fun background(b: Bitmap, mask: FloatArray, mode: String, color: String?): Bitmap {
    val w = b.width
    val h = b.height
    val px = pixels(b)
    val back: IntArray? =
      when (mode) {
        "blur" -> {
          // Box blur at a quarter size, then back up: fast and smooth enough on a phone CPU.
          val q = Bitmap.createScaledBitmap(b, max(1, w / 8), max(1, h / 8), true)
          val blurred = Bitmap.createScaledBitmap(boxBlur(q, 3), w, h, true)
          q.recycle()
          pixels(blurred).also { blurred.recycle() }
        }
        else -> null
      }
    val flat = if (mode == "color" || mode == "white") parseColor(if (mode == "white") "white" else color) else 0
    for (i in px.indices) {
      // Soft edge: probabilities between 0.3 and 0.7 blend.
      val a = ((mask[i] - 0.3f) / 0.4f).coerceIn(0f, 1f)
      val fg = px[i]
      px[i] =
        when (mode) {
          "remove" -> Color.argb((a * 255).roundToInt(), Color.red(fg), Color.green(fg), Color.blue(fg))
          else -> {
            val bg = back?.get(i) ?: flat
            Color.rgb(
              (Color.red(fg) * a + Color.red(bg) * (1 - a)).roundToInt(),
              (Color.green(fg) * a + Color.green(bg) * (1 - a)).roundToInt(),
              (Color.blue(fg) * a + Color.blue(bg) * (1 - a)).roundToInt(),
            )
          }
        }
    }
    return fromPixels(px, w, h, alpha = mode == "remove")
  }

  private fun boxBlur(b: Bitmap, radius: Int): Bitmap {
    val w = b.width
    val h = b.height
    var px = pixels(b)
    repeat(2) {
      val tmp = IntArray(px.size)
      for (y in 0 until h) for (x in 0 until w) tmp[y * w + x] = avg(px, w, h, x, y, radius, true)
      val out = IntArray(px.size)
      for (y in 0 until h) for (x in 0 until w) out[y * w + x] = avg(tmp, w, h, x, y, radius, false)
      px = out
    }
    return fromPixels(px, w, h)
  }

  private fun avg(px: IntArray, w: Int, h: Int, x: Int, y: Int, r: Int, horizontal: Boolean): Int {
    var rs = 0
    var gs = 0
    var bs = 0
    var n = 0
    for (d in -r..r) {
      val xx = if (horizontal) (x + d).coerceIn(0, w - 1) else x
      val yy = if (horizontal) y else (y + d).coerceIn(0, h - 1)
      val c = px[yy * w + xx]
      rs += Color.red(c)
      gs += Color.green(c)
      bs += Color.blue(c)
      n++
    }
    return Color.rgb(rs / n, gs / n, bs / n)
  }
}
