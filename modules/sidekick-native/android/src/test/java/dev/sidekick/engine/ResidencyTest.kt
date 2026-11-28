package dev.sidekick.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/** One model change at a time (Residency.change), and the rule for which models can share. */
class ResidencyTest {
  @Test
  fun smallOrShortPhonesKeepOneModel() {
    assertTrue(Residency.alone(4 * 1024L, lowMemory = false))
    assertTrue(Residency.alone(12 * 1024L, lowMemory = true))
    assertFalse(Residency.alone(8 * 1024L, lowMemory = false))
  }

  @Test
  fun changesNeverOverlap() {
    val inside = AtomicInteger(0)
    val most = AtomicInteger(0)
    val start = CountDownLatch(1)
    val workers =
      (1..8).map {
        thread {
          start.await()
          repeat(20) {
            Residency.change {
              most.accumulateAndGet(inside.incrementAndGet(), ::maxOf)
              Thread.sleep(1)
              inside.decrementAndGet()
            }
          }
        }
      }
    start.countDown()
    workers.forEach { it.join() }
    assertEquals(1, most.get())
  }
}
