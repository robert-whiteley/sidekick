package dev.sidekick.engine.usb

/**
 * One camera frame in NV21 (Y plane then interleaved VU), the format both CameraX analysis
 * (after conversion) and the UVC library hand over. `data` is reused between frames: copy it if
 * it must outlive the callback.
 *
 * Matches the FrameSource contract the live camera pipeline (engine/camera) expects; if that
 * package defines its own `Frame`/`FrameSource`, adapt with a one-line wrapper.
 */
class Frame(
  val data: ByteArray,
  val width: Int,
  val height: Int,
  val timestampNs: Long,
  /** "usb" or "phone". */
  val source: String,
)

interface FrameSource {
  fun start(onFrame: (Frame) -> Unit)

  fun stop()

  /** No picture in the current mode: switch to the next one for the next [start]; false = none left. */
  fun nextMode(): Boolean = false
}
