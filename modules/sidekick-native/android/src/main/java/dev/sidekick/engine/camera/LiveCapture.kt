package dev.sidekick.engine.camera

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.StatFs
import android.util.Log
import dev.sidekick.engine.Embedder
import dev.sidekick.engine.Engines
import dev.sidekick.engine.Ocr
import dev.sidekick.engine.Places
import dev.sidekick.engine.usb.UsbCameras
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Live camera memory, run by the foreground service while the camera is on:
 * - video in short closed segments (SegmentRecorder), deleted on a rolling basis;
 * - frames sampled at [CaptureConfig.sampleFps], near-repeats skipped, kept ones saved as small
 *   keyframes and embedded with EmbeddingGemma 2 (never while the chat model holds the RAM on a
 *   small phone, nor while JS holds background work during an answer); text in view triggers a
 *   full-resolution still for OCR;
 * - slows down for heat, low battery and low memory, telling JS why (a notice).
 * Embedded frames go to [FrameJournal] for JS to drain into memory (kind "frame").
 */
object LiveCapture {
  private const val TAG = "SidekickCapture"
  private const val MB = 1024L * 1024
  private const val WAKE_MS = 10 * 60_000L

  /** Events for JS ("onCamera"): {kind: "status" | "throttle" | "storage" | "lost", ...}. */
  @Volatile var listener: ((Map<String, Any?>) -> Unit)? = null

  /** Makes the USB camera source (null when none is open); replaceable for tests. */
  @Volatile var usbSourceFactory: (Context, CaptureConfig, Rates) -> FrameSource? = { _, _, r ->
    UsbCameras.source?.let { UsbCameraAdapter(it, r) }
  }

  /** "usb" or "phone": what is actually filming (a USB camera wins when one is open). */
  @Volatile var activeSource: String? = null
    private set

  @Volatile var config = CaptureConfig()
    private set
  @Volatile var running = false
    private set
  /** JS holds background work while it answers (frames still get saved, just not embedded). */
  @Volatile var hold = false

  /** Paused from the notification (or by voice): the camera is released until resumed. */
  @Volatile var userPaused = false
    private set
  /** Screen off with [CaptureConfig.whileLocked] false: released until the phone is unlocked. */
  @Volatile var lockPaused = false
    private set
  /** Keeps the CPU running with the screen off while filming (frames, encoder, USB transfers). */
  private var wakeLock: PowerManager.WakeLock? = null

  private var app: Context? = null
  private var source: FrameSource? = null
  private var recorder: SegmentRecorder? = null
  private val governor = ThrottleGovernor()
  @Volatile private var rates: Rates? = null
  @Volatile private var videoBlockedForSpace = false
  @Volatile private var lastOcrAt = 0L
  @Volatile private var lastStorageEventAt = 0L
  @Volatile private var framesKept = 0
  @Volatile private var framesSeen = 0
  @Volatile private var startedAt = 0L
  private val dedupe = FrameDedupe()
  /** The USB camera opened but sent no picture: use the phone camera until it is re-plugged. */
  @Volatile private var usbNoPicture = false
  private val live = ArrayDeque<Pair<Long, String>>()

  private val work = Executors.newSingleThreadScheduledExecutor { Thread(it, "sidekick-capture") }
  private val embedExec = Executors.newSingleThreadScheduledExecutor { Thread(it, "sidekick-embed-frames") }
  private var monitor: ScheduledFuture<*>? = null
  private var retention: ScheduledFuture<*>? = null
  @Volatile private var embedScheduled = false
  private val sizeCache = HashMap<String, Long>()

  fun root(ctx: Context) = File(ctx.filesDir, "camera")
  private fun videoDir(ctx: Context) = File(root(ctx), "video")
  private fun framesDir(ctx: Context) = File(root(ctx), "frames")
  private fun stillsDir(ctx: Context) = File(root(ctx), "stills")
  private fun pendingDir(ctx: Context) = File(root(ctx), "pending").apply { mkdirs() }
  private fun liveDir(ctx: Context) = File(ctx.cacheDir, "camera-live").apply { mkdirs() }

  /** New settings; applied now if the camera is running (the camera restarts briefly). */
  @Synchronized
  fun configure(cfg: CaptureConfig) {
    val changed = cfg != config
    config = cfg
    dedupe.threshold = cfg.dedupeThreshold
    dedupe.maxGapMs = cfg.keyframeMaxGapSec * 1000L
    if (changed && running) {
      work.execute {
        governor.reset()
        rates = null
        checkDevice()
      }
    }
  }

