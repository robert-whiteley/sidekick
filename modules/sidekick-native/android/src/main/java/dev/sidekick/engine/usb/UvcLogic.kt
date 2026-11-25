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
