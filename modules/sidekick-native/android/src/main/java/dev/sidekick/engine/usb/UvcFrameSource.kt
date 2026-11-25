package dev.sidekick.engine.usb

import android.util.Log
import com.serenegiant.usb.IFrameCallback
import com.serenegiant.usb.USBMonitor
import com.serenegiant.usb.UVCCamera
import com.serenegiant.usb.UVCParam

/**
 * Frames from a USB (UVC) camera, NV21 at the closest mode to the wanted size and rate
 * (MJPEG preferred: raw 720p over USB 2 tops out near 10 fps). No preview surface is needed;
 * the screen preview, when shown, draws from these frames.
 */
class UvcFrameSource(
  private val block: USBMonitor.UsbControlBlock,
  private val width: Int = 1280,
  private val height: Int = 720,
  private val fps: Int = 10,
) : FrameSource {
  @Volatile private var camera: UVCCamera? = null

  /** The mode actually used, once started. */
  @Volatile var mode: UvcChoice? = null
    private set

  @Synchronized
  override fun start(onFrame: (Frame) -> Unit) {
    if (camera != null) return
    val cam = UVCCamera(UVCParam())
    val rc = cam.open(block)
    if (rc != 0) {
      cam.destroy()
      throw IllegalStateException("USB camera would not open ($rc)")
    }
    val modes =
      cam.supportedSizeList.orEmpty().map {
        UvcMode(it.type == UVCCamera.UVC_VS_FRAME_MJPEG, it.width, it.height, it.fpsList.orEmpty().ifEmpty { listOf(it.fps) })
      }
    val choice = UvcLogic.pick(modes, width, height, fps) ?: UvcChoice(true, width, height, fps)
    val type = if (choice.mjpeg) UVCCamera.UVC_VS_FRAME_MJPEG else UVCCamera.UVC_VS_FRAME_UNCOMPRESSED
    try {
      cam.setPreviewSize(choice.width, choice.height, type, choice.fps)
    } catch (e: Exception) {
      Log.w(TAG, "mode $choice refused, using the camera default", e)
      cam.setPreviewSize(UVCCamera.DEFAULT_PREVIEW_WIDTH, UVCCamera.DEFAULT_PREVIEW_HEIGHT)
    }
    val size = cam.previewSize
    val w = size?.width ?: choice.width
    val h = size?.height ?: choice.height
    mode = choice.copy(width = w, height = h)
    var buf = ByteArray(w * h * 3 / 2)
    cam.setFrameCallback(
      IFrameCallback { bb ->
        val n = bb.remaining()
        if (buf.size != n) buf = ByteArray(n)
        bb.get(buf, 0, n)
        onFrame(Frame(buf, w, h, System.nanoTime(), "usb"))
      },
      UVCCamera.PIXEL_FORMAT_NV21,
    )
    cam.startPreview()
    camera = cam
  }

  @Synchronized
  override fun stop() {
    val cam = camera ?: return
    camera = null
    runCatching { cam.setFrameCallback(null, 0) }
    runCatching { cam.stopPreview() }
    runCatching { cam.destroy() }
  }

  private companion object {
    const val TAG = "SidekickUvc"
  }
}
