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
