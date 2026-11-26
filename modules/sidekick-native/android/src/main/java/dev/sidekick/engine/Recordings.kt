package dev.sidekick.engine

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Build
import android.os.IBinder
import android.os.Process
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.ByteOrder
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * A recording shared into Sidekick (voice memo, meeting): decoded with Android's own codecs,
 * then run through the same speech pipeline as Listen (Silero VAD → lines cut where the voice
 * changes → Parakeet words → CAM++ voiceprints), streaming, so a long recording never sits in
 * memory. Lines go to an app-private file as they are made; after a kill the job carries on
 * from the last finished line. JS groups the voiceprints into speakers (src/engine/shared-doc).
 * While it runs, [RecordingService] keeps the app alive with a progress notification.
 */
object Recordings {
  private const val TAG = "SidekickRecordings"
  private const val MIN_SEC = 0.4f
  private const val MIN_DBFS = -80.0
  private const val VOICEPRINT_SEC = 1.5f

  private class Job(val id: String, @Volatile var cancelled: Boolean = false)

  @Volatile private var running: Job? = null
  /** Called on progress and at the end (IntegrationsModule sends it to JS). */
  @Volatile var onProgress: ((Map<String, Any?>) -> Unit)? = null

  private fun dir(ctx: Context) = File(ctx.filesDir, "data/recordings").apply { mkdirs() }
  private fun linesFile(ctx: Context, id: String) = File(dir(ctx), "$id.jsonl")
  private fun stateFile(ctx: Context, id: String) = File(dir(ctx), "$id.json")

  private fun readState(ctx: Context, id: String): JSONObject? =
    try {
      stateFile(ctx, id).takeIf { it.isFile }?.let { JSONObject(it.readText()) }
    } catch (e: Exception) {
      null
    }

  private fun writeState(ctx: Context, id: String, s: JSONObject) {
    val f = stateFile(ctx, id)
    val tmp = File(f.parentFile, "${f.name}.tmp")
    tmp.writeText(s.toString())
    tmp.renameTo(f)
  }

  /** {id, doneMs, totalMs, finished, error, running} or null for an unknown job. */
  fun status(ctx: Context, id: String): Map<String, Any?>? {
    val s = readState(ctx, id) ?: return null
    return mapOf(
      "id" to id,
      "doneMs" to s.optDouble("doneMs", 0.0),
      "totalMs" to s.optDouble("totalMs", 0.0),
      "finished" to s.optBoolean("finished", false),
      "error" to s.optString("error", "").ifEmpty { null },
      "running" to (running?.id == id),
    )
  }

  /** The lines so far, one JSON object per line: {at (ms from the start), durationMs, text, voice}. */
  fun lines(ctx: Context, id: String): String = linesFile(ctx, id).takeIf { it.isFile }?.readText() ?: ""

  /** Removes a job's files (after JS has saved the result, or to forget it). */
  fun forget(ctx: Context, id: String) {
    if (running?.id == id) running?.cancelled = true
    linesFile(ctx, id).delete()
    stateFile(ctx, id).delete()
  }

  fun cancel(id: String) {
    if (running?.id == id) running?.cancelled = true
  }

  /** Unfinished jobs (to carry on after the app was killed). */
  fun unfinished(ctx: Context): List<String> =
    dir(ctx).listFiles { f -> f.name.endsWith(".json") }.orEmpty().mapNotNull { f ->
      val id = f.name.removeSuffix(".json")
      readState(ctx, id)?.takeIf { !it.optBoolean("finished") && it.optString("error").isEmpty() }?.let { id }
    }

  /** Starts (or carries on) transcribing [path] as job [id]. False if another job is running. */
  @Synchronized
  fun start(ctx: Context, id: String, path: String): Boolean {
    if (running != null) return running?.id == id
    val app = ctx.applicationContext
    val state = readState(app, id) ?: JSONObject().put("path", path).put("doneMs", 0).put("resumeMs", 0)
    if (state.optBoolean("finished")) return true
    state.put("path", path).remove("error")
    writeState(app, id, state)
    val job = Job(id)
    running = job
    RecordingService.start(app)
    Thread({
      Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
      try {
        run(app, job, path, state)
      } catch (t: Throwable) {
        Log.e(TAG, "recording $id failed", t)
        state.put("error", t.message ?: t.toString())
        writeState(app, id, state)
      } finally {
        running = null
        RecordingService.stop(app)
        status(app, id)?.let { onProgress?.invoke(it) }
      }
    }, "sidekick-recording").start()
    return true
  }

