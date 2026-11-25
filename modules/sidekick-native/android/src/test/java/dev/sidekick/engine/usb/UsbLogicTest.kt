package dev.sidekick.engine.usb

import android.media.AudioDeviceInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UsbLogicTest {
  private val imx708 =
    listOf(
      UvcMode(false, 640, 480, listOf(30)),
      UvcMode(false, 1280, 720, listOf(10, 5)),
      UvcMode(true, 1280, 720, listOf(30, 15)),
      UvcMode(true, 1920, 1080, listOf(30)),
    )

  @Test fun picksMjpegAtExactSizeAndLowestRateAtOrAbove() {
    assertEquals(UvcChoice(true, 1280, 720, 15), UvcLogic.pick(imx708, 1280, 720, 10))
  }

  @Test fun picksNextBiggerSizeWhenExactMissing() {
    assertEquals(UvcChoice(true, 1920, 1080, 30), UvcLogic.pick(imx708, 1600, 900, 10))
  }

  @Test fun picksBiggestWhenAllSmaller() {
    val small = listOf(UvcMode(false, 320, 240, listOf(30)), UvcMode(false, 640, 480, listOf(5)))
    assertEquals(UvcChoice(false, 640, 480, 5), UvcLogic.pick(small, 1280, 720, 10))
  }

  @Test fun noModes() {
    assertNull(UvcLogic.pick(emptyList(), 1280, 720, 10))
  }

  @Test fun cameraDetectionAndName() {
    assertTrue(UvcLogic.isCamera(listOf(1, 14, 14)))
    assertFalse(UvcLogic.isCamera(listOf(1, 3)))
    assertEquals("Arducam IMX708", UvcLogic.displayName("IMX708", "Arducam"))
    assertEquals("Arducam IMX708", UvcLogic.displayName("Arducam IMX708", "Arducam"))
    assertEquals("USB camera", UvcLogic.displayName(null, " "))
  }

  private val phoneMic = AudioPort(1, "phone", "Phone mic", true)
  private val btMic = AudioPort(2, "bluetooth", "Pixel Buds", true)
  private val usbMic = AudioPort(3, "usb", "Arducam", true)
  private val wiredMic = AudioPort(4, "wired", "Headphones", true)
  private val speaker = AudioPort(5, "phone", "Phone speaker", false)
  private val buds = AudioPort(6, "bluetooth", "Pixel Buds", false)
  private val usbOut = AudioPort(7, "usb", "Arducam", false)

  @Test fun listeningInputSkipsBluetoothAndPrefersUsb() {
    val ports = listOf(phoneMic, btMic, usbMic, speaker)
    assertEquals(usbMic, AudioRouteLogic.choose(ports, input = true, forAsk = false, override = null))
    assertEquals(phoneMic, AudioRouteLogic.choose(listOf(phoneMic, btMic), input = true, forAsk = false, override = null))
    assertEquals(wiredMic, AudioRouteLogic.choose(listOf(phoneMic, wiredMic), input = true, forAsk = false, override = null))
  }

  @Test fun askingUsesBluetoothBeforePhone() {
    assertEquals(btMic, AudioRouteLogic.choose(listOf(phoneMic, btMic), input = true, forAsk = true, override = null))
    assertEquals(usbMic, AudioRouteLogic.choose(listOf(phoneMic, btMic, usbMic), input = true, forAsk = true, override = null))
  }

  @Test fun outputPrefersHeadphones() {
    assertEquals(buds, AudioRouteLogic.choose(listOf(speaker, buds, usbOut), input = false, forAsk = false, override = null))
    assertEquals(usbOut, AudioRouteLogic.choose(listOf(speaker, usbOut), input = false, forAsk = false, override = null))
  }

  @Test fun overrideWinsOnlyWhenConnected() {
    val ports = listOf(phoneMic, usbMic, speaker, buds)
    assertEquals(phoneMic, AudioRouteLogic.choose(ports, true, false, "phone:Phone mic"))
    assertEquals(usbMic, AudioRouteLogic.choose(ports, true, false, "wired:Headphones"))
    assertEquals(speaker, AudioRouteLogic.choose(ports, false, false, "phone:Phone speaker"))
  }

  @Test fun dedupeKeepsInputAndOutputOfSameDevice() {
    val d = AudioRouteLogic.dedupe(listOf(usbMic, usbMic.copy(id = 9), usbOut))
    assertEquals(listOf(usbMic, usbOut), d)
  }

  @Test fun typeConstantsMatchPlatform() {
    assertEquals(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioRouteLogic.TYPE_BUILTIN_SPEAKER)
    assertEquals(AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioRouteLogic.TYPE_WIRED_HEADSET)
    assertEquals(AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioRouteLogic.TYPE_WIRED_HEADPHONES)
    assertEquals(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioRouteLogic.TYPE_BLUETOOTH_SCO)
    assertEquals(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioRouteLogic.TYPE_BLUETOOTH_A2DP)
    assertEquals(AudioDeviceInfo.TYPE_USB_DEVICE, AudioRouteLogic.TYPE_USB_DEVICE)
    assertEquals(AudioDeviceInfo.TYPE_USB_ACCESSORY, AudioRouteLogic.TYPE_USB_ACCESSORY)
    assertEquals(AudioDeviceInfo.TYPE_BUILTIN_MIC, AudioRouteLogic.TYPE_BUILTIN_MIC)
    assertEquals(AudioDeviceInfo.TYPE_USB_HEADSET, AudioRouteLogic.TYPE_USB_HEADSET)
    assertEquals(AudioDeviceInfo.TYPE_HEARING_AID, AudioRouteLogic.TYPE_HEARING_AID)
    assertEquals(AudioDeviceInfo.TYPE_BLE_HEADSET, AudioRouteLogic.TYPE_BLE_HEADSET)
    assertEquals(AudioDeviceInfo.TYPE_BLE_SPEAKER, AudioRouteLogic.TYPE_BLE_SPEAKER)
  }

  @Test fun mediaKeys() {
    assertEquals("ask", MediaButtons.actionFor(android.view.KeyEvent.KEYCODE_HEADSETHOOK))
    assertEquals("ask", MediaButtons.actionFor(android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
    assertEquals("next", MediaButtons.actionFor(android.view.KeyEvent.KEYCODE_MEDIA_NEXT))
    assertNull(MediaButtons.actionFor(android.view.KeyEvent.KEYCODE_VOLUME_UP))
  }

  @Test fun privacyShutterIsNeverResetOrForcedOn() {
    // resetPrivacy applies the camera's default, which is "on" for some cameras (an earlier build
    // blacked out an Arducam this way). The only privacy write is the tracked off-attempt.
    val src = java.io.File("src/main/java").walk().filter { it.extension == "kt" }.map { it.readText() }.joinToString("\n")
    assertFalse(src.contains("resetPrivacy"))
    // No writes through the library setter; the one raw write sends 0 (off).
    assertFalse(Regex("\\.privacy\\s*=").containsMatchIn(src))
    assertTrue(src.contains("controlTransfer(0x21, 0x01, value, index, byteArrayOf(0), 1, 500)"))
    assertEquals(1, Regex("controlTransfer\\(0x21").findAll(src).count())
  }

  @Test fun findsTheCameraTerminalInRawDescriptors() {
    val raw = byteArrayOf(
      18, 1, 0, 2, 0xEF.toByte(), 2, 1, 64, 0, 0, 0, 0, 0, 0, 1, 2, 3, 1, // device
      9, 4, 0, 0, 1, 14, 1, 0, 0, // interface 0: video control
      13, 0x24, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, // VC header (truncated fields are fine)
      18, 0x24, 2, 1, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0x0A, 0, 0x04, // camera terminal id 1, privacy bit set
    )
    val t = UvcLogic.cameraTerminal(raw)!!
    assertEquals(0, t.iface)
    assertEquals(1, t.id)
    assertTrue(t.controls and (1L shl UvcLogic.CT_PRIVACY_BIT) != 0L)
    assertNull(UvcLogic.cameraTerminal(raw.copyOf(27)))
  }

  @Test fun describesTheCameraForSupportLogs() {
    val raw = byteArrayOf(
      18, 1, 0, 2, 0xEF.toByte(), 2, 1, 64, 0x0C, 0x0C, 0x34, 0x12, 0x09, 0x01, 1, 2, 3, 1, // device 0c0c:1234 fw 1.09 usb 2.00
      9, 4, 1, 1, 1, 14, 2, 0, 0, // interface 1 alt 1: video streaming
      7, 5, 0x81.toByte(), 5, 0x00, 0x14, 1, // iso endpoint: 1024 bytes x 3 transactions
    )
    assertEquals(1, UvcLogic.streamingInterface(raw))
    assertEquals("usb 0c0c:1234 firmware 1.09 usb 2.00 video-interface 1 max-iso-packet 3072", UvcLogic.describe(raw))
  }

  @Test fun silentCameraFallsBackToSmallerThenRawModes() {
    val modes = listOf(
      UvcMode(true, 1920, 1080, listOf(30)), UvcMode(true, 1280, 720, listOf(30)),
      UvcMode(true, 640, 480, listOf(30, 15)), UvcMode(false, 640, 480, listOf(30, 10)),
      UvcMode(false, 1280, 720, listOf(10)),
    )
    assertEquals(
      listOf(UvcChoice(true, 1280, 720, 30), UvcChoice(true, 640, 480, 15), UvcChoice(false, 640, 480, 10)),
      UvcLogic.fallbacks(modes, 1280, 720, 10),
    )
    // Only one mode: nothing else to try.
    assertEquals(1, UvcLogic.fallbacks(listOf(UvcMode(true, 640, 480, listOf(30))), 1280, 720, 10).size)
  }

  @Test fun aSwappedInCameraReplacesTheHeldOne() {
    assertTrue(UvcLogic.replaceOnOpen(null, "/dev/bus/usb/001/002"))
    assertTrue(UvcLogic.replaceOnOpen("/dev/bus/usb/001/002", "/dev/bus/usb/001/003"))
    assertFalse(UvcLogic.replaceOnOpen("/dev/bus/usb/001/002", "/dev/bus/usb/001/002"))
  }

  @Test fun autoExposureLeavesAutoModesAlone() {
    assertNull(UvcLogic.autoExposureMode(UvcLogic.AE_APERTURE, 0))
    assertNull(UvcLogic.autoExposureMode(UvcLogic.AE_AUTO, 0))
  }

  @Test fun autoExposureLeavesManualForApertureOrAuto() {
    assertEquals(UvcLogic.AE_APERTURE, UvcLogic.autoExposureMode(UvcLogic.AE_MANUAL, 0))
    assertEquals(UvcLogic.AE_APERTURE, UvcLogic.autoExposureMode(UvcLogic.AE_SHUTTER, 1 or 8))
    assertEquals(UvcLogic.AE_AUTO, UvcLogic.autoExposureMode(UvcLogic.AE_MANUAL, 1 or 2))
    assertNull(UvcLogic.autoExposureMode(UvcLogic.AE_MANUAL, 1))
    // Not a bitmap of modes (doesn't include the current one): treated as unknown.
    assertEquals(UvcLogic.AE_APERTURE, UvcLogic.autoExposureMode(UvcLogic.AE_MANUAL, 2))
  }
}
