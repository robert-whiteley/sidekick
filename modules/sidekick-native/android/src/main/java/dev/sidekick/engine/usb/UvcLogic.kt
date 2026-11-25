package dev.sidekick.engine.usb

/** A mode a UVC camera offers. `mjpeg` modes need far less USB bandwidth than raw YUYV. */
data class UvcMode(val mjpeg: Boolean, val width: Int, val height: Int, val fps: List<Int>)

data class UvcChoice(val mjpeg: Boolean, val width: Int, val height: Int, val fps: Int)

/** Pure choices for the USB camera (unit-tested on the JVM). */
object UvcLogic {
  /** USB interface class for video (UVC). */
  const val USB_CLASS_VIDEO = 14

  /**
   * Best mode for the wanted size and frame rate: the exact size if offered, else the smallest
   * mode at least as big, else the biggest one below; MJPEG over YUYV at the same size; then the
   * lowest offered rate at or above the wanted rate (or the highest below it).
   */
  fun pick(modes: List<UvcMode>, width: Int, height: Int, fps: Int): UvcChoice? {
    val usable = modes.filter { it.width > 0 && it.height > 0 }
    if (usable.isEmpty()) return null
    fun area(m: UvcMode) = m.width.toLong() * m.height
    val big = usable.filter { it.width >= width && it.height >= height }
    val sized =
      if (big.isNotEmpty()) big.filter { area(it) == big.minOf(::area) }
      else usable.filter { area(it) == usable.maxOf(::area) }
    val atSize = sized.filter { m -> m.width == sized[0].width && m.height == sized[0].height }
    val mode = atSize.firstOrNull { it.mjpeg } ?: atSize[0]
    val rates = mode.fps.filter { it > 0 }
    val rate =
      when {
        rates.isEmpty() -> fps
        rates.any { it >= fps } -> rates.filter { it >= fps }.min()
        else -> rates.max()
      }
    return UvcChoice(mode.mjpeg, mode.width, mode.height, rate)
  }

  /** UVC auto-exposure modes (one bit each; GET_RES returns the supported ones as a bitmap). */
  const val AE_MANUAL = 1
  const val AE_AUTO = 2
  const val AE_SHUTTER = 4
  const val AE_APERTURE = 8

  /**
   * The exposure mode to switch to so the camera adjusts to the light itself, or null to leave it.
   * A camera can come back from a replug (or another app) in manual or shutter-priority mode with
   * a tiny fixed exposure: dark frames whatever it points at. Aperture priority is what fixed-iris
   * webcams call "auto"; full auto when only that is offered. [supported] 0 = unknown.
   */
  fun autoExposureMode(current: Int, supported: Int): Int? {
    if (current == AE_AUTO || current == AE_APERTURE) return null
    // A "supported" value that doesn't even include the current mode isn't a bitmap: ignore it.
    val known = if (supported and current == 0) 0 else supported
    fun has(m: Int) = known == 0 || known and m != 0
    return when {
      has(AE_APERTURE) -> AE_APERTURE
      has(AE_AUTO) -> AE_AUTO
      else -> null
    }
  }

  /** Whether a device's interface classes include video (a UVC camera, alone or composite). */
  fun isCamera(interfaceClasses: List<Int>): Boolean = USB_CLASS_VIDEO in interfaceClasses

  /** Short display name: product name if the device gives one, else "USB camera". */
  fun displayName(product: String?, manufacturer: String?): String {
    val p = product?.trim().orEmpty()
    val m = manufacturer?.trim().orEmpty()
    return when {
      p.isNotEmpty() && m.isNotEmpty() && !p.startsWith(m, ignoreCase = true) -> "$m $p"
      p.isNotEmpty() -> p
      else -> "USB camera"
    }
  }
}
