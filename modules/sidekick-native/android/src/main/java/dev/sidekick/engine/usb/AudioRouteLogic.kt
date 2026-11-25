package dev.sidekick.engine.usb

/** A connected audio input or output, reduced to what choosing needs. */
data class AudioPort(
  /** AudioDeviceInfo id: changes when the device is reconnected. */
  val id: Int,
  /** "usb", "wired", "bluetooth" or "phone". */
  val kind: String,
  val name: String,
  val input: Boolean,
) {
  /** Stable across reconnects; what a user's choice is saved as. */
  val key: String get() = "$kind:$name"
}

/**
 * Which input and output to use. Pure (unit-tested on the JVM).
 *
 * Inputs for listening (conversation around you): USB mic (the camera's) > wired headset >
 * phone mic. A Bluetooth mic is used only to ask (button press): keeping it open means the
 * narrow-band call link, which stops music and drains the earbuds, and it only hears the wearer.
 * Inputs for asking: USB > wired > Bluetooth > phone.
 * Outputs: wired > Bluetooth > USB > phone speaker.
 */
object AudioRouteLogic {
  private val LISTEN_INPUT = listOf("usb", "wired", "phone")
  private val ASK_INPUT = listOf("usb", "wired", "bluetooth", "phone")
  private val OUTPUT = listOf("wired", "bluetooth", "usb", "phone")

  fun inputKind(type: Int): String? =
    when (type) {
      TYPE_USB_DEVICE, TYPE_USB_HEADSET, TYPE_USB_ACCESSORY -> "usb"
      TYPE_WIRED_HEADSET -> "wired"
      TYPE_BLUETOOTH_SCO, TYPE_BLE_HEADSET -> "bluetooth"
      TYPE_BUILTIN_MIC -> "phone"
      else -> null
    }

  fun outputKind(type: Int): String? =
    when (type) {
      TYPE_WIRED_HEADSET, TYPE_WIRED_HEADPHONES -> "wired"
      TYPE_BLUETOOTH_A2DP, TYPE_BLE_HEADSET, TYPE_BLE_SPEAKER, TYPE_HEARING_AID -> "bluetooth"
      TYPE_USB_DEVICE, TYPE_USB_HEADSET -> "usb"
      TYPE_BUILTIN_SPEAKER -> "phone"
      else -> null
    }

  /**
   * The port to use: the user's saved choice (by key) if it's connected, else the recommended
   * one. Null when nothing usable is connected (the system default then applies).
   */
  fun choose(ports: List<AudioPort>, input: Boolean, forAsk: Boolean, override: String?): AudioPort? {
    val mine = ports.filter { it.input == input }
    override?.let { key -> mine.firstOrNull { it.key == key }?.let { return it } }
    return recommended(mine, input, forAsk)
  }

  fun recommended(ports: List<AudioPort>, input: Boolean, forAsk: Boolean): AudioPort? {
    val order = if (!input) OUTPUT else if (forAsk) ASK_INPUT else LISTEN_INPUT
    return ports
      .filter { it.input == input && it.kind in order }
      .minByOrNull { order.indexOf(it.kind) }
  }

  /** Duplicate entries (one device listed per sample format/address) collapse to one per key. */
  fun dedupe(ports: List<AudioPort>): List<AudioPort> = ports.distinctBy { (if (it.input) "in:" else "out:") + it.key }

  // AudioDeviceInfo.TYPE_* values (stable platform constants), copied so this file has no
  // Android dependency.
  const val TYPE_BUILTIN_SPEAKER = 2
  const val TYPE_WIRED_HEADSET = 3
  const val TYPE_WIRED_HEADPHONES = 4
  const val TYPE_BLUETOOTH_SCO = 7
  const val TYPE_BLUETOOTH_A2DP = 8
  const val TYPE_USB_DEVICE = 11
  const val TYPE_USB_ACCESSORY = 12
  const val TYPE_BUILTIN_MIC = 15
  const val TYPE_USB_HEADSET = 22
  const val TYPE_HEARING_AID = 23
  const val TYPE_BLE_HEADSET = 26
  const val TYPE_BLE_SPEAKER = 27
}
