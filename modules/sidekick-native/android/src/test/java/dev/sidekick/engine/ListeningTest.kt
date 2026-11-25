package dev.sidekick.engine

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin

class TurnEndTest {
  private fun TurnEnd.feedN(n: Int, p: Float) = (0 until n).map { feed(p) }

  @Test
  fun asksOnceAfterAShortPauseFollowingRealSpeech() {
    val t = TurnEnd()
    assertTrue(t.feedN(10, 0.9f).all { it == TurnEnd.Step.NONE }) // 320 ms of speech
    val steps = t.feedN(8, 0.1f) // 256 ms quiet
    assertEquals(TurnEnd.Step.CHECK, steps.last())
    assertEquals(1, steps.count { it == TurnEnd.Step.CHECK })
    assertTrue(t.stillPaused(t.pause))
    assertEquals(18 * 32, t.turnMs())
    assertTrue(t.feedN(5, 0.1f).none { it == TurnEnd.Step.CHECK }) // only once per pause
  }

  @Test
  fun speechResumingCancelsTheVerdictAndTheNextPauseAsksAgain() {
    val t = TurnEnd()
    t.feedN(10, 0.9f)
    t.feedN(8, 0.1f)
    val first = t.pause
    t.feed(0.9f)
    assertFalse(t.stillPaused(first))
    assertEquals(TurnEnd.Step.CHECK, t.feedN(8, 0.1f).last())
    assertEquals(first + 1, t.pause)
  }

  @Test
  fun blipsAndInBetweenProbabilitiesDoNotStartAPause() {
    val t = TurnEnd()
    t.feedN(5, 0.9f) // 160 ms: shorter than the VAD's minimum speech
    assertTrue(t.feedN(8, 0.1f).none { it == TurnEnd.Step.CHECK })
    val u = TurnEnd()
    u.feedN(10, 0.9f)
    assertTrue(u.feedN(20, 0.4f).none { it == TurnEnd.Step.CHECK }) // neither speech nor quiet
  }

  @Test
  fun theVadsOwnSilenceLimitEndsTheTurn() {
    val t = TurnEnd()
    t.feedN(10, 0.9f)
    t.feedN(19, 0.1f) // 608 ms
    assertEquals(0, t.turnMs())
    assertFalse(t.stillPaused(t.pause))
  }
}

class OwnerBargeTest {
  private val chunk = FloatArray(512) { 0.1f }
  private val chunksFor1_5s = (1.5f * 16000 / 512).toInt() + 1 // 47

  @Test
  fun withNoOwnerVoiceTheFirstConfirmedSpeechStops() {
    val g = OwnerBarge()
    assertEquals(OwnerBarge.Step.NONE, g.feed(BargeIn.Action.DUCK, true, true, chunk, ownerKnown = false))
    assertEquals(OwnerBarge.Step.STOP, g.feed(BargeIn.Action.STOP, false, true, chunk, ownerKnown = false))
  }

  @Test
  fun withAnOwnerVoiceItCollectsOneAndAHalfSecondsThenAsks() {
    val g = OwnerBarge()
    repeat(9) { g.feed(BargeIn.Action.DUCK, true, true, chunk, true) }
    assertEquals(OwnerBarge.Step.NONE, g.feed(BargeIn.Action.STOP, false, true, chunk, true))
    assertTrue(g.holding())
    var step = OwnerBarge.Step.NONE
    var n = 10
    while (step == OwnerBarge.Step.NONE) {
      step = g.feed(BargeIn.Action.NONE, false, true, chunk, true)
      n++
    }
    assertEquals(OwnerBarge.Step.VERIFY, step)
    assertEquals(chunksFor1_5s, n) // the clip starts where the voice was turned down
    assertEquals(n * 512, g.clip().size)
    assertEquals(OwnerBarge.Step.NONE, g.feed(BargeIn.Action.NONE, false, true, chunk, true)) // waiting
    assertTrue(g.verified(isOwner = true))
    assertFalse(g.holding())
  }

  @Test
  fun anotherVoiceIsRejectedAndCanBeCheckedAgain() {
    val g = OwnerBarge()
    g.feed(BargeIn.Action.STOP, false, true, chunk, true)
    repeat(chunksFor1_5s) { g.feed(BargeIn.Action.NONE, false, true, chunk, true) }
    assertFalse(g.verified(isOwner = false))
    assertFalse(g.holding())
    assertEquals(OwnerBarge.Step.NONE, g.feed(BargeIn.Action.STOP, false, true, chunk, true))
    assertTrue(g.holding())
  }

  @Test
  fun aShortInterruptionIsGivenUpWithoutAVoiceCheck() {
    val g = OwnerBarge()
    g.feed(BargeIn.Action.STOP, false, true, chunk, true)
    val steps = (0 until 19).map { g.feed(BargeIn.Action.NONE, false, false, chunk, true) }
    assertEquals(OwnerBarge.Step.REJECT, steps.last())
    assertTrue(steps.none { it == OwnerBarge.Step.VERIFY })
  }

