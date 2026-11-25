package dev.sidekick.engine.usb

import android.graphics.PixelFormat
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
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
  // UVCAndroid only runs its capture thread with a preview window: an off-screen one that drops
  // every picture (frames for memory come from the frame callback).
  private var sink: ImageReader? = null
  private var sinkThread: HandlerThread? = null

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
    val thread = HandlerThread("uvc-sink").apply { start() }
    val reader = ImageReader.newInstance(w, h, PixelFormat.RGBX_8888, 2)
    reader.setOnImageAvailableListener({ r -> runCatching { r.acquireLatestImage()?.close() } }, Handler(thread.looper))
    sink = reader
    sinkThread = thread
    cam.setPreviewDisplay(reader.surface)
    cam.startPreview()
    autoControls(cam)
    Log.i(TAG, "USB camera started: $mode")
    camera = cam
  }

  /**
   * Hands exposure, focus and white balance back to the camera. UVC settings live in the camera
   * and survive between apps and opens, so a camera left in manual exposure gives dark frames.
   */
  private fun autoControls(cam: UVCCamera) {
    val c = cam.control ?: return
    runCatching {
      if (c.isAutoExposureModeEnable) {
        val now = c.autoExposureMode
        val res = runCatching { c.updateAutoExposureModeLimit()?.getOrNull(1) ?: 0 }.getOrDefault(0)
        Log.i(TAG, "exposure mode $now (supported $res), time ${runCatching { c.exposureTimeAbsolute }.getOrNull()}, " +
          "brightness ${runCatching { c.brightness }.getOrNull()}, gain ${runCatching { c.gain }.getOrNull()}")
        UvcLogic.autoExposureMode(now, res)?.let {
          c.autoExposureMode = it
          Log.i(TAG, "exposure mode $now -> $it")
        }
      }
    }.onFailure { Log.w(TAG, "auto exposure", it) }
    // Picture controls back to the camera's own defaults (Sidekick never changes them, so any
    // other value was left by something else, e.g. brightness at its minimum = black frames).
    runCatching {
      fun lim(f: () -> IntArray?) = runCatching { f()?.joinToString("/") }.getOrNull()
      Log.i(TAG, "picture: brightness ${c.brightness} [${lim { c.updateBrightnessLimit() }}], " +
        "contrast ${runCatching { c.contrast }.getOrNull()} [${lim { c.updateContrastLimit() }}], " +
        "gamma ${runCatching { c.gamma }.getOrNull()} [${lim { c.updateGammaLimit() }}], " +
        "gain ${runCatching { c.gain }.getOrNull()} [${lim { c.updateGainLimit() }}], " +
        "backlight ${runCatching { c.backlightComp }.getOrNull()}, privacy ${runCatching { c.privacy }.getOrNull()}")
    }
    for ((name, reset) in listOf<Pair<String, () -> Unit>>(
      "brightness" to c::resetBrightness, "contrast" to c::resetContrast, "gamma" to c::resetGamma,
      "gain" to c::resetGain, "saturation" to c::resetSaturation, "sharpness" to c::resetSharpness,
      "backlight" to c::resetBacklightComp,
    )) runCatching { reset() }.onFailure { Log.w(TAG, "reset $name", it) }
    // Privacy shutter off explicitly ("reset" would apply the camera's default, which can be on).
    runCatching { if (c.isPrivacyEnable && c.privacy) c.privacy = false }.onFailure { Log.w(TAG, "privacy", it) }
    runCatching { Log.i(TAG, "picture after reset: brightness ${c.brightness}, gain ${c.gain}, privacy ${c.privacy}") }
    runCatching { if (c.isFocusAutoEnable && !c.focusAuto) c.focusAuto = true }.onFailure { Log.w(TAG, "auto focus", it) }
    runCatching { if (c.isWhiteBalanceAutoEnable && !c.whiteBalanceAuto) c.whiteBalanceAuto = true }
      .onFailure { Log.w(TAG, "auto white balance", it) }
  }

  @Synchronized
  override fun stop() {
    val cam = camera ?: return
    camera = null
    runCatching { cam.setFrameCallback(null, 0) }
    runCatching { cam.stopPreview() }
    runCatching { cam.destroy() }
    runCatching { sink?.close() }
    sinkThread?.quitSafely()
    sink = null
    sinkThread = null
  }

  private companion object {
    const val TAG = "SidekickUvc"
  }
}
