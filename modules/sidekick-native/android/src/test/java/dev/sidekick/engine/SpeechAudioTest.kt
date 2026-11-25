package dev.sidekick.engine

import java.util.TimeZone
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class SpeechAudioTest {
  @Test
  fun clipsAreFiledByHourUnderDataAudio() {
    val utc = TimeZone.getTimeZone("UTC")
    // 2026-11-25 14:05:09 UTC
    val at = 1795615509000L
    assertEquals("data/audio/2026-11-25-14/$at.ogg", SpeechAudio.relPath(at, utc))
    val tokyo = TimeZone.getTimeZone("Asia/Tokyo")
    assertEquals("data/audio/2026-11-25-23/$at.ogg", SpeechAudio.relPath(at, tokyo))
  }

  @Test
  fun floatPcmBecomesClipped16BitLittleEndian() {
    val out = SpeechAudio.toPcm16(floatArrayOf(0f, 1f, -1f, 2f))
    assertArrayEquals(
      byteArrayOf(0, 0, 0xff.toByte(), 0x7f, 0x01, 0x80.toByte(), 0xff.toByte(), 0x7f),
      out,
    )
  }

  @Test
  fun opusAtAbout16KbpsMono16kHzIn20msFrames() {
    assertEquals(16_000, SpeechAudio.SAMPLE_RATE)
    assertEquals(16_000, SpeechAudio.BIT_RATE)
    assertEquals(320, SpeechAudio.FRAME_SAMPLES)
    assertEquals("audio/opus", SpeechAudio.MIME)
  }
}