  @Test
  fun aBlipThatNeverConfirmsIsDropped() {
    val g = OwnerBarge()
    repeat(3) { g.feed(BargeIn.Action.DUCK, true, true, chunk, true) }
    g.feed(BargeIn.Action.NONE, false, false, chunk, true)
    g.feed(BargeIn.Action.STOP, false, true, chunk, true)
    repeat(chunksFor1_5s - 2) { g.feed(BargeIn.Action.NONE, false, true, chunk, true) }
    assertEquals(OwnerBarge.Step.VERIFY, g.feed(BargeIn.Action.NONE, false, true, chunk, true))
  }

  @Test
  fun ownerMatchUsesTheSameThresholdAsTheMemory() {
    val owner = floatArrayOf(1f, 0f)
    assertTrue(OwnerBarge.isOwner(floatArrayOf(1f, 1.5f), owner)) // cos 0.555
    assertFalse(OwnerBarge.isOwner(floatArrayOf(1f, 1.6f), owner)) // cos 0.530
    assertFalse(OwnerBarge.isOwner(null, owner))
  }

  @Test
  fun sidekickSayingTheWakeWordIsRemembered() {
    val t = Turns()
    t.speaking("I'm Sidekick's helper.", 0)
    assertTrue(t.hasSaid("sidekick"))
    assertFalse(t.hasSaid("computer"))
  }
}

class AudioRingTest {
  @Test
  fun keepsTheNewestSamples() {
    val r = AudioRing(4)
    r.write(floatArrayOf(1f, 2f, 3f))
    assertArrayEquals(floatArrayOf(2f, 3f), r.last(2), 0f)
    r.write(floatArrayOf(4f, 5f, 6f))
    assertArrayEquals(floatArrayOf(3f, 4f, 5f, 6f), r.last(10), 0f)
  }

  @Test
  fun rangeByAbsoluteIndexSkipsWhatIsGone() {
    val r = AudioRing(4)
    r.write(floatArrayOf(1f, 2f, 3f, 4f, 5f, 6f))
    assertEquals(6L, r.total)
    assertArrayEquals(floatArrayOf(4f, 5f), r.range(3, 5), 0f)
    assertArrayEquals(floatArrayOf(3f, 4f), r.range(0, 4), 0f) // 1, 2 overwritten
    assertArrayEquals(floatArrayOf(), r.range(5, 5), 0f)
  }

  @Test
  fun preRollNeverReachesIntoThePreviousLine() {
    assertEquals(9_600L, PreRoll.start(16_000, 0, 6_400))
    assertEquals(12_000L, PreRoll.start(16_000, 12_000, 6_400))
    assertEquals(0L, PreRoll.start(3_000, 0, 6_400))
  }
}

class WhisperMelTest {
  /**
   * 1 s of 440 Hz + 3 kHz. Expected values from transformers' WhisperFeatureExtractor
   * (chunk_length=8, do_normalize=True) on the same audio front-padded to 8 s, as Smart Turn does.
   */
  @Test
  fun matchesTheReferenceFeatureExtractor() {
    val x = FloatArray(16000) { (0.3 * sin(2 * PI * 440 * it / 16000) + 0.1 * sin(2 * PI * 3000 * it / 16000)).toFloat() }
    val f = WhisperMel.features(x)
    assertEquals(80 * 800, f.size)
    fun at(m: Int, t: Int) = f[m * 800 + t]
    assertEquals(-0.12169242f, at(0, 0), 2e-5f) // padding: the floor (max - 8)
    assertEquals(1.8783076f, at(11, 750), 2e-5f) // 440 Hz
    assertEquals(1.7888418f, at(10, 750), 2e-5f)
    assertEquals(1.5155849f, at(54, 750), 2e-5f) // 3 kHz
    assertEquals(0.7930042f, at(11, 699), 2e-5f) // onset, half a window in
    assertEquals(1.8757733f, at(11, 799), 2e-5f)
  }

  @Test
  fun keepsOnlyTheLastEightSeconds() {
    val x = FloatArray(16000) { (0.3 * sin(2 * PI * 440 * it / 16000)).toFloat() }
    val longer = FloatArray(32000) { 0.5f } + FloatArray(112000) + x
    assertArrayEquals(WhisperMel.features(x), WhisperMel.features(longer), 1e-6f)
  }

  @Test
  fun sileroWindowPutsTheLast64SamplesInFront() {
    val w = SileroWindow()
    val a = FloatArray(512) { it.toFloat() }
    val first = w.next(a)
    assertEquals(576, first.size)
    assertEquals(0f, first[63])
    assertEquals(0f, first[64])
    val second = w.next(FloatArray(512) { 1000f })
    assertEquals(448f, second[0])
    assertEquals(511f, second[63])
    assertEquals(1000f, second[64])
    w.reset()
    assertEquals(0f, w.next(a)[0])
  }
}
