package dev.sidekick.engine.camera

import android.graphics.Bitmap
import android.view.Surface
import java.io.File

/** One sampled camera frame, already upright. Owned by the receiver after the callback. */
class Frame(val atMs: Long, val bitmap: Bitmap)

/** Where a source draws video for recording (an encoder's input surface). */
interface VideoSink {
  /** Called by the source when its video size is known; draw frames into the returned surface. */
  fun open(width: Int, height: Int, rotationDegrees: Int): Surface

  /** The source has stopped drawing into the surface. */
  fun close()
}

/**
 * A camera: the phone's own (PhoneCameraSource) or a USB UVC camera. Started and stopped on any
 * thread; frames arrive on the source's own thread at no more than [CaptureConfig.sampleFps].
 */
interface FrameSource {
  fun start(onFrame: (Frame) -> Unit)

  fun stop()

  /** Video target, set before [start]; null = don't record. */
  var videoSink: VideoSink?
    get() = null
    set(@Suppress("UNUSED_PARAMETER") value) {}

  /**
   * Saves a full-resolution still (text or a number plate was seen) to [file]; [done] says whether
   * it worked. Sources without a separate still path return false and the frame itself is kept.
   */
  fun takeStill(file: File, done: (Boolean) -> Unit) = done(false)

  /** Called when the source can't continue (USB unplugged, camera taken by another app). */
  var onLost: ((reason: String) -> Unit)?
    get() = null
    set(@Suppress("UNUSED_PARAMETER") value) {}
}
