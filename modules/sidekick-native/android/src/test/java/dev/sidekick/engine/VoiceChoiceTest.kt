package dev.sidekick.engine

import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceChoiceTest {
  @Test
  fun fastPocketIsKept() {
    assertEquals("pocket", VoiceChoice.decide(400))
    assertEquals("pocket", VoiceChoice.decide(VoiceChoice.MAX_FIRST_SOUND_MS))
  }

  @Test
  fun slowOrFailedPocketMeansSystem() {
    assertEquals("system", VoiceChoice.decide(VoiceChoice.MAX_FIRST_SOUND_MS + 1))
    assertEquals("system", VoiceChoice.decide(null))
  }

  @Test
  fun systemSpeaksUntilDecided() {
    assertEquals("system", VoiceChoice.active("auto", null, pocketUsable = true))
    assertEquals("pocket", VoiceChoice.active("auto", "pocket", pocketUsable = true))
  }

  @Test
  fun ownerOverrideWins() {
    assertEquals("pocket", VoiceChoice.active("pocket", "system", pocketUsable = true))
    assertEquals("system", VoiceChoice.active("system", "pocket", pocketUsable = true))
  }

  @Test
  fun pocketNeedsTheModel() {
    assertEquals("system", VoiceChoice.active("pocket", "pocket", pocketUsable = false))
  }
}
