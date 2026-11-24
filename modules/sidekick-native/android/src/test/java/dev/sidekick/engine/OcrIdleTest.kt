package dev.sidekick.engine

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OcrIdleTest {
  @Test
  fun onlyTheCheckAfterTheLastReadUnloads() {
    val t = IdleToken()
    val first = t.used()
    val second = t.used() // another photo inside the minute
    assertFalse(t.isLatest(first)) // the first read's check must not unload mid-burst
    assertTrue(t.isLatest(second))
  }
}