  /** Called by the foreground service (camera type) once it runs. */
  @Synchronized
  fun start(ctx: Context) {
    if (running) return
    val c = ctx.applicationContext
    app = c
    running = true
    startedAt = System.currentTimeMillis()
    framesKept = 0
    framesSeen = 0
    dedupe.reset()
    governor.reset()
    rates = null
    // USB camera plugged in or out while filming: switch camera (USB first, else the phone's).
    usbNoPicture = false
    UsbCameras.onSource = { src ->
      if (src != null) usbNoPicture = false
      if (running && config.source != "phone") work.execute {
        if (src == null && activeSource == "usb") emit(mapOf("kind" to "lost", "reason" to "usb unplugged", "fallback" to "phone"))
        restartSource()
      }
    }
    work.execute {
      SegmentRecorder.cleanParts(videoDir(c))
      checkDevice()
      if (rates == null) restartSource()
    }
    monitor = work.scheduleWithFixedDelay({ safely { checkDevice() } }, 15, 15, TimeUnit.SECONDS)
    retention = work.scheduleWithFixedDelay({ safely { enforceRetention() } }, 5, 60, TimeUnit.SECONDS)
    scheduleEmbed(0)
    acquireWake(c)
    emit(mapOf("kind" to "status", "running" to true))
  }

  /** Pause or resume from the notification / a voice command (the service keeps running). */
  fun setUserPaused(p: Boolean) {
    if (userPaused == p) return
    userPaused = p
    if (running) work.execute { restartSource() }
    emit(mapOf("kind" to "status", "running" to running, "userPaused" to p))
  }

  /** Screen turned off ([off]) or the phone was unlocked: pauses only if filming while locked is off. */
  fun onScreen(off: Boolean) {
    val pause = off && !config.whileLocked
    if (pause == lockPaused) return
    lockPaused = pause
    if (running) work.execute { restartSource() }
  }

