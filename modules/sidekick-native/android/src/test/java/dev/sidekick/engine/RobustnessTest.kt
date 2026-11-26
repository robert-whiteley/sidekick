package dev.sidekick.engine

import org.junit.Assert.assertEquals
import org.junit.Test

class MemoryPressureTest {
  @Test
  fun trimLevelsMapToWhatIsFreed() {
    assertEquals(MemoryPressure.Free.NONE, MemoryPressure.forTrim(0))
    assertEquals(MemoryPressure.Free.ONE_MODEL, MemoryPressure.forTrim(5)) // running moderate
    assertEquals(MemoryPressure.Free.ONE_MODEL, MemoryPressure.forTrim(10)) // running low
    assertEquals(MemoryPressure.Free.ALL, MemoryPressure.forTrim(15)) // running critical
    assertEquals(MemoryPressure.Free.NONE, MemoryPressure.forTrim(20)) // UI hidden: not pressure
    assertEquals(MemoryPressure.Free.ALL, MemoryPressure.forTrim(40)) // background
    assertEquals(MemoryPressure.Free.ALL, MemoryPressure.forTrim(80)) // complete
  }

  @Test
  fun oneModelFreesTheEmbedderOnlyWhenBothAreLoaded() {
    assertEquals(
      MemoryPressure.Plan(embedder = true, llm = false),
      MemoryPressure.plan(MemoryPressure.Free.ONE_MODEL, llmLoaded = true, embedderLoaded = true),
    )
    assertEquals(
      MemoryPressure.Plan(embedder = false, llm = false),
      MemoryPressure.plan(MemoryPressure.Free.ONE_MODEL, llmLoaded = false, embedderLoaded = true),
    )
    assertEquals(
      MemoryPressure.Plan(embedder = true, llm = true),
      MemoryPressure.plan(MemoryPressure.Free.ALL, llmLoaded = true, embedderLoaded = true),
    )
    assertEquals(
      MemoryPressure.Plan(embedder = false, llm = false),
      MemoryPressure.plan(MemoryPressure.Free.NONE, llmLoaded = true, embedderLoaded = true),
    )
  }
}

class StorageGuardTest {
  private val gb = 1_000_000_000L

  @Test
  fun threeLevelsLikeTheApp() {
    val total = 109 * gb
    val reserve = 11 * gb
    assertEquals(StorageGuard.Level.OK, StorageGuard.level(13 * gb, total, reserve))
    assertEquals(StorageGuard.Level.LOW, StorageGuard.level(5 * gb, total, reserve))
    assertEquals(StorageGuard.Level.FULL, StorageGuard.level(gb, total, reserve))
  }

  @Test
  fun floorIs500MbOr1PercentNeverAboveTheReserve() {
    assertEquals(StorageGuard.FLOOR_BYTES, StorageGuard.floor(32 * gb, 3 * gb))
    assertEquals(1_090_000_000L, StorageGuard.floor(109 * gb, 11 * gb))
    assertEquals(200_000_000L, StorageGuard.floor(109 * gb, 200_000_000L))
  }
}
