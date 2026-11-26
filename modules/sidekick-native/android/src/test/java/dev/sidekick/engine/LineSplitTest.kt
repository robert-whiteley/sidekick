package dev.sidekick.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LineSplitTest {
  private val sr = SAMPLE_RATE
  private val ann = floatArrayOf(1f, 0f, 0f)
  private val bob = floatArrayOf(0f, 1f, 0f)

  /** Voiceprints by who speaks where: [who] maps a piece's start to its voice. */
  private fun voices(who: Map<Int, FloatArray>) = { a: Int, _: Int -> who[a] }

  @Test
  fun cutsBetweenTwoPeopleHalfwayThroughThePause() {
    val pieces = listOf(0 to 3 * sr, 3 * sr + 4000 to 6 * sr)
    val parts = LineSplit.parts(6 * sr + 100, pieces, voices(mapOf(0 to ann, 3 * sr + 4000 to bob)))
    assertEquals(listOf(0 to 3 * sr + 2000, 3 * sr + 2000 to 6 * sr + 100), parts)
  }

  @Test
  fun keepsOnePersonsPausesInOneLine() {
    val near = floatArrayOf(0.9f, 0.2f, 0f)
    val pieces = listOf(0 to 2 * sr, 2 * sr + 5000 to 4 * sr, 4 * sr + 5000 to 6 * sr)
    val parts = LineSplit.parts(6 * sr, pieces, voices(mapOf(0 to ann, 2 * sr + 5000 to near, 4 * sr + 5000 to ann)))
    assertEquals(listOf(0 to 6 * sr), parts)
  }

  @Test
  fun aShortPieceStaysWithTheLineItIsIn() {
    // "Yeah." (0.5 s) can't be judged: it joins the line before; Bob's long piece is cut off.
    val pieces = listOf(0 to 2 * sr, 2 * sr + 4000 to 2 * sr + 12000, 3 * sr to 5 * sr)
    val parts = LineSplit.parts(5 * sr, pieces, voices(mapOf(0 to ann, 3 * sr to bob)))
    assertEquals(2, parts.size)
    assertEquals(0 to (2 * sr + 12000 + 3 * sr) / 2, parts[0])
  }

  @Test
  fun oneSpeechPieceIsTheWholeLine() {
    assertEquals(listOf(0 to 100), LineSplit.parts(100, listOf(0 to 90), voices(emptyMap())))
    assertEquals(listOf(0 to 100), LineSplit.parts(100, emptyList(), voices(emptyMap())))
  }

  @Test
  fun longSpeechWithNoPauseIsJudgedInBlocksCutAtTheQuietestMoment() {
    val audio = FloatArray(7 * sr) { 0.5f }
    for (i in 2 * sr + 1000 until 2 * sr + 1400) audio[i] = 0f // a quiet gap between words
    val b = LineSplit.blocks(audio, listOf(0 to 7 * sr))
    assertEquals(3, b.size)
    assertEquals(0, b[0].first)
    assertEquals(7 * sr, b.last().second)
    assertTrue(b[0].second in 2 * sr + 1000..2 * sr + 1400)
    assertEquals(listOf(0 to sr), LineSplit.blocks(audio, listOf(0 to sr))) // short: as it was
  }

  @Test
  fun wordsAreSharedOutByWhenTheyStart() {
    val words = LineSplit.words(arrayOf(" Got", " it", ".", " Thanks", ",", " Ruth", "."), floatArrayOf(0.1f, 0.3f, 0.5f, 1.2f, 1.5f, 1.6f, 1.9f))
    assertEquals(listOf("Got" to 0.1f, "it." to 0.3f, "Thanks," to 1.2f, "Ruth." to 1.6f), words)
    assertEquals(listOf("Got it.", "Thanks, Ruth."), LineSplit.shareWords(words, listOf(0 to sr, sr to 2 * sr)))
  }

  @Test
  fun noVoiceprintMeansNoCut() {
    val pieces = listOf(0 to 2 * sr, 2 * sr + 5000 to 4 * sr)
    assertEquals(listOf(0 to 4 * sr), LineSplit.parts(4 * sr, pieces, voices(emptyMap())))
  }
}