  @Synchronized
  private fun acquireWake(ctx: Context) {
    if (wakeLock?.isHeld == true) return
    val pm = ctx.getSystemService(PowerManager::class.java) ?: return
    // Renewed by the 15 s device check while filming; the timeout is a safety net if stop is missed.
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sidekick:camera").apply {
      setReferenceCounted(false)
      acquire(WAKE_MS)
    }
  }

  @Synchronized
  private fun releaseWake() {
    runCatching { wakeLock?.takeIf { it.isHeld }?.release() }
    wakeLock = null
  }

  @Synchronized
  fun stop() {
    if (!running) return
    running = false
    monitor?.cancel(false)
    retention?.cancel(false)
    UsbCameras.onSource = null
    work.execute {
      stopSource()
      activeSource = null
    }
    releaseWake()
    lockPaused = false
    emit(mapOf("kind" to "status", "running" to false))
  }

  fun status(): Map<String, Any?> {
    val r = rates
    return mapOf(
      "running" to running,
      "source" to config.source,
      "activeSource" to activeSource,
      "paused" to (r?.paused ?: false),
      "sampleFps" to (r?.sampleFps ?: config.sampleFps).toDouble(),
      "videoFps" to (r?.videoFps ?: config.videoFps),
      "recording" to (running && r?.recordVideo == true && !videoBlockedForSpace && r?.paused != true),
      "reason" to r?.reason,
      "videoBlockedForSpace" to videoBlockedForSpace,
      "framesSeen" to framesSeen,
      "framesKept" to framesKept,
      "userPaused" to userPaused,
      "lockPaused" to lockPaused,
      "pendingEmbeds" to (app?.let { pendingDir(it).list()?.size } ?: 0),
      "startedAt" to if (running) startedAt else null,
    )
  }

  // --- camera ---------------------------------------------------------------------------------

  /** On [work]. Stops the current source and starts one at the current rates (unless paused). */
  private fun restartSource() {
    val ctx = app ?: return
    stopSource()
    if (!running) return
    val r = rates ?: ThrottlePolicy.rates(config.sampleFps, config.videoFps, config.recordVideo, DeviceState()).also { rates = it }
    if (r.paused || !CaptureLogicLock.shouldFilm(userPaused, lockPaused)) return
    val cfg = config
    val usb = if (cfg.source != "phone" && !usbNoPicture) runCatching { usbSourceFactory(ctx, cfg, r) }.getOrNull() else null
    val src = usb ?: PhoneCameraSource(ctx, cfg, r)
    val now = if (usb != null) "usb" else "phone"
    if (cfg.source == "usb" && usb == null && activeSource != "phone") emit(mapOf("kind" to "lost", "reason" to "no usb camera", "fallback" to "phone"))
    activeSource = now
    if (r.recordVideo && !videoBlockedForSpace) {
      val rec = SegmentRecorder(videoDir(ctx), r.videoFps, cfg.videoBitrate, cfg.segmentSec * 1000L, cfg.codec) { seg -> onSegment(seg) }
      recorder = rec
      src.videoSink = rec
    }
    src.onLost = { reason ->
      work.execute {
        if (reason == UsbCameraAdapter.NO_PICTURE) {
          // Open but silent: film with the phone camera until the USB camera is plugged in again.
          usbNoPicture = true
          emit(mapOf("kind" to "lost", "reason" to "usb no picture", "fallback" to "phone"))
          activeSource = "phone" // so the restart doesn't report it again as unplugged
          restartSource()
        } else {
          lost(reason)
        }
      }
    }
    source = src
    Log.i(TAG, "camera source $now: sample ${r.sampleFps} fps, video ${if (r.recordVideo) "${r.videoFps} fps" else "off"}")
    src.start { frame -> safely { onFrame(ctx, frame) } }
  }

  private fun stopSource() {
    source?.stop()
    source = null
    val rec = recorder
    recorder = null
    // The camera releases the encoder surface itself; close anyway in case it never does.
    if (rec != null) work.schedule({ rec.close() }, 2, TimeUnit.SECONDS)
  }

  private fun lost(reason: String) {
    Log.w(TAG, "camera lost: $reason")
    stopSource()
    emit(mapOf("kind" to "lost", "reason" to reason))
  }

  private fun onSegment(seg: Segment) {
    Log.i(TAG, "video segment ${File(seg.path).name}")
    synchronized(sizeCache) { sizeCache.remove(File(seg.path).parent) }
  }

  // --- frames ---------------------------------------------------------------------------------

  /** On the source's frame thread. */
  private fun onFrame(ctx: Context, frame: Frame) {
    if (!running) return
    framesSeen++
    val cfg = config
    val bmp = frame.bitmap
    saveLive(ctx, bmp, frame.atMs, cfg.liveFrames)
    if (!dedupe.keep(lumaGrid(bmp), frame.atMs)) return
    framesKept++
    if (framesKept == 1 || framesKept % 50 == 0) Log.i(TAG, "frames kept $framesKept of $framesSeen")
    val at = frame.atMs
    val bucket = HourBuckets.name(at)
    val key = File(File(framesDir(ctx), bucket).apply { mkdirs() }, "$at.jpg")
    writeJpeg(scaled(bmp, cfg.keyframeEdge), key, 75)

    var stillPath: String? = null
    val r = rates
    if (cfg.ocrDetPath != null && cfg.ocrRecPath != null && cfg.ocrDictPath != null && r?.reason == null && at - lastOcrAt >= cfg.ocrEveryMs) {
      lastOcrAt = at
      val text = runCatching { Ocr.hasText(cfg.ocrDetPath, cfg.ocrRecPath, cfg.ocrDictPath, bmp) }.getOrDefault(false)
      if (text) {
        val still = File(File(stillsDir(ctx), bucket).apply { mkdirs() }, "$at.jpg")
        stillPath = still.absolutePath
        val src = source
        if (src == null) writeJpeg(bmp, still, 92)
        else src.takeStill(still) { ok -> if (!ok) safely { writeJpeg(bmp, still, 92) } }
      }
    }
    val entry =
      Places.tag(
        JSONObject()
          .put("kind", "frame")
          .put("at", at)
          .put("path", key.absolutePath)
          .put("ocrNeeded", stillPath != null)
          .put("stillPath", stillPath ?: JSONObject.NULL)
          .put("source", activeSource ?: cfg.source)
      )
    File(pendingDir(ctx), "$at.json").writeText(entry.toString())
    scheduleEmbed(0)
  }

  private fun saveLive(ctx: Context, bmp: Bitmap, at: Long, keep: Int) {
    val f = File(liveDir(ctx), "live_$at.jpg")
    writeJpeg(bmp, f, 85)
    synchronized(live) {
      live.addLast(at to f.absolutePath)
      while (live.size > keep) File(live.removeFirst().second).delete()
    }
  }

  /** 32×18 brightness grid for [FrameDedupe]. */
  private fun lumaGrid(bmp: Bitmap): IntArray {
    val small = Bitmap.createScaledBitmap(bmp, 32, 18, true)
    val px = IntArray(32 * 18)
    small.getPixels(px, 0, 32, 0, 0, 32, 18)
    if (small !== bmp) small.recycle()
    return IntArray(px.size) {
      val p = px[it]
      ((p shr 16 and 0xff) * 299 + (p shr 8 and 0xff) * 587 + (p and 0xff) * 114) / 1000
    }
  }

  // --- embedding ------------------------------------------------------------------------------

  private fun scheduleEmbed(delaySec: Long) {
    synchronized(this) {
      if (embedScheduled) return
      embedScheduled = true
    }
    embedExec.schedule({
      synchronized(this) { embedScheduled = false }
      val next = safely { embedPending() } ?: 30L
      if (next >= 0) scheduleEmbed(next)
    }, delaySec, TimeUnit.SECONDS)
  }

  /** Embeds up to a batch of waiting frames; returns seconds until the next try, or -1 if none wait. */
  private fun embedPending(): Long {
    val ctx = app ?: return -1
    val files = pendingDir(ctx).listFiles { f -> f.name.endsWith(".json") }?.sortedBy { it.name } ?: return -1
    if (files.isEmpty()) return -1
    val cfg = config
    val model = cfg.embedModelPath?.takeIf { File(it).exists() }
    if (model != null && !canEmbed(ctx)) return 5
    val batch = files.take(4)
    val entries = batch.mapNotNull { f -> runCatching { JSONObject(f.readText()) }.getOrNull()?.let { f to it } }
    val usable = entries.filter { File(it.second.optString("path")).exists() }
    val vectors =
      if (model == null || usable.isEmpty()) null
      else Embedder.embedImages(ctx, model, usable.map { it.second.getString("path") }, cfg.dims)
    usable.forEachIndexed { i, (_, e) ->
      e.put("vector", vectors?.get(i)?.let { v -> JSONArray().apply { v.forEach { put(it.toDouble()) } } } ?: JSONObject.NULL)
      FrameJournal.append(ctx, e)
    }
    batch.forEach { it.delete() }
    Log.i(TAG, "journaled ${usable.size} frames (${if (vectors == null) "no vectors" else "embedded"})")
    return if (files.size > batch.size) 0 else -1
  }

  /** Never the embedder beside the chat model on a small phone, and never during an answer. */
  private fun canEmbed(ctx: Context): Boolean {
    if (hold) return false
    return !(Embedder.mustBeAlone(ctx) && Engines.llm(ctx).loaded != null)
  }

  // --- device state ---------------------------------------------------------------------------

  /** On [work]. Reads heat / battery / memory and changes rates when needed. */
  private fun checkDevice() {
    val ctx = app ?: return
    if (!running) return
    wakeLock?.let { if (it.isHeld) it.acquire(WAKE_MS) }
    val s = deviceState(ctx)
    val cfg = config
    val wanted = ThrottlePolicy.rates(cfg.sampleFps, cfg.videoFps, cfg.recordVideo, s)
    val before = rates
    val now = governor.update(wanted, System.currentTimeMillis()) ?: return
    if (now == before) return
    rates = now
    if (before != null) {
      emit(
        mapOf(
          "kind" to "throttle",
          "from" to before.sampleFps.toDouble(),
          "to" to now.sampleFps.toDouble(),
          "videoFrom" to if (before.recordVideo) before.videoFps else 0,
          "videoTo" to if (now.recordVideo) now.videoFps else 0,
          "paused" to now.paused,
          "reason" to now.reason,
          "tempC" to s.tempC?.toDouble(),
          "batteryPct" to s.batteryPct,
        )
      )
    }
    restartSource()
  }

  fun deviceState(ctx: Context): DeviceState {
    val thermal =
      if (Build.VERSION.SDK_INT >= 29) ctx.getSystemService(PowerManager::class.java)?.currentThermalStatus ?: 0 else 0
    val battery = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
    val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
    val temp = battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE) ?: Int.MIN_VALUE
    val mem = ActivityManager.MemoryInfo()
    (ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(mem)
    return DeviceState(
      thermalStatus = thermal,
      batteryPct = if (level >= 0 && scale > 0) level * 100 / scale else 100,
      charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL,
      lowMemory = mem.lowMemory,
      tempC = if (temp == Int.MIN_VALUE) null else temp / 10f,
    )
  }

  // --- storage --------------------------------------------------------------------------------

  /** On [work]: deletes old video (and stills past their keep period); keeps the reserve free. */
  private fun enforceRetention() {
    val ctx = app ?: return
    val cfg = config
    val stat = StatFs(ctx.filesDir.absolutePath)
    val reserve = if (cfg.reserveMb > 0) cfg.reserveMb * MB else Retention.recommendedReserve(stat.totalBytes)
    val buckets = buckets(ctx, "video", videoDir(ctx)) + buckets(ctx, "stills", stillsDir(ctx))
    val plan =
      Retention.plan(
        buckets,
        now = System.currentTimeMillis(),
        freeBytes = stat.availableBytes,
        reserveBytes = reserve,
        keepVideoMs = cfg.keepVideoHours * HourBuckets.HOUR_MS,
        maxVideoBytes = cfg.maxVideoMb * MB,
        keepStillsMs = cfg.keepStillsDays * 24 * HourBuckets.HOUR_MS,
      )
    plan.delete.forEach {
      File(it).deleteRecursively()
      synchronized(sizeCache) { sizeCache.remove(it) }
    }
    if (plan.delete.isNotEmpty()) Log.i(TAG, "freed ${plan.freedBytes / MB} MB (${plan.delete.size} hours)")
    val blocked = plan.stillShortBytes > 0
    if (blocked != videoBlockedForSpace) {
      videoBlockedForSpace = blocked
      if (running) restartSource()
    }
    val now = System.currentTimeMillis()
    if (blocked && now - lastStorageEventAt > HourBuckets.HOUR_MS) {
      lastStorageEventAt = now
      emit(mapOf("kind" to "storage", "reason" to "reserve", "shortBytes" to plan.stillShortBytes, "video" to false))
    } else if (!blocked && lastStorageEventAt != 0L) {
      lastStorageEventAt = 0L
      emit(mapOf("kind" to "storage", "reason" to "ok", "shortBytes" to 0L, "video" to true))
    }
  }

  private fun buckets(ctx: Context, kind: String, dir: File): List<Bucket> {
    val currentHour = HourBuckets.name(System.currentTimeMillis())
    return dir.listFiles()?.mapNotNull { d ->
      val start = HourBuckets.start(d.name) ?: return@mapNotNull null
      val path = d.absolutePath
      val bytes =
        if (d.name == currentHour) dirBytes(d)
        else synchronized(sizeCache) { sizeCache.getOrPut(path) { dirBytes(d) } }
      Bucket(kind, path, start, bytes)
    } ?: emptyList()
  }

  private fun dirBytes(d: File): Long = d.listFiles()?.sumOf { if (it.isDirectory) dirBytes(it) else it.length() } ?: 0L

  /** Bytes per kind (video, stills, keyframes, waiting) plus free / total / reserve. */
  fun storageUsage(ctx: Context): Map<String, Any?> {
    val stat = StatFs(ctx.filesDir.absolutePath)
    val cfg = config
    return mapOf(
      "videoBytes" to dirBytes(videoDir(ctx)),
      "stillsBytes" to dirBytes(stillsDir(ctx)),
      "framesBytes" to dirBytes(framesDir(ctx)),
      "pendingBytes" to dirBytes(pendingDir(ctx)),
      "freeBytes" to stat.availableBytes,
      "totalBytes" to stat.totalBytes,
      "reserveBytes" to if (cfg.reserveMb > 0) cfg.reserveMb * MB else Retention.recommendedReserve(stat.totalBytes),
      "oldestVideoAt" to (videoDir(ctx).list()?.mapNotNull { HourBuckets.start(it) }?.minOrNull()),
    )
  }

  // --- queries --------------------------------------------------------------------------------

  /** Closed video segments overlapping [fromMs, toMs], each with where to start and how long. */
  fun videoSegmentsBetween(ctx: Context, fromMs: Long, toMs: Long): List<Map<String, Any>> {
    val root = videoDir(ctx)
    val segs =
      HourBuckets.covering(fromMs, toMs, slackMs = 10 * 60_000).flatMap { b ->
        File(root, b).listFiles()?.mapNotNull { f -> SegmentIndex.parse(f.name)?.let { Segment(f.absolutePath, it.first, it.second) } }
          ?: emptyList()
      }
    return SegmentIndex.between(segs, fromMs, toMs).map {
      mapOf("path" to it.path, "startMs" to it.startMs, "endMs" to it.endMs, "offsetMs" to it.offsetMs, "durationMs" to it.durationMs)
    }
  }

  /** Up to [n] keyframes [spacingMs] apart around [atMs] (paths with times, oldest first). */
  fun framesAround(ctx: Context, atMs: Long, n: Int, spacingMs: Long): List<Map<String, Any>> {
    val reach = n * spacingMs + 60_000
    val files = keyframes(ctx, atMs - reach, atMs + reach)
    return FrameIndex.around(files.keys.toList(), atMs, n, spacingMs).map { mapOf("at" to it, "path" to files.getValue(it)) }
  }

  /** The newest [n] frames for a live question (oldest first); from keyframes if the camera is off. */
  fun latestFrames(ctx: Context, n: Int): List<Map<String, Any>> {
    val fromLive =
      synchronized(live) { live.toList() }.filter { File(it.second).exists() }.takeLast(n)
    if (fromLive.isNotEmpty() && running) return fromLive.map { mapOf("at" to it.first, "path" to it.second) }
    val now = System.currentTimeMillis()
    val files = keyframes(ctx, now - 2 * HourBuckets.HOUR_MS, now)
    return FrameIndex.latest(files.keys.toList(), n).map { mapOf("at" to it, "path" to files.getValue(it)) }
  }

  private fun keyframes(ctx: Context, fromMs: Long, toMs: Long): Map<Long, String> {
    val out = HashMap<Long, String>()
    for (b in HourBuckets.covering(fromMs, toMs)) {
      File(framesDir(ctx), b).listFiles()?.forEach { f -> FrameIndex.parse(f.name)?.let { if (it in fromMs..toMs) out[it] = f.absolutePath } }
    }
    return out
  }

  // --- helpers --------------------------------------------------------------------------------

  private fun emit(body: Map<String, Any?>) {
    runCatching { listener?.invoke(body) }
  }

  private inline fun <T> safely(block: () -> T): T? =
    try {
      block()
    } catch (e: Throwable) {
      Log.w(TAG, "capture step failed", e)
      null
    }

  private fun scaled(bmp: Bitmap, edge: Int): Bitmap {
    val long = maxOf(bmp.width, bmp.height)
    if (long <= edge) return bmp
    val s = edge.toFloat() / long
    return Bitmap.createScaledBitmap(bmp, (bmp.width * s).toInt(), (bmp.height * s).toInt(), true)
  }

  private fun writeJpeg(bmp: Bitmap, f: File, quality: Int) {
    val tmp = File(f.parentFile, f.name + ".tmp")
    FileOutputStream(tmp).use { bmp.compress(Bitmap.CompressFormat.JPEG, quality, it) }
    tmp.renameTo(f)
  }
}

/** Embedded frames waiting for JS (JSON lines {kind:"frame", at, path, vector, ocrNeeded, stillPath, source, lat?, lon?}). */
object FrameJournal {
  private fun file(ctx: Context) = File(ctx.filesDir, "data/frames.jsonl").apply { parentFile?.mkdirs() }

  @Synchronized
  fun append(ctx: Context, entry: JSONObject) {
    file(ctx).appendText(entry.toString() + "\n")
  }

  /** Everything since the last drain (cleared). [max] caps a drain so JS can work in chunks. */
  @Synchronized
  fun drain(ctx: Context, max: Int = Int.MAX_VALUE): List<String> {
    val f = file(ctx)
    if (!f.exists()) return emptyList()
    val lines = f.readLines().filter { it.isNotBlank() }
    if (lines.size <= max) {
      f.delete()
      return lines
    }
    f.writeText(lines.drop(max).joinToString("\n", postfix = "\n"))
    return lines.take(max)
  }
}