  private fun run(ctx: Context, job: Job, path: String, state: JSONObject) {
    val engine = Speech.engine(ctx, MicLoop.wakeKeywords)
    val resumeMs = state.optLong("resumeMs", 0)
    val dec = AudioDecoder(path)
    try {
      state.put("totalMs", dec.durationMs)
      writeState(ctx, job.id, state)
      if (resumeMs > 0) dec.seekTo(resumeMs)
      val vad = engine.newVad()
      val out = linesFile(ctx, job.id)
      var lastNotify = 0L
      val window = FloatArray(SpeechEngine.VAD_WINDOW)
      var fill = 0
      fun drain() {
        while (!vad.empty()) {
          val seg = vad.front()
          vad.pop()
          val atMs = resumeMs + seg.start.toLong() * 1000 / SAMPLE_RATE
          val made = segmentLines(engine, seg.samples, atMs)
          if (made.isNotEmpty()) out.appendText(made.joinToString("") { it.toString() + "\n" })
          state.put("resumeMs", atMs + seg.samples.size * 1000L / SAMPLE_RATE)
          writeState(ctx, job.id, state)
        }
      }
      while (!job.cancelled) {
        val chunk = dec.read() ?: break
        var i = 0
        while (i < chunk.size) {
          val n = minOf(window.size - fill, chunk.size - i)
          System.arraycopy(chunk, i, window, fill, n)
          fill += n
          i += n
          if (fill == window.size) {
            vad.acceptWaveform(window.copyOf())
            fill = 0
            drain()
          }
        }
        val now = System.currentTimeMillis()
        if (now - lastNotify > 1500) {
          lastNotify = now
          state.put("doneMs", dec.positionMs)
          writeState(ctx, job.id, state)
          RecordingService.progress(ctx, dec.positionMs, dec.durationMs)
          status(ctx, job.id)?.let { onProgress?.invoke(it) }
        }
      }
      if (job.cancelled) return
      vad.flush()
      drain()
      vad.release()
      state.put("doneMs", dec.durationMs).put("finished", true)
      writeState(ctx, job.id, state)
    } finally {
      dec.release()
    }
  }

  /** One speech segment → lines, cut where the voice changes (as MicLoop does for Listen). */
  private fun segmentLines(engine: SpeechEngine, audio: FloatArray, atMs: Long): List<JSONObject> {
    if (audio.size < MIN_SEC * SAMPLE_RATE || dbfs(audio) < MIN_DBFS) return emptyList()
    fun line(clip: FloatArray, at: Long, text: String): JSONObject? {
      if (text.isBlank()) return null
      val voice = if (clip.size >= VOICEPRINT_SEC * SAMPLE_RATE) engine.voiceprint(clip) else null
      return JSONObject()
        .put("at", at)
        .put("durationMs", clip.size * 1000L / SAMPLE_RATE)
        .put("text", text.trim())
        .put("voice", voice?.let { v -> JSONArray().apply { v.forEach { put(Math.round(it * 1e4) / 1e4) } } })
    }
    if (audio.size >= 2 * LineSplit.JUDGE_SEC * SAMPLE_RATE) {
      val pieces = LineSplit.blocks(audio, engine.speechPieces(audio))
      val parts = LineSplit.parts(audio.size, pieces, { a, b -> engine.voiceprint(audio.copyOfRange(a, b)) })
      if (parts.size > 1) {
        val texts = LineSplit.shareWords(engine.transcribeWords(audio), parts)
        return parts.mapIndexedNotNull { i, p ->
          line(audio.copyOfRange(p.first, p.second), atMs + p.first * 1000L / SAMPLE_RATE, texts[i])
        }
      }
    }
    return listOfNotNull(line(audio, atMs, engine.transcribe(audio)))
  }

  private fun dbfs(audio: FloatArray): Double {
    var sum = 0.0
    for (x in audio) sum += x * x
    return 20 * log10(sqrt(sum / audio.size) + 1e-12)
  }
}

/** Streams any audio file Android can decode as 16 kHz mono floats. */
class AudioDecoder(path: String) {
  private val ex = MediaExtractor()
  private val codec: MediaCodec
  private val rate: Int
  private val channels: Int
  val durationMs: Long
  @Volatile var positionMs = 0L
    private set
  private var inputDone = false
  private var outputDone = false
  private var skipUntilUs = -1L
  private var float = false
  private var resampler: Resampler

