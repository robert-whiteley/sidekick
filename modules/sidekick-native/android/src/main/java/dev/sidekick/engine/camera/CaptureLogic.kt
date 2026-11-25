package dev.sidekick.engine.camera

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/*
 * Pure decisions behind live capture (no Android types, unit-tested on the JVM): which frames to
 * keep, how far to slow down for heat / battery / memory, where video and keyframes live on disk,
 * and what to delete when space runs out.
 */

/**
 * Skips near-identical frames. A frame is reduced to a small brightness grid; it is kept when its
 * mean difference from the last kept frame (after removing overall brightness, so auto-exposure
 * alone doesn't count) is at least [threshold] (0..1), or when [maxGapMs] has passed since the last
 * kept frame (so a still scene still has a keyframe at least once a minute).
 */
class FrameDedupe(var threshold: Float = 0.04f, var maxGapMs: Long = 60_000) {
  private var last: FloatArray? = null
  private var lastAt = Long.MIN_VALUE

  /** [luma]: grid of 0..255 brightness values, same size every call. */
  fun keep(luma: IntArray, at: Long): Boolean {
    val sig = signature(luma)
    val prev = last
    val keep = prev == null || prev.size != sig.size || at - lastAt >= maxGapMs || difference(prev, sig) >= threshold
    if (keep) {
      last = sig
      lastAt = at
    }
    return keep
  }

  fun reset() {
    last = null
    lastAt = Long.MIN_VALUE
  }

  companion object {
    /** Brightness grid with its mean removed, scaled to 0..1. */
    fun signature(luma: IntArray): FloatArray {
      if (luma.isEmpty()) return FloatArray(0)
      val mean = luma.average().toFloat()
      return FloatArray(luma.size) { (luma[it] - mean) / 255f }
    }

    fun difference(a: FloatArray, b: FloatArray): Float {
      var sum = 0f
      for (i in a.indices) sum += abs(a[i] - b[i])
      return if (a.isEmpty()) 0f else sum / a.size
    }
  }
}

/** What the phone is like right now. [thermalStatus] uses PowerManager.THERMAL_STATUS_* (0..6). */
data class DeviceState(
  val thermalStatus: Int = 0,
  val batteryPct: Int = 100,
  val charging: Boolean = true,
  val lowMemory: Boolean = false,
  val tempC: Float? = null,
)

/** Effective capture rates. [paused]: camera off until things improve. */
data class Rates(val sampleFps: Float, val videoFps: Int, val recordVideo: Boolean, val paused: Boolean, val reason: String?)

object ThrottlePolicy {
  const val MIN_FPS = 0.5f

  /**
   * Heat: light = no change, moderate = half frame rate and video at 5 fps, severe = 0.5 fps and no
   * video, critical or worse = camera paused. Battery (not charging): under 20 % = half rate and
   * 5 fps video, under 10 % = 0.5 fps and no video. Low memory: 0.5 fps (embedding needs RAM).
   * The strongest cut wins; its cause is the reason (heat before battery before memory on ties).
   */
  fun rates(targetFps: Float, targetVideoFps: Int, recordVideo: Boolean, s: DeviceState): Rates {
    val base = Rates(targetFps, targetVideoFps, recordVideo, false, null)
    val heat =
      when {
        s.thermalStatus >= 4 -> Rates(0f, 0, false, true, "heat")
        s.thermalStatus == 3 -> Rates(min(targetFps, MIN_FPS), 0, false, false, "heat")
        s.thermalStatus == 2 -> Rates(half(targetFps), min(targetVideoFps, 5), recordVideo, false, "heat")
        else -> base
      }
    val battery =
      when {
        s.charging -> base
        s.batteryPct < 10 -> Rates(min(targetFps, MIN_FPS), 0, false, false, "battery")
        s.batteryPct < 20 -> Rates(half(targetFps), min(targetVideoFps, 5), recordVideo, false, "battery")
        else -> base
      }
    val memory = if (s.lowMemory) Rates(min(targetFps, MIN_FPS), targetVideoFps, recordVideo, false, "memory") else base
    val all = listOf(heat, battery, memory)
    val out =
      Rates(
        sampleFps = all.minOf { it.sampleFps },
        videoFps = all.minOf { it.videoFps },
        recordVideo = all.all { it.recordVideo },
        paused = all.any { it.paused },
        reason = null,
      )
    val reason = all.filter { it.reason != null }.minByOrNull { severity(it) }?.reason
    return if (out == base.copy(reason = null)) base else out.copy(reason = reason)
  }

