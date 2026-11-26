package dev.sidekick.engine

import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.file.Files

class JournalTest {
  private fun dir() = Files.createTempDirectory("journal").toFile()

  @Test
  fun linesStayUntilAcked() {
    val d = dir()
    Journal.append(d, "a")
    Journal.append(d, "b")
    assertEquals(listOf("a", "b"), Journal.take(d, 500).lines)
    // The app was killed before saving: the same lines come again, marked as handed out before.
    Journal.append(d, "c")
    val again = Journal.take(d, 500)
    assertEquals(listOf("a", "b", "c"), again.lines)
    assertEquals(2, again.replayed)
    Journal.ack(d)
    assertEquals(emptyList<String>(), Journal.take(d, 500).lines)
  }

  @Test
  fun aBacklogComesInPiecesInOrder() {
    val d = dir()
    (1..5).forEach { Journal.append(d, "l$it") }
    assertEquals(listOf("l1", "l2"), Journal.take(d, 2).lines)
    Journal.ack(d)
    assertEquals(listOf("l3", "l4"), Journal.take(d, 2).lines)
    Journal.ack(d)
    Journal.append(d, "l6")
    assertEquals(listOf("l5", "l6"), Journal.take(d, 2).lines)
    Journal.ack(d)
    assertEquals(0, Journal.take(d, 2).lines.size)
  }

  @Test
  fun anUnackedBatchBiggerThanATakeKeepsItsOrder() {
    val d = dir()
    (1..3).forEach { Journal.append(d, "l$it") }
    Journal.take(d, 3)
    assertEquals(listOf("l1", "l2"), Journal.take(d, 2).lines)
    Journal.ack(d)
    assertEquals(listOf("l3"), Journal.take(d, 2).lines)
  }
}
