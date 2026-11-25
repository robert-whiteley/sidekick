package dev.sidekick.engine.usb

/** A mode a UVC camera offers. `mjpeg` modes need far less USB bandwidth than raw YUYV. */
data class UvcMode(val mjpeg: Boolean, val width: Int, val height: Int, val fps: List<Int>)

/** The camera's Video Control interface number, Camera Terminal id and its control bits. */
data class UvcTerminal(val iface: Int, val id: Int, val controls: Long)

data class UvcChoice(val mjpeg: Boolean, val width: Int, val height: Int, val fps: Int)

/** Pure choices for the USB camera (unit-tested on the JVM). */
object UvcLogic {
  /** USB interface class for video (UVC). */
  const val USB_CLASS_VIDEO = 14

  /**
   * A camera finished opening while [current] (device name) is held: true = use the new one
   * (dropping the old). Keeps the held camera only when it is the same device opening again, so a
   * camera swapped in after the old one stopped sending isn't ignored until the app restarts.
   */
  fun replaceOnOpen(current: String?, opened: String): Boolean = current != opened

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

  /**
   * Modes to try in turn when a camera opens but sends nothing: the best match, then MJPEG at
   * 640x480, then uncompressed at 640x480 (some cameras or links only manage the smaller or raw
   * streams). Duplicates dropped.
   */
  fun fallbacks(modes: List<UvcMode>, width: Int, height: Int, fps: Int): List<UvcChoice> =
    listOfNotNull(
      pick(modes, width, height, fps),
      pick(modes.filter { it.mjpeg }, 640, 480, fps),
      pick(modes.filter { !it.mjpeg }, 640, 480, fps),
    ).distinct()

  /** Camera Terminal control selector and bmControls bit for the privacy shutter (UVC 1.5, 4.2.2.1.18). */
  const val CT_PRIVACY = 0x11
  const val CT_PRIVACY_BIT = 18

  /** The camera terminal from the raw USB descriptors (null if the camera doesn't describe one). */
  fun cameraTerminal(raw: ByteArray): UvcTerminal? {
    var i = 0
    var vcIface = -1
    while (i + 2 < raw.size) {
      val len = raw[i].toInt() and 0xff
      if (len < 2 || i + len > raw.size) break
      val type = raw[i + 1].toInt() and 0xff
      if (type == 0x04 && len >= 9) {
        // Interface: Video (14) / Control (1).
        vcIface = if ((raw[i + 5].toInt() and 0xff) == USB_CLASS_VIDEO && (raw[i + 6].toInt() and 0xff) == 1) raw[i + 2].toInt() and 0xff else -1
      } else if (type == 0x24 && vcIface >= 0 && len >= 15 && (raw[i + 2].toInt() and 0xff) == 0x02) {
        // VC input terminal of type camera (0x0201).
        val termType = (raw[i + 4].toInt() and 0xff) or ((raw[i + 5].toInt() and 0xff) shl 8)
        if (termType == 0x0201) {
          val size = raw[i + 14].toInt() and 0xff
          var bits = 0L
          for (b in 0 until minOf(size, 8)) if (i + 15 + b < i + len) bits = bits or ((raw[i + 15 + b].toLong() and 0xff) shl (8 * b))
          return UvcTerminal(vcIface, raw[i + 3].toInt() and 0xff, bits)
        }
      }
      i += len
    }
    return null
  }

  /** The Video Streaming interface number (class 14 / subclass 2), or -1. */
  fun streamingInterface(raw: ByteArray): Int {
    var i = 0
    while (i + 2 < raw.size) {
      val len = raw[i].toInt() and 0xff
      if (len < 2 || i + len > raw.size) break
      if ((raw[i + 1].toInt() and 0xff) == 0x04 && len >= 9 && (raw[i + 5].toInt() and 0xff) == USB_CLASS_VIDEO &&
        (raw[i + 6].toInt() and 0xff) == 2) return raw[i + 2].toInt() and 0xff
      i += len
    }
    return -1
  }

  /**
   * One line about the camera from its raw descriptors, for support/warranty logs: ids, firmware
   * (bcdDevice), USB version, and the largest isochronous packet the video endpoint offers.
   */
  fun describe(raw: ByteArray): String {
    fun u16(at: Int) = if (at + 1 < raw.size) (raw[at].toInt() and 0xff) or ((raw[at + 1].toInt() and 0xff) shl 8) else -1
    if (raw.size < 18 || raw[1].toInt() != 1) return "no device descriptor"
    var maxIso = 0
    var i = 0
    while (i + 2 < raw.size) {
      val len = raw[i].toInt() and 0xff
      if (len < 2 || i + len > raw.size) break
      // Endpoint, isochronous: packet size bits 0-10 times (1 + extra transactions, bits 11-12).
      if ((raw[i + 1].toInt() and 0xff) == 0x05 && len >= 7 && (raw[i + 3].toInt() and 0x03) == 1) {
        val w = u16(i + 4)
        maxIso = maxOf(maxIso, (w and 0x7ff) * (1 + ((w shr 11) and 0x3)))
      }
      i += len
    }
    return "usb %04x:%04x firmware %x.%02x usb %x.%02x video-interface %d max-iso-packet %d".format(
      u16(8), u16(10), u16(12) shr 8, u16(12) and 0xff, u16(2) shr 8, u16(2) and 0xff, streamingInterface(raw), maxIso,
    )
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
