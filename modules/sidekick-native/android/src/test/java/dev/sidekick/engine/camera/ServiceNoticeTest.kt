package dev.sidekick.engine.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ServiceNoticeTest {
  private fun t(listening: Boolean, camera: Boolean, paused: Boolean = false, lock: Boolean = false, mic: String? = null) =
    ServiceNotice.text(listening, camera, paused, lock, mic, "Hey Sidekick")

  @Test fun cameraAndMicHaveAllButtons() {
    val n = t(listening = true, camera = true)
    assertEquals("Sidekick is watching and listening", n.title)
    assertEquals(listOf("pauseCamera", "stopCamera", "stop"), n.actions)
  }

  @Test fun pausedCameraOffersResume() {
    val n = t(listening = false, camera = true, paused = true)
    assertEquals("Sidekick camera is paused", n.title)
    assertEquals(listOf("resumeCamera", "stop"), n.actions)
    assertEquals("Not listening. Everything stays on this phone.", n.body)
  }

  @Test fun lockedPauseSaysSo() {
    assertEquals("Sidekick camera is off while the phone is locked", t(false, true, lock = true).title)
  }

  @Test fun micOnlyHasJustStop() {
    val n = t(listening = true, camera = false)
    assertEquals(listOf("stop"), n.actions)
    assertTrue(n.body.contains("Hey Sidekick"))
  }

  @Test fun micPauseReasonShown() {
    assertEquals("Sidekick is paused (at work)", t(true, false, mic = "at work").title)
  }

  @Test fun filmingOnlyWhenNeitherPause() {
    assertTrue(CaptureLogicLock.shouldFilm(false, false))
    assertFalse(CaptureLogicLock.shouldFilm(true, false))
    assertFalse(CaptureLogicLock.shouldFilm(false, true))
  }
}
