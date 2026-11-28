package dev.sidekick.engine.offline

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingWakeTest {
  private val now = 100 * 60_000L
  private val justWoke = now - 60_000L

  @Test
  fun unblockingSidekickWakesTheQueueAtOnce() {
    // Online all along, woken a minute ago: only the unblock wakes it now, not 15 min later.
    assertTrue(Offline.pendingWake(changed = false, unblocked = true, now = now, lastWake = justWoke))
    assertFalse(Offline.pendingWake(changed = false, unblocked = false, now = now, lastWake = justWoke))
  }

  @Test
  fun aChangeOrFifteenMinutesStillWake() {
    assertTrue(Offline.pendingWake(changed = true, unblocked = false, now = now, lastWake = justWoke))
    assertTrue(
      Offline.pendingWake(changed = false, unblocked = false, now = now, lastWake = now - 15 * 60_000L)
    )
  }
}
