package dev.sidekick.engine.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureLogicTest {
  private fun grid(value: Int, n: Int = 32 * 18) = IntArray(n) { value }

  private fun pattern(seed: Int, n: Int = 32 * 18) = IntArray(n) { ((it * 37 + seed * 101) % 256) }

  @Test fun dedupeSkipsRepeatsAndBrightnessOnlyChanges() {
    val d = FrameDedupe(threshold = 0.04f, maxGapMs = 60_000)
    val a = IntArray(32 * 18) { (it * 37) % 200 }
    assertTrue(d.keep(a, 0))
    assertFalse(d.keep(a, 500))
    // Same scene, auto-exposure brighter by 30: still a repeat.
    assertFalse(d.keep(IntArray(a.size) { a[it] + 30 }, 1_000))
    // A small change (a few pixels) is a repeat too.
    assertFalse(d.keep(a.copyOf().also { it[0] = 255; it[1] = 255 }, 1_500))
  }

  @Test fun dedupeKeepsChangedScenesAndAMinuteHeartbeat() {
    val d = FrameDedupe(threshold = 0.04f, maxGapMs = 60_000)
    val a = pattern(1)
    assertTrue(d.keep(a, 0))
    assertTrue(d.keep(pattern(7), 500))
    assertFalse(d.keep(pattern(7), 1_000))
    assertTrue(d.keep(pattern(7), 61_000))
  }

  @Test fun uniformBrightnessShiftIsNotAChange() {
    val a = IntArray(100) { 50 + it }
    val b = IntArray(100) { 80 + it }
    assertEquals(0f, FrameDedupe.difference(FrameDedupe.signature(a), FrameDedupe.signature(b)), 1e-6f)
  }

  @Test fun throttleNormalKeepsTargets() {
    val r = ThrottlePolicy.rates(2f, 10, true, DeviceState())
    assertEquals(Rates(2f, 10, true, false, null), r)
  }

  @Test fun throttleHeatSteps() {
    assertEquals(Rates(1f, 5, true, false, "heat"), ThrottlePolicy.rates(2f, 10, true, DeviceState(thermalStatus = 2)))
    assertEquals(Rates(0.5f, 0, false, false, "heat"), ThrottlePolicy.rates(2f, 10, true, DeviceState(thermalStatus = 3)))
    assertTrue(ThrottlePolicy.rates(2f, 10, true, DeviceState(thermalStatus = 4)).paused)
    assertEquals(Rates(2f, 10, true, false, null), ThrottlePolicy.rates(2f, 10, true, DeviceState(thermalStatus = 1)))
  }

  @Test fun throttleBatteryOnlyWhenNotCharging() {
    assertEquals(Rates(2f, 10, true, false, null), ThrottlePolicy.rates(2f, 10, true, DeviceState(batteryPct = 5, charging = true)))
    assertEquals(Rates(1f, 5, true, false, "battery"), ThrottlePolicy.rates(2f, 10, true, DeviceState(batteryPct = 15, charging = false)))
    assertEquals(Rates(0.5f, 0, false, false, "battery"), ThrottlePolicy.rates(2f, 10, true, DeviceState(batteryPct = 8, charging = false)))
  }

  @Test fun throttleStrongestCutWinsAndNamesItsCause() {
    val r = ThrottlePolicy.rates(2f, 10, true, DeviceState(thermalStatus = 2, batteryPct = 8, charging = false))
    assertEquals(0.5f, r.sampleFps)
    assertFalse(r.recordVideo)
    assertEquals("battery", r.reason)
    val m = ThrottlePolicy.rates(2f, 10, true, DeviceState(lowMemory = true))
    assertEquals(Rates(0.5f, 10, true, false, "memory"), m)
  }

  @Test fun governorSlowsAtOnceAndRecoversLater() {
    val g = ThrottleGovernor(recoverMs = 120_000)
    val normal = Rates(2f, 10, true, false, null)
    val hot = Rates(1f, 5, true, false, "heat")
    assertEquals(normal, g.update(normal, 0))
    assertNull(g.update(normal, 1_000))
    assertEquals(hot, g.update(hot, 2_000))
    assertNull(g.update(normal, 3_000))
    assertNull(g.update(normal, 100_000))
    assertEquals(normal, g.update(normal, 123_000))
  }

  @Test fun governorRecoveryClockResetsWhenItGetsWorseAgain() {
    val g = ThrottleGovernor(recoverMs = 120_000)
    val normal = Rates(2f, 10, true, false, null)
    val hot = Rates(1f, 5, true, false, "heat")
    g.update(hot, 0)
    assertNull(g.update(normal, 10_000))
    assertNull(g.update(hot, 50_000))
    assertNull(g.update(normal, 60_000))
    assertNull(g.update(normal, 140_000))
    assertEquals(normal, g.update(normal, 180_000))
  }

  @Test fun segmentNamesRoundTrip() {
    assertEquals(1_000L to 4_000L, SegmentIndex.parse(SegmentIndex.name(1_000, 4_000)))
    assertNull(SegmentIndex.parse("seg_1000.mp4.part"))
    assertNull(SegmentIndex.parse("seg_5_1.mp4"))
    assertNull(SegmentIndex.parse("x.jpg"))
  }

  @Test fun segmentsBetweenTrimsToTheWindow() {
    val segs = listOf(Segment("c", 6_000, 9_000), Segment("a", 0, 3_000), Segment("b", 3_000, 6_000))
    val out = SegmentIndex.between(segs, 2_000, 7_000)
    assertEquals(listOf("a", "b", "c"), out.map { it.path })
    assertEquals(SegmentSlice("a", 0, 3_000, 2_000, 1_000), out[0])
    assertEquals(SegmentSlice("b", 3_000, 6_000, 0, 3_000), out[1])
    assertEquals(SegmentSlice("c", 6_000, 9_000, 0, 1_000), out[2])
    assertTrue(SegmentIndex.between(segs, 9_000, 10_000).isEmpty())
  }

  @Test fun hourBuckets() {
    val h = HourBuckets.HOUR_MS
    assertEquals("h2", HourBuckets.name(2 * h + 5))
    assertEquals(2 * h, HourBuckets.start("h2"))
    assertNull(HourBuckets.start("pending"))
    assertEquals(listOf("h1", "h2"), HourBuckets.covering(2 * h + 10, 2 * h + 20, slackMs = 60_000))
    assertEquals(listOf("h2", "h3", "h4"), HourBuckets.covering(2 * h, 4 * h + 1))
  }

  @Test fun framesAroundPicksNearestDistinctFrames() {
    val times = listOf(0L, 900, 2_100, 3_000, 10_000)
    assertEquals(listOf(900L, 2_100L, 3_000L), FrameIndex.around(times, 2_000, 3, 1_000))
    // Centre only, from a sparse still scene.
    assertEquals(listOf(10_000L), FrameIndex.around(times, 12_000, 1, 1_000))
    // Nothing near enough at the sides: just the centre.
    assertEquals(listOf(10_000L), FrameIndex.around(times, 10_000, 3, 1_000))
    assertTrue(FrameIndex.around(emptyList(), 0, 3, 1_000).isEmpty())
  }

  @Test fun latestFrames() {
    assertEquals(listOf(3L, 4L), FrameIndex.latest(listOf(4L, 1, 3, 2), 2))
    assertEquals(listOf(2L, 3L), FrameIndex.latest(listOf(4L, 1, 3, 2), 2, beforeMs = 3))
    assertEquals(5L, FrameIndex.parse("5.jpg"))
    assertNull(FrameIndex.parse("5.jpg.tmp"))
  }

  private val h = HourBuckets.HOUR_MS
  private val gb = 1024L * 1024 * 1024

  @Test fun retentionDropsVideoPastKeepPeriodButNeverTheCurrentHour() {
    val now = 100 * h + 10
    val b = (90..100).map { Bucket("video", "v$it", it * h, 1) } + Bucket("frames", "f1", 0, 99)
    val plan = Retention.plan(b, now, freeBytes = 100 * gb, reserveBytes = 2 * gb, keepVideoMs = 5 * h)
    assertEquals((90..94).map { "v$it" }, plan.delete)
    assertEquals(0L, plan.stillShortBytes)
  }

  @Test fun retentionCapsVideoSizeOldestFirst() {
    val now = 10 * h
    val b = (0..9).map { Bucket("video", "v$it", it * h, 10) }
    val plan = Retention.plan(b, now, freeBytes = 100 * gb, reserveBytes = 0, keepVideoMs = 0, maxVideoBytes = 75)
    assertEquals(listOf("v0", "v1", "v2"), plan.delete)
  }

  @Test fun retentionKeepsTheReserveVideoFirstThenOldStillsNeverFrames() {
    val now = 1_000 * h
    val b =
      listOf(
        Bucket("video", "v1", 998 * h, gb),
        Bucket("video", "v0", 997 * h, gb),
        Bucket("stills", "s-old", 10 * h, gb),
        Bucket("stills", "s-new", 999 * h, gb),
        Bucket("frames", "f", 10 * h, 5 * gb),
        Bucket("video", "vnow", 1_000 * h, gb),
      )
    val plan = Retention.plan(b, now, freeBytes = 0, reserveBytes = 10 * gb, keepVideoMs = 1_000 * h)
    assertEquals(listOf("v0", "v1", "s-old"), plan.delete)
    assertEquals(7 * gb, plan.stillShortBytes)
  }

  @Test fun retentionStillsKeepPeriod() {
    val now = 100 * 24 * h
    val b = listOf(Bucket("stills", "old", 0, 1), Bucket("stills", "new", now - 2 * h, 1))
    val plan = Retention.plan(b, now, freeBytes = 100 * gb, reserveBytes = 0, keepVideoMs = h, keepStillsMs = 30 * 24 * h)
    assertEquals(listOf("old"), plan.delete)
  }

  @Test fun recommendedReserve() {
    assertEquals(2 * gb, Retention.recommendedReserve(8 * gb))
    assertEquals(25 * gb, Retention.recommendedReserve(250 * gb))
  }

  @Test fun configFromJsAppliesDefaultsAndBounds() {
    val c = CaptureConfig.from(mapOf("sampleFps" to 50.0, "videoFps" to 10.0, "source" to "usb", "embedModelPath" to "/m"))
    assertEquals(10f, c.sampleFps)
    assertEquals(10, c.videoFps)
    assertEquals("usb", c.source)
    assertEquals("/m", c.embedModelPath)
    assertEquals(CaptureConfig(), CaptureConfig.from(null))
    assertEquals("auto", CaptureConfig().source)
  }

  @Test fun nv21Converts() {
    // 2×2 frame: Y = 0, 255, 128, 128; one V/U pair at 128 (no colour).
    val data = byteArrayOf(0, 255.toByte(), 128.toByte(), 128.toByte(), 128.toByte(), 128.toByte())
    val out = IntArray(4)
    Nv21.toArgb(data, 2, 2, out)
    assertEquals(0xff000000.toInt(), out[0])
    assertEquals(0xffffffff.toInt(), out[1])
    assertEquals(0xff808080.toInt(), out[2])
  }
}
