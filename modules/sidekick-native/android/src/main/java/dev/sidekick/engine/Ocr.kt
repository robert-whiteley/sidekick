package dev.sidekick.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Reads the text in a photo with PaddleOCR PP-OCRv6 small (detection + recognition, ONNX on
 * ONNX Runtime via [OrtShim], CPU). Mirrors PaddleOCR's DBPostProcess (threshold 0.2, box score 0.45, unclip
 * 1.4) and CTC decoding; the laptop reference this was ported from gave the same lines.
 * Sessions (~31 MB of weights) unload [IDLE_MS] after the last read, and before the chat model or
 * the embedder loads, so OCR never sits in memory next to a big model.
 */
object Ocr {
  data class Line(val text: String, val score: Float)

  private class Models(val det: Long, val rec: Long, val chars: List<String>, val key: String)

  @Volatile private var models: Models? = null

  /** Unload this long after the last read (a burst of photos or PDF pages keeps it loaded). */
  const val IDLE_MS = 60_000L
  private val idle = IdleToken()
  private val reaper =
    Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "ocr-idle").apply { isDaemon = true } }

  /** Longest edge the photo is decoded at (crops for recognition come from this). */
  private const val DECODE_EDGE = 2048
  /** Longest edge detection runs at: small text on a 12 MP photo still detects, ~0.2 s on a laptop. */
  private const val DET_EDGE = 960
  private const val BIN_THRESH = 0.2f
  private const val BOX_THRESH = 0.45f
  private const val UNCLIP = 1.4f
  private const val MAX_BOXES = 1000
  private const val REC_H = 48
  private const val REC_MIN_W = 320
  private const val REC_MAX_W = 3200
  private const val MIN_SCORE = 0.5f

  @Synchronized
  fun read(detPath: String, recPath: String, dictPath: String, photoPath: String): List<Line> {
    val m = load(detPath, recPath, dictPath)
    val img = ModelImage.decodeUpright(photoPath, DECODE_EDGE) ?: return emptyList()
    try {
      return readImage(m, img)
    } finally {
      img.recycle()
      scheduleIdleUnload()
    }
  }

  /** Same for an image already in memory (a rendered PDF page); [img] is not recycled. */
  @Synchronized
  fun readBitmap(detPath: String, recPath: String, dictPath: String, img: Bitmap): List<Line> =
    try {
      readImage(load(detPath, recPath, dictPath), img)
    } finally {
      scheduleIdleUnload()
    }

  /**
   * Cheap check for live camera frames: runs only text detection (no recognition) and says whether
   * at least [minBoxes] text areas are in view (a sign, a number plate). [img] is not recycled.
   */
  @Synchronized
  fun hasText(detPath: String, recPath: String, dictPath: String, img: Bitmap, minBoxes: Int = 1): Boolean =
    try {
      detect(load(detPath, recPath, dictPath).det, img).size >= minBoxes
    } finally {
      scheduleIdleUnload()
    }

  /** Called with the lock held, after each read. */
  private fun scheduleIdleUnload() {
    val token = idle.used()
    reaper.schedule({ unloadIfIdle(token) }, IDLE_MS, TimeUnit.MILLISECONDS)
  }

  @Synchronized
  private fun unloadIfIdle(token: Long) {
    if (idle.isLatest(token) && models != null) {
      unload()
      android.util.Log.i("Sidekick", "ocr unloaded (idle)")
    }
  }

  private fun readImage(m: Models, img: Bitmap): List<Line> {
    val boxes = detect(m.det, img)
    val out = ArrayList<Line>()
    for (b in sortBoxes(boxes)) {
      val crop = cropBox(img, b) ?: continue
      val line = recognize(m.rec, m.chars, crop)
      crop.recycle()
      if (line != null && line.score >= MIN_SCORE && line.text.isNotBlank()) out.add(line)
    }
    return out
  }

  /** Frees the OCR sessions now (also called before the chat model or the embedder loads). */
  @Synchronized
  fun unload() {
    models?.let {
      OrtShim.release(it.det)
      OrtShim.release(it.rec)
    }
    models = null
  }

  private fun load(detPath: String, recPath: String, dictPath: String): Models {
    val key = "$detPath|$recPath|$dictPath"
    models?.let { if (it.key == key) return it }
    unload()
    val threads = min(4, Runtime.getRuntime().availableProcessors())
    val chars = readDictionary(File(dictPath))
    val det = OrtShim.create(detPath, threads)
    val rec = try {
      OrtShim.create(recPath, threads)
    } catch (e: Exception) {
      OrtShim.release(det)
      throw e
    }
    return Models(det, rec, chars, key).also { models = it }
  }

  /**
   * The recognizer's characters, from the `character_dict:` list in the model's inference.yml
   * (YAML scalars: plain, or single-quoted with '' for '). Index 0 is the CTC blank; a space is
   * appended last, as PaddleOCR does.
   */
  private fun readDictionary(yml: File): List<String> {
    val out = arrayListOf("")
    var inDict = false
    yml.forEachLine { raw ->
      if (!inDict) {
        if (raw.trim() == "character_dict:") inDict = true
        return@forEachLine
      }
      if (!raw.startsWith("  - ")) {
        inDict = false
        return@forEachLine
      }
      var v = raw.substring(4)
      if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) v = v.substring(1, v.length - 1).replace("''", "'")
      out.add(v)
    }
    check(out.size > 1) { "no character_dict in ${yml.name}" }
    out.add(" ")
    return out
  }

  // --- Detection -------------------------------------------------------------------------------

  /** A rotated rectangle as 4 corners: top-left, top-right, bottom-right, bottom-left. */
  private class Quad(val x: FloatArray, val y: FloatArray)

  private fun detect(det: Long, img: Bitmap): List<Quad> {
    val s = min(1f, DET_EDGE.toFloat() / max(img.width, img.height))
    val rw = max(32, (img.width * s / 32f).roundToInt() * 32)
    val rh = max(32, (img.height * s / 32f).roundToInt() * 32)
    val small = Bitmap.createScaledBitmap(img, rw, rh, true)
    val px = IntArray(rw * rh)
    small.getPixels(px, 0, rw, 0, 0, rw, rh)
    if (small !== img) small.recycle()
    // NCHW, BGR channel order, ImageNet mean/std (PaddleOCR's det preprocessing on a BGR image).
    val plane = rw * rh
    val input = FloatArray(3 * plane)
    for (i in 0 until plane) {
      val c = px[i]
      input[i] = (((c and 0xff) / 255f) - 0.485f) / 0.229f
      input[plane + i] = ((((c shr 8) and 0xff) / 255f) - 0.456f) / 0.224f
      input[2 * plane + i] = ((((c shr 16) and 0xff) / 255f) - 0.406f) / 0.225f
    }
    // Output [1, 1, rh, rw]: probability that each pixel is text.
    val prob = OrtShim.run(det, input, longArrayOf(1, 3, rh.toLong(), rw.toLong()), LongArray(8))
    val sx = img.width.toFloat() / rw
    val sy = img.height.toFloat() / rh
    return boxesFromMap(prob, rw, rh).mapNotNull { q ->
      for (i in 0 until 4) {
        q.x[i] = (q.x[i] * sx).coerceIn(0f, img.width.toFloat())
        q.y[i] = (q.y[i] * sy).coerceIn(0f, img.height.toFloat())
      }
      val w = hypot(q.x[0] - q.x[1], q.y[0] - q.y[1])
      val h = hypot(q.x[0] - q.x[3], q.y[0] - q.y[3])
      if (w <= 3 || h <= 3) null else q
    }
  }

  /** DB postprocess: blobs of the thresholded map → min-area rectangles, scored and grown. */
  private fun boxesFromMap(prob: FloatArray, w: Int, h: Int): List<Quad> {
    val label = IntArray(w * h)
    val stack = IntArray(w * h)
    val rowMin = IntArray(h) { Int.MAX_VALUE }
    val rowMax = IntArray(h) { -1 }
    val out = ArrayList<Quad>()
    var comps = 0
    for (start in 0 until w * h) {
      if (prob[start] <= BIN_THRESH || label[start] != 0) continue
      if (++comps > MAX_BOXES) break
      // 8-connected flood fill; per row keep the leftmost / rightmost pixel (enough for the hull).
      var top = 0
      stack[top++] = start
      label[start] = comps
      var y0 = h
      var y1 = -1
      while (top > 0) {
        val p = stack[--top]
        val x = p % w
        val y = p / w
        if (y < y0) y0 = y
        if (y > y1) y1 = y
        if (x < rowMin[y]) rowMin[y] = x
        if (x > rowMax[y]) rowMax[y] = x
        for (dy in -1..1) {
          val ny = y + dy
          if (ny < 0 || ny >= h) continue
          for (dx in -1..1) {
            val nx = x + dx
            if (nx < 0 || nx >= w) continue
            val q = ny * w + nx
            if (label[q] == 0 && prob[q] > BIN_THRESH) {
              label[q] = comps
              stack[top++] = q
            }
          }
        }
      }
      val pts = ArrayList<FloatArray>()
      for (y in y0..y1) {
        if (rowMax[y] >= 0) {
          pts.add(floatArrayOf(rowMin[y].toFloat(), y.toFloat()))
          if (rowMax[y] != rowMin[y]) pts.add(floatArrayOf(rowMax[y].toFloat(), y.toFloat()))
        }
        rowMin[y] = Int.MAX_VALUE
        rowMax[y] = -1
      }
      val hull = convexHull(pts)
      if (hull.size < 3) continue
      val r = minAreaRect(hull) ?: continue
      if (min(r.w, r.h) < 3) continue
      if (boxScore(prob, w, h, r) < BOX_THRESH) continue
      val d = r.w * r.h * UNCLIP / (2 * (r.w + r.h))
      val grown = Rect(r.cx, r.cy, r.ux, r.uy, r.w + 2 * d, r.h + 2 * d)
      if (min(grown.w, grown.h) < 5) continue
      out.add(orderCorners(grown))
    }
    return out
  }

  /** Centre, unit axis u (along w; v = (-uy, ux) along h), side lengths. */
  private class Rect(val cx: Float, val cy: Float, val ux: Float, val uy: Float, val w: Float, val h: Float)

  private fun convexHull(points: List<FloatArray>): List<FloatArray> {
    val pts = points.sortedWith(compareBy<FloatArray> { it[0] }.thenBy { it[1] })
    if (pts.size < 3) return pts
    fun cross(o: FloatArray, a: FloatArray, b: FloatArray) =
      (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    val lower = ArrayList<FloatArray>()
    for (p in pts) {
      while (lower.size >= 2 && cross(lower[lower.size - 2], lower[lower.size - 1], p) <= 0) lower.removeAt(lower.size - 1)
      lower.add(p)
    }
    val upper = ArrayList<FloatArray>()
    for (p in pts.asReversed()) {
      while (upper.size >= 2 && cross(upper[upper.size - 2], upper[upper.size - 1], p) <= 0) upper.removeAt(upper.size - 1)
      upper.add(p)
    }
    lower.removeAt(lower.size - 1)
    upper.removeAt(upper.size - 1)
    return lower + upper
  }

  /** Rotating calipers: the smallest-area rectangle has a side along one hull edge. */
  private fun minAreaRect(hull: List<FloatArray>): Rect? {
    var best: Rect? = null
    var bestArea = Float.MAX_VALUE
    for (i in hull.indices) {
      val p = hull[i]
      val q = hull[(i + 1) % hull.size]
      val len = hypot(q[0] - p[0], q[1] - p[1])
      if (len == 0f) continue
      val ux = (q[0] - p[0]) / len
      val uy = (q[1] - p[1]) / len
      var aMin = Float.MAX_VALUE; var aMax = -Float.MAX_VALUE
      var bMin = Float.MAX_VALUE; var bMax = -Float.MAX_VALUE
      for (pt in hull) {
        val a = pt[0] * ux + pt[1] * uy
        val b = -pt[0] * uy + pt[1] * ux
        aMin = min(aMin, a); aMax = max(aMax, a)
        bMin = min(bMin, b); bMax = max(bMax, b)
      }
      val area = (aMax - aMin) * (bMax - bMin)
      if (area < bestArea) {
        bestArea = area
        val ca = (aMax + aMin) / 2
        val cb = (bMax + bMin) / 2
        best = Rect(ca * ux - cb * uy, ca * uy + cb * ux, ux, uy, aMax - aMin, bMax - bMin)
      }
    }
    return best
  }

  /** Mean probability inside the rectangle (PaddleOCR's "fast" box score). */
  private fun boxScore(prob: FloatArray, w: Int, h: Int, r: Rect): Float {
    val q = orderCorners(r)
    val x0 = max(0, floor(q.x.min()).toInt())
    val x1 = min(w - 1, ceil(q.x.max()).toInt())
    val y0 = max(0, floor(q.y.min()).toInt())
    val y1 = min(h - 1, ceil(q.y.max()).toInt())
    var sum = 0.0
    var n = 0
    for (y in y0..y1) for (x in x0..x1) {
      val dx = x - r.cx
      val dy = y - r.cy
      if (kotlin.math.abs(dx * r.ux + dy * r.uy) <= r.w / 2 + 0.5f &&
        kotlin.math.abs(-dx * r.uy + dy * r.ux) <= r.h / 2 + 0.5f
      ) {
        sum += prob[y * w + x]
        n++
      }
    }
    return if (n == 0) 0f else (sum / n).toFloat()
  }

  /** PaddleOCR's get_mini_boxes order: by x, then the upper of each pair first. */
  private fun orderCorners(r: Rect): Quad {
    val vx = -r.uy
    val vy = r.ux
    val pts = listOf(-1f to -1f, 1f to -1f, 1f to 1f, -1f to 1f).map { (a, b) ->
      floatArrayOf(r.cx + a * r.w / 2 * r.ux + b * r.h / 2 * vx, r.cy + a * r.w / 2 * r.uy + b * r.h / 2 * vy)
    }.sortedBy { it[0] }
    val (tl, bl) = if (pts[0][1] <= pts[1][1]) pts[0] to pts[1] else pts[1] to pts[0]
    val (tr, br) = if (pts[2][1] <= pts[3][1]) pts[2] to pts[3] else pts[3] to pts[2]
    return Quad(floatArrayOf(tl[0], tr[0], br[0], bl[0]), floatArrayOf(tl[1], tr[1], br[1], bl[1]))
  }

  /** Top to bottom, then left to right within ~10 px rows (PaddleOCR's sorted_boxes). */
  private fun sortBoxes(boxes: List<Quad>): List<Quad> {
    val b = boxes.sortedWith(compareBy<Quad> { it.y[0] }.thenBy { it.x[0] }).toMutableList()
    for (i in 0 until b.size - 1) {
      var j = i
      while (j >= 0 && kotlin.math.abs(b[j + 1].y[0] - b[j].y[0]) < 10 && b[j + 1].x[0] < b[j].x[0]) {
        val t = b[j]; b[j] = b[j + 1]; b[j + 1] = t
        j--
      }
    }
    return b
  }

  // --- Recognition -----------------------------------------------------------------------------

  /** Straightens the box into its own bitmap; tall boxes are turned 90° counter-clockwise. */
  private fun cropBox(img: Bitmap, q: Quad): Bitmap? {
    val w = max(hypot(q.x[0] - q.x[1], q.y[0] - q.y[1]), hypot(q.x[2] - q.x[3], q.y[2] - q.y[3])).toInt()
    val h = max(hypot(q.x[0] - q.x[3], q.y[0] - q.y[3]), hypot(q.x[1] - q.x[2], q.y[1] - q.y[2])).toInt()
    if (w < 1 || h < 1) return null
    val src = floatArrayOf(q.x[0], q.y[0], q.x[1], q.y[1], q.x[2], q.y[2], q.x[3], q.y[3])
    val tall = h.toFloat() / w >= 1.5f
    val fw = w.toFloat()
    val fh = h.toFloat()
    val dst =
      if (tall) floatArrayOf(0f, fw, 0f, 0f, fh, 0f, fh, fw)
      else floatArrayOf(0f, 0f, fw, 0f, fw, fh, 0f, fh)
    val m = Matrix()
    if (!m.setPolyToPoly(src, 0, dst, 0, 4)) return null
    val out = if (tall) Bitmap.createBitmap(h, w, Bitmap.Config.ARGB_8888) else Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    Canvas(out).drawBitmap(img, m, Paint(Paint.FILTER_BITMAP_FLAG))
    return out
  }

  private fun recognize(rec: Long, chars: List<String>, crop: Bitmap): Line? {
    val rw = min(REC_MAX_W, ceil(REC_H * crop.width.toFloat() / crop.height).toInt()).coerceAtLeast(1)
    val inW = max(REC_MIN_W, rw)
    val scaled = Bitmap.createScaledBitmap(crop, rw, REC_H, true)
    val px = IntArray(rw * REC_H)
    scaled.getPixels(px, 0, rw, 0, 0, rw, REC_H)
    if (scaled !== crop) scaled.recycle()
    // NCHW BGR, (x/255 - 0.5)/0.5, zero-padded on the right to at least 320 px.
    val plane = REC_H * inW
    val input = FloatArray(3 * plane)
    for (y in 0 until REC_H) for (x in 0 until rw) {
      val c = px[y * rw + x]
      val i = y * inW + x
      input[i] = (c and 0xff) / 127.5f - 1f
      input[plane + i] = ((c shr 8) and 0xff) / 127.5f - 1f
      input[2 * plane + i] = ((c shr 16) and 0xff) / 127.5f - 1f
    }
    val shape = LongArray(8) // rank, then [1, steps, classes]
    val probs = OrtShim.run(rec, input, longArrayOf(1, 3, REC_H.toLong(), inW.toLong()), shape)
    if (shape[0] != 3L) return null
    return ctcDecode(probs, shape[2].toInt(), shape[3].toInt(), chars)
  }

  /** Greedy CTC: best class per step, repeats merged, blanks dropped; score = mean kept prob. */
  private fun ctcDecode(p: FloatArray, steps: Int, classes: Int, chars: List<String>): Line {
    val sb = StringBuilder()
    var sum = 0f
    var n = 0
    var prev = -1
    for (t in 0 until steps) {
      var best = 0
      var bestP = p[t * classes]
      for (c in 1 until classes) {
        val v = p[t * classes + c]
        if (v > bestP) { bestP = v; best = c }
      }
      if (best != prev && best != 0 && best < chars.size) {
        sb.append(chars[best])
        sum += bestP
        n++
      }
      prev = best
    }
    return Line(sb.toString(), if (n == 0) 0f else sum / n)
  }
}

/** Which read was the last one: a delayed idle check only acts if no read happened since. Not thread-safe; guard it. */
class IdleToken {
  private var latest = 0L
  fun used(): Long = ++latest
  fun isLatest(token: Long) = token == latest
}
