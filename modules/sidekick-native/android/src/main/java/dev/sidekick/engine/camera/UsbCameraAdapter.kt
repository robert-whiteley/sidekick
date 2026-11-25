package dev.sidekick.engine.camera

import android.graphics.Bitmap
import android.graphics.Rect
import android.util.Log
import android.view.Surface
import dev.sidekick.engine.usb.FrameSource as UsbFrameSource

/**
 * Runs a USB camera (engine/usb, NV21 frames) as a live-capture source: frames for memory at
 * [Rates.sampleFps], and video drawn into the encoder's surface at [Rates.videoFps].
 */
class UsbCameraAdapter(private val usb: UsbFrameSource, private val rates: Rates) : FrameSource {
  override var videoSink: VideoSink? = null
  override var onLost: ((String) -> Unit)? = null

  @Volatile private var stopped = false
  private var surface: Surface? = null
  private var surfaceSize = 0 to 0
  private var lastSampleAt = 0L
  private var lastVideoAt = 0L
  private var pixels = IntArray(0)

  override fun start(onFrame: (Frame) -> Unit) {
    stopped = false
    val sampleMs = (1000f / rates.sampleFps.coerceAtLeast(0.05f)).toLong()
    val videoMs = if (rates.recordVideo && rates.videoFps > 0) 1000L / rates.videoFps else Long.MAX_VALUE
    try {
      usb.start { f ->
        if (stopped) return@start
        val now = System.currentTimeMillis()
        val wantSample = now - lastSampleAt >= sampleMs
        val wantVideo = videoSink != null && now - lastVideoAt >= videoMs
        if (!wantSample && !wantVideo) return@start
        val bmp = toBitmap(f.data, f.width, f.height)
        if (wantVideo) {
          lastVideoAt = now
          drawVideo(bmp)
        }
        if (wantSample) {
          lastSampleAt = now
          onFrame(Frame(now, bmp))
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "USB camera failed", e)
      onLost?.invoke("USB camera failed: ${e.message}")
    }
  }

  override fun stop() {
    stopped = true
    usb.stop()
    synchronized(this) {
      if (surface != null) videoSink?.close()
      surface = null
    }
  }

  @Synchronized
  private fun drawVideo(bmp: Bitmap) {
    val sink = videoSink ?: return
    if (surface == null || surfaceSize != bmp.width to bmp.height) {
      if (surface != null) sink.close()
      surface = runCatching { sink.open(bmp.width, bmp.height, 0) }.getOrNull() ?: return
      surfaceSize = bmp.width to bmp.height
    }
    val s = surface ?: return
    runCatching {
      val c = s.lockHardwareCanvas()
      c.drawBitmap(bmp, null, Rect(0, 0, bmp.width, bmp.height), null)
      s.unlockCanvasAndPost(c)
    }
  }

  private fun toBitmap(nv21: ByteArray, w: Int, h: Int): Bitmap {
    if (pixels.size != w * h) pixels = IntArray(w * h)
    Nv21.toArgb(nv21, w, h, pixels)
    return Bitmap.createBitmap(pixels, w, h, Bitmap.Config.ARGB_8888)
  }

  private companion object {
    const val TAG = "SidekickUsbCapture"
  }
}

/** NV21 (Y plane, then interleaved V/U at half resolution) to ARGB (BT.601, full range). Pure. */
object Nv21 {
  fun toArgb(data: ByteArray, w: Int, h: Int, out: IntArray) {
    val frame = w * h
    for (y in 0 until h) {
      val uvRow = frame + (y shr 1) * w
      for (x in 0 until w) {
        val yy = (data[y * w + x].toInt() and 0xff)
        val uvi = uvRow + (x and 1.inv())
        val v = (data[uvi].toInt() and 0xff) - 128
        val u = (data[uvi + 1].toInt() and 0xff) - 128
        val r = clamp(yy + ((1436 * v) shr 10))
        val g = clamp(yy - ((352 * u + 731 * v) shr 10))
        val b = clamp(yy + ((1815 * u) shr 10))
        out[y * w + x] = (0xff shl 24) or (r shl 16) or (g shl 8) or b
      }
    }
  }

  private fun clamp(v: Int) = if (v < 0) 0 else if (v > 255) 255 else v
}