  /** Lower = stronger cut. */
  private fun severity(r: Rates): Float = if (r.paused) -1f else r.sampleFps + (if (r.recordVideo) r.videoFps / 100f else 0f)

  private fun half(fps: Float) = if (fps <= MIN_FPS) fps else max(MIN_FPS, fps / 2)
}

/**
 * Applies slow-downs at once but only speeds back up after conditions have been better for
 * [recoverMs], so a phone hovering at a threshold doesn't flip every few seconds.
 */
class ThrottleGovernor(private val recoverMs: Long = 120_000) {
  var current: Rates? = null
    private set
  private var betterSince = Long.MIN_VALUE

  /** Returns the new rates when they should change now, else null. */
  fun update(wanted: Rates, now: Long): Rates? {
    val cur = current
    if (cur == null) {
      current = wanted
      return wanted
    }
    if (wanted == cur) {
      betterSince = Long.MIN_VALUE
      return null
    }
    if (isSlower(wanted, cur)) {
      current = wanted
      betterSince = Long.MIN_VALUE
      return wanted
    }
    if (betterSince == Long.MIN_VALUE) betterSince = now
    if (now - betterSince < recoverMs) return null
    current = wanted
    betterSince = Long.MIN_VALUE
    return wanted
  }

  fun reset() {
    current = null
    betterSince = Long.MIN_VALUE
  }

  private fun isSlower(a: Rates, b: Rates) =
    (a.paused && !b.paused) || a.sampleFps < b.sampleFps || a.videoFps < b.videoFps || (!a.recordVideo && b.recordVideo)
}

/** Files are grouped in one folder per hour ("h<hours since 1970>"), so no folder gets huge. */
object HourBuckets {
  const val HOUR_MS = 3_600_000L

  fun name(atMs: Long) = "h${atMs / HOUR_MS}"

  /** Start of the hour a folder holds, or null if [name] isn't a bucket. */
  fun start(name: String): Long? = name.takeIf { it.startsWith("h") }?.substring(1)?.toLongOrNull()?.times(HOUR_MS)

  /** Bucket names that can hold anything between [fromMs] and [toMs] (a segment may start up to [slackMs] earlier). */
  fun covering(fromMs: Long, toMs: Long, slackMs: Long = 0): List<String> {
    val first = (fromMs - slackMs) / HOUR_MS
    val last = toMs / HOUR_MS
    if (last < first) return emptyList()
    return (first..last).map { "h$it" }
  }
}

data class Segment(val path: String, val startMs: Long, val endMs: Long)

/** A piece of a video segment: play [path] from [offsetMs] for [durationMs]. */
data class SegmentSlice(val path: String, val startMs: Long, val endMs: Long, val offsetMs: Long, val durationMs: Long)

/** Video segments are named "seg_<startMs>_<endMs>.mp4" once closed (".part" while recording). */
object SegmentIndex {
  fun name(startMs: Long, endMs: Long) = "seg_${startMs}_$endMs.mp4"

  fun parse(fileName: String): Pair<Long, Long>? {
    if (!fileName.startsWith("seg_") || !fileName.endsWith(".mp4")) return null
    val parts = fileName.removePrefix("seg_").removeSuffix(".mp4").split("_")
    if (parts.size != 2) return null
    val s = parts[0].toLongOrNull() ?: return null
    val e = parts[1].toLongOrNull() ?: return null
    return if (e >= s) s to e else null
  }

