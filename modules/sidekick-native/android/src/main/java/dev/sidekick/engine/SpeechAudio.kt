package dev.sidekick.engine

import android.content.Context
import android.media.MediaCodec
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Build
import android.util.Log
import java.io.File
import java.nio.ByteOrder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Saves each kept speech line's audio as Opus in Ogg (~16 kbps mono, ~2 KB a second), so a
 * conversation can be played back later. Files live under filesDir/data/audio/<yyyy-MM-dd-HH>/,
 * which the storage monitor cleans after the audio keep period.
 */
object SpeechAudio {
  private const val TAG = "SidekickAudio"
  const val SAMPLE_RATE = 16_000
  const val BIT_RATE = 16_000
  const val MIME = MediaFormat.MIMETYPE_AUDIO_OPUS
  /** Opus frames are 20 ms: 320 samples at 16 kHz. */
  const val FRAME_SAMPLES = SAMPLE_RATE / 50

  /** Off the record (or turned off in Settings): nothing is saved. Set from JS. */
  @Volatile var enabled = true

  /** Where a clip that started at [startMs] is saved, relative to filesDir. */
  fun relPath(startMs: Long, zone: TimeZone = TimeZone.getDefault()): String {
    val hour = SimpleDateFormat("yyyy-MM-dd-HH", Locale.US).apply { timeZone = zone }.format(Date(startMs))
    return "data/audio/$hour/$startMs.ogg"
  }

  /** Float PCM (-1..1) → 16-bit little-endian PCM. */
  fun toPcm16(audio: FloatArray): ByteArray {
    val out = ByteArray(audio.size * 2)
    for (i in audio.indices) {
      val s = (audio[i].coerceIn(-1f, 1f) * 32767f).toInt()
      out[2 * i] = (s and 0xff).toByte()
      out[2 * i + 1] = ((s shr 8) and 0xff).toByte()
    }
    return out
  }

  fun format(): MediaFormat =
    MediaFormat.createAudioFormat(MIME, SAMPLE_RATE, 1).apply {
      setInteger(MediaFormat.KEY_BIT_RATE, BIT_RATE)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, FRAME_SAMPLES * 2 * 8)
    }

  /** Encodes and saves the clip; returns its absolute path, or null if it couldn't be saved. */
  fun save(ctx: Context, audio: FloatArray, startMs: Long): String? {
    if (!enabled || audio.isEmpty() || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
    // Phone storage short: the words are kept, the recording isn't (StorageGuard).
    if (StorageGuard.now(ctx) != StorageGuard.Level.OK) return null
    val file = File(ctx.filesDir, relPath(startMs)).apply { parentFile?.mkdirs() }
    return try {
      encode(toPcm16(audio), file)
      file.absolutePath
    } catch (t: Throwable) {
      Log.w(TAG, "couldn't save speech audio", t)
      file.delete()
      null
    }
  }

  private fun encode(pcm: ByteArray, file: File) {
    val codec = MediaCodec.createEncoderByType(MIME)
    val muxer = MediaMuxer(file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_OGG)
    var track = -1
    var muxing = false
    try {
      codec.configure(format(), null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      codec.start()
      val info = MediaCodec.BufferInfo()
      var offset = 0
      var inputDone = false
      var samplesIn = 0L
      while (true) {
        if (!inputDone) {
          val i = codec.dequeueInputBuffer(10_000)
          if (i >= 0) {
            val buf = codec.getInputBuffer(i)!!
            buf.clear()
            val n = minOf(buf.remaining(), pcm.size - offset, FRAME_SAMPLES * 2 * 4)
            val ptsUs = samplesIn * 1_000_000L / SAMPLE_RATE
            if (n <= 0) {
              codec.queueInputBuffer(i, 0, 0, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              buf.order(ByteOrder.LITTLE_ENDIAN).put(pcm, offset, n)
              codec.queueInputBuffer(i, 0, n, ptsUs, 0)
              offset += n
              samplesIn += n / 2
            }
          }
        }
        val o = codec.dequeueOutputBuffer(info, 10_000)
        when {
          o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            track = muxer.addTrack(codec.outputFormat)
            muxer.start()
            muxing = true
          }
          o >= 0 -> {
            val out = codec.getOutputBuffer(o)!!
            val config = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
            if (muxing && !config && info.size > 0) {
              out.position(info.offset).limit(info.offset + info.size)
              muxer.writeSampleData(track, out, info)
            }
            codec.releaseOutputBuffer(o, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
          }
        }
      }
    } finally {
      runCatching { codec.stop() }
      codec.release()
      if (muxing) runCatching { muxer.stop() }
      muxer.release()
    }
  }
}