  init {
    ex.setDataSource(path)
    val track = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
      ?: run {
        ex.release()
        throw IllegalArgumentException("No audio in this file")
      }
    ex.selectTrack(track)
    val fmt = ex.getTrackFormat(track)
    rate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    channels = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    durationMs = if (fmt.containsKey(MediaFormat.KEY_DURATION)) fmt.getLong(MediaFormat.KEY_DURATION) / 1000 else 0
    codec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME)!!)
    codec.configure(fmt, null, null, 0)
    codec.start()
    resampler = Resampler(rate)
  }

  fun seekTo(ms: Long) {
    ex.seekTo(ms * 1000, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
    codec.flush()
    skipUntilUs = ms * 1000
    positionMs = ms
  }

  /** The next decoded piece (16 kHz mono), an empty array if none is ready yet, null at the end. */
  fun read(): FloatArray? {
    if (outputDone) return null
    val info = MediaCodec.BufferInfo()
    repeat(8) {
      if (!inputDone) {
        val i = codec.dequeueInputBuffer(10_000)
        if (i >= 0) {
          val buf = codec.getInputBuffer(i)!!
          val n = ex.readSampleData(buf, 0)
          if (n < 0) {
            codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            inputDone = true
          } else {
            codec.queueInputBuffer(i, 0, n, ex.sampleTime, 0)
            ex.advance()
          }
        }
      }
      val o = codec.dequeueOutputBuffer(info, 10_000)
      if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        val f = codec.outputFormat
        float = Build.VERSION.SDK_INT >= 24 && f.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
          f.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
      } else if (o >= 0) {
        val buf = codec.getOutputBuffer(o)!!.order(ByteOrder.nativeOrder())
        buf.position(info.offset)
        buf.limit(info.offset + info.size)
        val ch = maxOf(1, channels)
        val frames = info.size / (if (float) 4 else 2) / ch
        val mono = FloatArray(frames)
        if (float) {
          val fb = buf.asFloatBuffer()
          for (k in 0 until frames) {
            var s = 0f
            for (c in 0 until ch) s += fb.get(k * ch + c)
            mono[k] = s / ch
          }
        } else {
          val sb = buf.asShortBuffer()
          for (k in 0 until frames) {
            var s = 0f
            for (c in 0 until ch) s += sb.get(k * ch + c) / 32768f
            mono[k] = s / ch
          }
        }
        val pts = info.presentationTimeUs
        codec.releaseOutputBuffer(o, false)
        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
        if (pts >= 0) positionMs = maxOf(positionMs, pts / 1000)
        if (skipUntilUs >= 0) {
          if (pts + frames * 1_000_000L / rate <= skipUntilUs) return FloatArray(0)
          val drop = ((skipUntilUs - pts).coerceAtLeast(0) * rate / 1_000_000L).toInt().coerceIn(0, frames)
          skipUntilUs = -1
          return resampler.process(mono.copyOfRange(drop, frames))
        }
        return resampler.process(mono)
      }
      if (outputDone) return null
    }
    return FloatArray(0)
  }

  fun release() {
    try {
      codec.stop()
    } catch (_: Exception) {}
    codec.release()
    ex.release()
  }
}

/** Streaming linear resampler to 16 kHz (speech only: no filter needed for Parakeet). Pure. */
class Resampler(private val from: Int, private val to: Int = SAMPLE_RATE) {
  private var prev = 0f
  /** Position of the next output sample in the current input (-1 = [prev]). */
  private var pos = 0.0

  fun process(x: FloatArray): FloatArray {
    if (from == to || x.isEmpty()) return x
    val step = from.toDouble() / to
    val out = FloatArray(((x.size - pos) / step).toInt() + 2)
    var n = 0
    var p = pos
    while (p < x.size - 1) {
      val i = kotlin.math.floor(p).toInt()
      val f = (p - i).toFloat()
      val a = if (i < 0) prev else x[i]
      val b = x[i + 1]
      out[n++] = a + (b - a) * f
      p += step
    }
    pos = p - x.size
    prev = x[x.size - 1]
    return out.copyOf(n)
  }
}

/** Keeps Sidekick running while a shared recording is transcribed, with a progress notification. */
class RecordingService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      val n = notification(this, 0, 0)
      if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      else startForeground(ID, n)
    } catch (e: Exception) {
      // Not allowed now (started from the background): the job runs anyway while the app lives.
      Log.w("SidekickRecordings", "no foreground service: ${e.message}")
      stopSelf()
    }
    return START_NOT_STICKY
  }

  companion object {
    private const val ID = 7301
    private const val CHANNEL = "recordings"

    fun start(ctx: Context) {
      try {
        ctx.startForegroundService(Intent(ctx, RecordingService::class.java))
      } catch (e: Exception) {
        Log.w("SidekickRecordings", "service not started: ${e.message}")
      }
    }

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, RecordingService::class.java))
    }

    fun progress(ctx: Context, doneMs: Long, totalMs: Long) {
      try {
        ctx.getSystemService(NotificationManager::class.java).notify(ID, notification(ctx, doneMs, totalMs))
      } catch (_: Exception) {}
    }

    private fun notification(ctx: Context, doneMs: Long, totalMs: Long): Notification {
      val nm = ctx.getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
        nm.createNotificationChannel(
          NotificationChannel(CHANNEL, "Reading recordings", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Shown while Sidekick turns a shared recording into text, on this phone"
            setShowBadge(false)
          }
        )
      }
      val open = PendingIntent.getActivity(ctx, 0, ctx.packageManager.getLaunchIntentForPackage(ctx.packageName), PendingIntent.FLAG_IMMUTABLE)
      val pct = if (totalMs > 0) (doneMs * 100 / totalMs).toInt().coerceIn(0, 100) else 0
      return NotificationCompat.Builder(ctx, CHANNEL)
        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
        .setContentTitle("Reading the recording")
        .setContentText(if (totalMs > 0) "$pct% · on this phone" else "On this phone")
        .setProgress(100, pct, totalMs <= 0)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(open)
        .build()
    }
  }
}
