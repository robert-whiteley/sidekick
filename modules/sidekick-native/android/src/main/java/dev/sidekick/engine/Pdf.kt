package dev.sidekick.engine

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.graphics.pdf.PdfRendererPreV
import android.graphics.pdf.RenderParams
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.ext.SdkExtensions
import java.io.IOException
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Reads PDFs from picked folders with the phone's own PDF engine (pdfium inside Android), so no
 * library is added. Embedded text comes from `getTextContents()` (Android 15+, or Android 11–14
 * with the S-extension 13 update via [PdfRendererPreV]); older phones get no embedded text and
 * every page is OCR'd instead. Scanned pages are rendered at [RENDER_EDGE] px for [Ocr].
 * One page at a time; the document is opened per call.
 */
object Pdf {
  /** Longest edge a page is rendered at for OCR (A4 → ~1130×1600, ~140 dpi). */
  private const val RENDER_EDGE = 1600

  private val mode: Int by lazy {
    when {
      Build.VERSION.SDK_INT >= 35 -> 2
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
        SdkExtensions.getExtensionVersion(Build.VERSION_CODES.S) >= 13 -> 1
      else -> 0
    }
  }

  /** Whether this phone can read a PDF's embedded text (otherwise pages are OCR'd). */
  val canReadText: Boolean get() = mode > 0

  private interface Page {
    val width: Int
    val height: Int
    fun text(): String?
    fun render(bitmap: Bitmap, transform: Matrix)
  }

  private fun fd(context: Context, uri: String): ParcelFileDescriptor {
    val u = Uri.parse(uri)
    return if (u.scheme == null || u.scheme == "file") {
      ParcelFileDescriptor.open(java.io.File(u.path ?: uri), ParcelFileDescriptor.MODE_READ_ONLY)
    } else {
      context.contentResolver.openFileDescriptor(u, "r") ?: throw IOException("can't open $uri")
    }
  }

  /** The renderers own the descriptor once made; if making one fails, close it here. */
  private inline fun <R> opened(f: ParcelFileDescriptor, make: () -> R): R =
    try {
      make()
    } catch (e: Exception) {
      f.close()
      throw e
    }

  /** Opens [uri], gives [block] the page count and page [index] (null if it has none), then closes everything. */
  @SuppressLint("NewApi")
  private fun <T> withPage(context: Context, uri: String, index: Int, block: (Int, Page?) -> T): T {
    val f = fd(context, uri)
    if (mode == 1) {
      opened(f) { PdfRendererPreV(f) }.use { r ->
        if (r.pageCount == 0) return block(0, null)
        require(index in 0 until r.pageCount) { "page $index of ${r.pageCount}" }
        r.openPage(index).use { p ->
          return block(r.pageCount, object : Page {
            override val width = p.width
            override val height = p.height
            override fun text() = p.textContents.joinToString("\n") { it.text }
            override fun render(bitmap: Bitmap, transform: Matrix) =
              p.render(bitmap, null, transform, RenderParams.Builder(RenderParams.RENDER_MODE_FOR_DISPLAY).build())
          })
        }
      }
    }
    opened(f) { PdfRenderer(f) }.use { r ->
      if (r.pageCount == 0) return block(0, null)
      require(index in 0 until r.pageCount) { "page $index of ${r.pageCount}" }
      r.openPage(index).use { p ->
        return block(r.pageCount, object : Page {
          override val width = p.width
          override val height = p.height
          override fun text() = if (mode == 2) p.textContents.joinToString("\n") { it.text } else null
          override fun render(bitmap: Bitmap, transform: Matrix) =
            p.render(bitmap, null, transform, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        })
      }
    }
  }

  /** Page count and page [index]'s embedded text (null when this phone can't read PDF text). */
  fun pageText(context: Context, uri: String, index: Int): Pair<Int, String?> =
    withPage(context, uri, index) { count, page -> count to page?.text() }

  /** Page [index] on white, [RENDER_EDGE] px on its long edge. The caller recycles it. */
  fun renderPage(context: Context, uri: String, index: Int): Bitmap =
    withPage(context, uri, index) { _, p ->
      val page = p ?: throw IllegalArgumentException("no pages")
      // Page sizes are in points (1/72 inch).
      val s = RENDER_EDGE.toFloat() / max(1, max(page.width, page.height))
      val w = max(1, (page.width * s).roundToInt())
      val h = max(1, (page.height * s).roundToInt())
      val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      // Pages are transparent where nothing is drawn; OCR expects dark text on white.
      bmp.eraseColor(Color.WHITE)
      page.render(bmp, Matrix().apply { setScale(s, s) })
      bmp
    }
}
