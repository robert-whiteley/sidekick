package dev.sidekick.engine

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PartialPolicyTest {
  private val p = PartialPolicy(intervalMs = 700, minSamples = 8000, maxSamples = 480000)

  @Test fun waitsForHalfASecondOfSpeech() {
    assertFalse(p.due(0, 4000, busy = false))
    assertTrue(p.due(0, 8000, busy = false))
  }

  @Test fun oneDecodeAtATimeAndNotTooOften() {
    assertFalse(p.due(0, 10000, busy = true))
    p.started(1000, 10000)
    assertFalse(p.due(1500, 20000, busy = false))
    assertTrue(p.due(1700, 20000, busy = false))
  }

  @Test fun nothingNewMeansNoDecode() {
    p.started(0, 10000)
    assertFalse(p.due(5000, 10000, busy = false))
  }

  @Test fun longClipsAreLeftToTheFinalDecode() {
    assertFalse(p.due(0, 480001, busy = false))
  }

  @Test fun resetStartsOver() {
    p.started(0, 20000)
    p.reset()
    assertTrue(p.due(1, 9000, busy = false))
  }
}