  /** Segments overlapping [fromMs, toMs], oldest first, each trimmed to that window. */
  fun between(segments: List<Segment>, fromMs: Long, toMs: Long): List<SegmentSlice> =
    segments
      .filter { it.endMs > fromMs && it.startMs < toMs }
      .sortedBy { it.startMs }
      .map {
        val from = max(fromMs, it.startMs)
        val to = min(toMs, it.endMs)
        SegmentSlice(it.path, it.startMs, it.endMs, from - it.startMs, to - from)
      }
}

/** Keyframes are named "<atMs>.jpg". */
object FrameIndex {
  fun parse(fileName: String): Long? = fileName.takeIf { it.endsWith(".jpg") }?.removeSuffix(".jpg")?.toLongOrNull()

  /**
   * [n] keyframes around [atMs], [spacingMs] apart (e.g. 3 frames ~1 s apart for movement): for each
   * wanted time the nearest keyframe within [spacingMs] (or within [toleranceMs] for the centre),
   * without repeats, oldest first. [times] need not be sorted.
   */
  fun around(times: List<Long>, atMs: Long, n: Int, spacingMs: Long, toleranceMs: Long = max(spacingMs, 5_000)): List<Long> {
    if (n <= 0 || times.isEmpty()) return emptyList()
    val sorted = times.sorted()
    val picked = LinkedHashSet<Long>()
    val half = (n - 1) / 2.0
    for (i in 0 until n) {
      val want = atMs + ((i - half) * spacingMs).toLong()
      val tol = if (i.toDouble() == half || n == 1) toleranceMs else max(spacingMs / 2, 1)
      val near = nearest(sorted, want, picked) ?: continue
      if (abs(near - want) <= tol) picked.add(near)
    }
    return picked.sorted()
  }

  /** The last [n] keyframes up to [beforeMs], oldest first. */
  fun latest(times: List<Long>, n: Int, beforeMs: Long = Long.MAX_VALUE): List<Long> =
    times.filter { it <= beforeMs }.sorted().takeLast(n)

  private fun nearest(sorted: List<Long>, want: Long, exclude: Set<Long>): Long? {
    var idx = sorted.binarySearch(want)
    if (idx < 0) idx = -idx - 1
    var best: Long? = null
    var lo = idx - 1
    var hi = idx
    while (lo >= 0 || hi < sorted.size) {
      val cands = listOfNotNull(sorted.getOrNull(lo), sorted.getOrNull(hi)).filter { it !in exclude }
      val c = cands.minByOrNull { abs(it - want) }
      if (c != null) {
        best = c
        break
      }
      lo--
      hi++
    }
    return best
  }
}

/** One hour folder of one kind and its size. */
data class Bucket(val kind: String, val path: String, val startMs: Long, val bytes: Long) {
  val endMs get() = startMs + HourBuckets.HOUR_MS
}

data class RetentionPlan(val delete: List<String>, val freedBytes: Long, val stillShortBytes: Long)

/**
 * What to delete (whole hour folders). Kinds: "video", "stills", "frames".
 * - Video older than [keepVideoMs] goes, then the oldest video beyond [maxVideoBytes] (0 = no cap).
 * - Stills older than [keepStillsMs] go (0 = keep).
 * - If free space is still under [reserveBytes]: the oldest video goes first, then the oldest
 *   stills older than [minStillAgeMs]. Keyframes back the search vectors, so they are never deleted
 *   here; [stillShortBytes] says how much is still missing (JS asks the user).
 * The current hour's video is never deleted (it is being written).
 */
