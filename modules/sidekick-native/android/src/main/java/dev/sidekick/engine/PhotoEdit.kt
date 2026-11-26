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
 * Erase an object: MI-GAN (MIT, 28 MB ONNX) fills what the user brushed over. Upscale:
 * Real-ESRGAN general x4v3 (BSD-3, 4.9 MB ONNX), tile by tile.
 * The original is never changed: each edit writes a new file in the app's `edits/` folder.
 * Which edit the user wants is decided by the chat model (src/engine/photo-edit-logic.ts).
 */
object PhotoEdit {
  /** Output size cap: big enough to keep, small enough for a 4 GB phone's memory. */
  private const val MAX_EDGE = 2048
  private const val SEG_SIZE = 320
  private const val KEEP_MS = 2 * 86_400_000L

  /** Upscale only small pictures (the app offers it up to this long edge); 4x stays ≤ 4096 px. */
  const val UPSCALE_MAX_EDGE = 1024
  private const val TILE = 128
  private const val TILE_PAD = 10

  private var seg: Long = 0
  private var segPath: String? = null
  private var aux: Long = 0
  private var auxPath: String? = null
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
    if (op == "upscale") {
      // Big photos are sharp enough already; JS says so from this message.
      val b = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
      android.graphics.BitmapFactory.decodeFile(photoPath, b)
      if (max(b.outWidth, b.outHeight) > UPSCALE_MAX_EDGE) error("too big ${b.outWidth}x${b.outHeight}")
    }
    val src = ModelImage.decodeUpright(photoPath, if (op == "upscale") UPSCALE_MAX_EDGE else MAX_EDGE) ?: error("can't read the photo")
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
        "erase" -> {
          val model = segModelPath ?: error("erase model missing")
          val t1 = SystemClock.elapsedRealtime()
          @Suppress("UNCHECKED_CAST")
          val strokes = (args["strokes"] as? List<List<Number>>) ?: error("nothing marked to erase")
          val radius = (args["radius"] as? Number)?.toFloat() ?: 0.04f
          erase(model, src, strokes, radius).also { segMs = SystemClock.elapsedRealtime() - t1 }
        }
        "upscale" -> {
          val model = segModelPath ?: error("upscale model missing")
          val t1 = SystemClock.elapsedRealtime()
          upscale(model, src).also { segMs = SystemClock.elapsedRealtime() - t1 }
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
      if (aux != 0L) OrtShim.release(aux)
      aux = 0
      auxPath = null
    }

  /** The erase or upscale model (one at a time: they are rarely used together). */
  private fun auxSession(path: String): Long {
    if (aux == 0L || auxPath != path) {
      if (aux != 0L) OrtShim.release(aux)
      aux = OrtShim.create(path, 4)
      auxPath = path
    }
    return aux
  }

