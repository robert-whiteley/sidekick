package dev.sidekick.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TurnsTest {
  @Test
  fun followUpWindowOpensWhenSidekickFinishesAndClosesAfterEightSeconds() {
    val t = Turns()
    assertFalse(t.isFollowUp(0, 0)) // nothing said yet: the wake word is needed
    t.speaking("The mug is red.", 1_000)
    assertTrue(t.isFollowUp(1_500, 1_500)) // talking over it
    t.finished(3_000)
    assertEquals(Turns.State.FOLLOW_UP, t.state(5_000))
    assertTrue(t.isFollowUp(10_900, 10_900))
    assertFalse(t.isFollowUp(11_100, 11_100))
    assertEquals(Turns.State.IDLE, t.state(11_100))
  }

  @Test
  fun speechThatStartedInTheWindowCountsEvenIfTranscribedLate() {
    val t = Turns()
    t.speaking("Hi.", 0)
    t.finished(1_000)
    assertTrue(t.isFollowUp(8_500, 12_000))
  }

  @Test
  fun speechFromBeforeSidekickSpokeIsNotAReply() {
    val t = Turns()
    t.speaking("Hi.", 5_000)
    t.finished(6_000)
    assertFalse(t.isFollowUp(4_000, 6_500))
  }

  @Test
  fun takingTheQuestionClosesTheWindow() {
    val t = Turns()
    t.speaking("Hi.", 0)
    t.finished(1_000)
    t.questionTaken()
    assertFalse(t.isFollowUp(2_000, 2_000))
    assertFalse(t.active(2_000))
  }

  @Test
  fun bargeInOpensTheWindow() {
    val t = Turns()
    t.speaking("A long answer.", 0)
    t.bargedIn(500)
    assertEquals(Turns.State.FOLLOW_UP, t.state(600))
    assertTrue(t.isFollowUp(400, 2_000))
  }

  @Test
  fun recognisesItsOwnVoice() {
    val t = Turns()
    t.speaking("The capital of France is Paris.", 0)
    assertTrue(t.isEcho("capital of France is Paris"))
    assertFalse(t.isEcho("what about Germany"))
    assertFalse(t.isEcho("Paris")) // one word is too little to tell
  }

  @Test
  fun bargeInDucksOnOnsetAndStopsAfter300ms() {
    val b = BargeIn()
    assertEquals(BargeIn.Action.NONE, b.feed(0.2f))
    assertEquals(BargeIn.Action.DUCK, b.feed(0.9f))
    val actions = (1..9).map { b.feed(0.9f) }
    assertEquals(BargeIn.Action.STOP, actions.last()) // 10 x 32 ms = 320 ms
    assertEquals(BargeIn.Action.NONE, b.feed(0.9f)) // only once
  }

  @Test
  fun bargeInIgnoresEchoBelowThePlaybackThresholdAndShortBlips() {
    val b = BargeIn()
    repeat(20) { assertEquals(BargeIn.Action.NONE, b.feed(0.6f)) }
    repeat(3) { b.feed(0.9f) }
    repeat(4) { b.feed(0.1f) } // > 96 ms pause resets
    assertFalse(b.ducked())
  }

  @Test
  fun splitsStreamedTextIntoSentences() {
    val s = SentenceSplitter()
    assertEquals(emptyList<String>(), s.push("The sky is 3."))
    assertEquals(emptyList<String>(), s.push("5 km"))
    assertEquals(listOf("The sky is 3.5 km up."), s.push(" up. Light"))
    assertEquals(listOf("Light scatters!"), s.push(" scatters! And"))
    assertEquals("And", s.finish())
  }
}

class TurnsStopLaterTest {
  @Test
  fun stoppingAfterTheWindowClosedDoesNotReopenIt() {
    val t = Turns()
    t.speaking("Hi.", 0)
    t.finished(1_000)
    t.finished(60_000) // e.g. Stop pressed a minute later
    assertFalse(t.active(60_001))
  }
}