object Retention {
  fun plan(
    buckets: List<Bucket>,
    now: Long,
    freeBytes: Long,
    reserveBytes: Long,
    keepVideoMs: Long,
    maxVideoBytes: Long = 0,
    keepStillsMs: Long = 0,
    minStillAgeMs: Long = 7 * 24 * HourBuckets.HOUR_MS,
  ): RetentionPlan {
    val currentHour = (now / HourBuckets.HOUR_MS) * HourBuckets.HOUR_MS
    val delete = LinkedHashSet<Bucket>()
    val video = buckets.filter { it.kind == "video" && it.startMs < currentHour }.sortedBy { it.startMs }
    if (keepVideoMs > 0) video.filter { it.endMs <= now - keepVideoMs }.forEach { delete.add(it) }
    if (maxVideoBytes > 0) {
      var total = buckets.filter { it.kind == "video" && it !in delete }.sumOf { it.bytes }
      for (b in video) {
        if (total <= maxVideoBytes) break
        if (delete.add(b)) total -= b.bytes
      }
    }
    val stills = buckets.filter { it.kind == "stills" && it.startMs < currentHour }.sortedBy { it.startMs }
    if (keepStillsMs > 0) stills.filter { it.endMs <= now - keepStillsMs }.forEach { delete.add(it) }
    var free = freeBytes + delete.sumOf { it.bytes }
    for (b in video + stills.filter { it.endMs <= now - minStillAgeMs }) {
      if (free >= reserveBytes) break
      if (delete.add(b)) free += b.bytes
    }
    val ordered = delete.sortedWith(compareBy({ it.kind != "video" }, { it.startMs }))
    return RetentionPlan(ordered.map { it.path }, ordered.sumOf { it.bytes }, max(0, reserveBytes - free))
  }

  /** Recommended reserve: max(2 GB, 10 % of the phone's storage). */
  fun recommendedReserve(totalBytes: Long): Long = max(2L * 1024 * 1024 * 1024, totalBytes / 10)
}

/** Whether the camera should be filming now (besides heat / battery throttling). */
object CaptureLogicLock {
  fun shouldFilm(userPaused: Boolean, lockPaused: Boolean) = !userPaused && !lockPaused
}

/** The listening service's notification wording and buttons (pure, for tests). */
object ServiceNotice {
  data class Text(val title: String, val body: String, val actions: List<String>)

  /** Actions: "pauseCamera" / "resumeCamera", "stopCamera" (when the mic stays on), "stop". */
  fun text(
    listening: Boolean,
    cameraOn: Boolean,
    cameraPaused: Boolean,
    lockPaused: Boolean,
    micPauseReason: String?,
    wakePhrase: String,
  ): Text {
    val title =
      when {
        micPauseReason != null && !cameraOn -> "Sidekick is paused ($micPauseReason)"
        cameraOn && cameraPaused && listening -> "Sidekick is listening (camera paused)"
        cameraOn && cameraPaused -> "Sidekick camera is paused"
        cameraOn && lockPaused && listening -> "Sidekick is listening (camera off while locked)"
        cameraOn && lockPaused -> "Sidekick camera is off while the phone is locked"
        cameraOn && listening -> "Sidekick is watching and listening"
        cameraOn -> "Sidekick camera is on"
        else -> "Sidekick is listening"
      }
    val body =
      when {
        micPauseReason != null && listening ->
          "Not listening or keeping anything until this ends. Hold the mic button to ask."
        listening -> "Say \"$wakePhrase\". Everything stays on this phone."
        else -> "Not listening. Everything stays on this phone."
      }
    val actions = buildList {
      if (cameraOn) add(if (cameraPaused) "resumeCamera" else "pauseCamera")
      if (cameraOn && listening) add("stopCamera")
      add("stop")
    }
    return Text(title, body, actions)
  }
}

/**
 * A USB camera that opened but sends no picture (a loose plug, or a link that came back at slow
 * USB 1.1 speed after a replug): stalled once [limitMs] pass with no frame since it started or
 * since the last frame.
 */
object UsbStall {
  const val LIMIT_MS = 8_000L

  fun stalled(startedAt: Long, lastFrameAt: Long?, now: Long, limitMs: Long = LIMIT_MS): Boolean =
    now - (lastFrameAt ?: startedAt) >= limitMs
}