  /**
   * Fills what the user brushed over. [strokes]: each a flat list x0,y0,x1,y1,… in 0..1 of the
   * picture; [radius]: brush radius as a fraction of the shorter edge. The brush is drawn a
   * little wider than shown, since a leftover rim of the object spoils the fill (measured).
   */
  private fun erase(modelPath: String, b: Bitmap, strokes: List<List<Number>>, radius: Float): Bitmap {
    val w = b.width
    val h = b.height
    val mask = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(mask)
    canvas.drawColor(Color.WHITE)
    val paint =
      android.graphics.Paint().apply {
        color = Color.BLACK
        isAntiAlias = false
        style = android.graphics.Paint.Style.STROKE
        strokeCap = android.graphics.Paint.Cap.ROUND
        strokeJoin = android.graphics.Paint.Join.ROUND
        strokeWidth = max(2f, radius * 1.25f * min(w, h) * 2)
      }
    var any = false
    for (s in strokes) {
      if (s.size < 2) continue
      val path = android.graphics.Path()
      path.moveTo(s[0].toFloat() * w, s[1].toFloat() * h)
      // A single tap is a dot: a zero-length line with round caps.
      if (s.size < 4) path.lineTo(s[0].toFloat() * w + 0.1f, s[1].toFloat() * h)
      var i = 2
      while (i + 1 < s.size) {
        path.lineTo(s[i].toFloat() * w, s[i + 1].toFloat() * h)
        i += 2
      }
      canvas.drawPath(path, paint)
      any = true
    }
    require(any) { "nothing marked to erase" }
    val mpx = pixels(mask)
    mask.recycle()
    val px = pixels(b)
    val plane = w * h
    val img = ByteArray(3 * plane)
    val m = ByteArray(plane)
    for (i in 0 until plane) {
      val c = px[i]
      img[i] = Color.red(c).toByte()
      img[plane + i] = Color.green(c).toByte()
      img[2 * plane + i] = Color.blue(c).toByte()
      // MI-GAN: 255 keeps a pixel, 0 fills it.
      m[i] = if (Color.red(mpx[i]) < 128) 0 else 255.toByte()
    }
    val outShape = LongArray(8)
    val out =
      synchronized(lock) {
        OrtShim.runU8(
          auxSession(modelPath),
          arrayOf(img, m),
          arrayOf(longArrayOf(1, 3, h.toLong(), w.toLong()), longArrayOf(1, 1, h.toLong(), w.toLong())),
          outShape,
        )
      }
    check(out.size == 3 * plane) { "unexpected erase output" }
    for (i in 0 until plane) {
      px[i] = Color.rgb(out[i].toInt() and 0xff, out[plane + i].toInt() and 0xff, out[2 * plane + i].toInt() and 0xff)
    }
    return fromPixels(px, w, h)
  }

  /**
   * 4x larger, tile by tile (128 px tiles with a 10 px margin each side, so seams don't show).
   * Inputs at most [UPSCALE_MAX_EDGE] (bigger photos are already sharp enough to keep).
   */
  private fun upscale(modelPath: String, b: Bitmap): Bitmap {
    val w = b.width
    val h = b.height
    val src = pixels(b)
    val ow = w * 4
    val oh = h * 4
    val out = IntArray(ow * oh)
    val outShape = LongArray(8)
    synchronized(lock) {
      val session = auxSession(modelPath)
      for (ty in 0 until h step TILE) {
        for (tx in 0 until w step TILE) {
          val x0 = max(0, tx - TILE_PAD)
          val y0 = max(0, ty - TILE_PAD)
          val x1 = min(w, tx + TILE + TILE_PAD)
          val y1 = min(h, ty + TILE + TILE_PAD)
          val tw = x1 - x0
          val th = y1 - y0
          val plane = tw * th
          val input = FloatArray(3 * plane)
          for (y in 0 until th) for (x in 0 until tw) {
            val c = src[(y0 + y) * w + x0 + x]
            val i = y * tw + x
            input[i] = Color.red(c) / 255f
            input[plane + i] = Color.green(c) / 255f
            input[2 * plane + i] = Color.blue(c) / 255f
          }
          val r = OrtShim.run(session, input, longArrayOf(1, 3, th.toLong(), tw.toLong()), outShape)
          val rw = tw * 4
          val rp = rw * th * 4
          // Copy only this tile's own area (without the margin) into the result.
          val cx0 = tx
          val cy0 = ty
          val cx1 = min(w, tx + TILE)
          val cy1 = min(h, ty + TILE)
          for (y in (cy0 - y0) * 4 until (cy1 - y0) * 4) {
            val oy = y0 * 4 + y
            for (x in (cx0 - x0) * 4 until (cx1 - x0) * 4) {
              val i = y * rw + x
              out[oy * ow + x0 * 4 + x] =
                Color.rgb(
                  (r[i] * 255f).roundToInt().coerceIn(0, 255),
                  (r[rp + i] * 255f).roundToInt().coerceIn(0, 255),
                  (r[2 * rp + i] * 255f).roundToInt().coerceIn(0, 255),
                )
            }
          }
        }
      }
    }
    return fromPixels(out, ow, oh)
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
