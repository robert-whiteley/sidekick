package dev.sidekick.engine.camera

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Handler
import android.os.HandlerThread
import android.os.Bundle
import android.util.Log
import android.view.Surface
import java.io.File

/**
 * Records the camera into short, closed MP4 files ("seg_<start>_<end>.mp4", one folder per hour)
 * with one long-running encoder: a new file starts at the first key frame after [segmentMs], so
 * there are no gaps, and a clip is always cut from finished files (cutting from a file still being
 * written was unreliable in the old app). [onSegment] gets each finished file.
 */
class SegmentRecorder(
  private val root: File,
  private val fps: Int,
  private val bitrate: Int,
  private val segmentMs: Long,
  private val codecName: String,
  private val onSegment: (Segment) -> Unit,
) : VideoSink {
  private var thread: HandlerThread? = null
  private var codec: MediaCodec? = null
  private var surface: Surface? = null
  private var format: MediaFormat? = null
  private var rotation = 0

  private var muxer: MediaMuxer? = null
  private var track = -1
  private var partFile: File? = null
  private var segStartWall = 0L
  private var segBasePts = 0L
  private var lastWall = 0L
  private var syncRequested = false
  /** Encoder timestamps (camera clock, µs) → wall clock (ms). */
  private var wallOffsetUs = Long.MIN_VALUE

  override fun open(width: Int, height: Int, rotationDegrees: Int): Surface {
    close()
    return synchronized(this) { openLocked(width, height, rotationDegrees) }
  }

  private fun openLocked(width: Int, height: Int, rotationDegrees: Int): Surface {
    rotation = rotationDegrees
    val mime = if (codecName == "hevc" && canEncode(MediaFormat.MIMETYPE_VIDEO_HEVC)) MediaFormat.MIMETYPE_VIDEO_HEVC else MediaFormat.MIMETYPE_VIDEO_AVC
    val fmt =
      MediaFormat.createVideoFormat(mime, width, height).apply {
        setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
        setInteger(MediaFormat.KEY_BIT_RATE, if (mime == MediaFormat.MIMETYPE_VIDEO_HEVC) bitrate * 6 / 10 else bitrate)
        setInteger(MediaFormat.KEY_FRAME_RATE, fps)
        setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, (segmentMs / 1000).toInt().coerceAtLeast(1))
        // The camera runs at its own rate (often 15–30 fps); the encoder drops the extra frames.
        setFloat(KEY_MAX_FPS_TO_ENCODER, fps.toFloat())
        // Background work: let the encoder run below real-time priority.
        setInteger(MediaFormat.KEY_PRIORITY, 1)
      }
    val t = HandlerThread("sidekick-video").apply { start() }
    val c = MediaCodec.createEncoderByType(mime)
    c.setCallback(callback, Handler(t.looper))
    c.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    val s = c.createInputSurface()
    c.start()
    thread = t
    codec = c
    surface = s
    wallOffsetUs = Long.MIN_VALUE
    return s
  }

  /** Stops the encoder outside the lock (its callback thread takes the lock), then closes the file. */
  override fun close() {
    val c: MediaCodec
    val t: HandlerThread?
    val s: Surface?
    synchronized(this) {
      c = codec ?: return
      codec = null
      t = thread
      thread = null
      s = surface
      surface = null
    }
    runCatching { c.stop() }
    runCatching { c.release() }
    s?.release()
    t?.quitSafely()
    synchronized(this) {
      finishSegment()
      format = null
    }
  }

  private val callback =
    object : MediaCodec.Callback() {
      override fun onInputBufferAvailable(codec: MediaCodec, index: Int) = Unit

      override fun onOutputFormatChanged(codec: MediaCodec, fmt: MediaFormat) {
        synchronized(this@SegmentRecorder) { format = fmt }
      }

      override fun onError(codec: MediaCodec, e: MediaCodec.CodecException) {
        Log.w(TAG, "encoder error", e)
      }

      override fun onOutputBufferAvailable(codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo) {
        synchronized(this@SegmentRecorder) {
          if (this@SegmentRecorder.codec !== codec) return
          try {
            write(codec, index, info)
          } catch (e: Exception) {
            Log.w(TAG, "write failed", e)
            finishSegment()
          } finally {
            runCatching { codec.releaseOutputBuffer(index, false) }
          }
        }
      }
    }

  private fun write(codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo) {
    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0 || info.size == 0) return
    val fmt = format ?: return
    if (wallOffsetUs == Long.MIN_VALUE) wallOffsetUs = System.currentTimeMillis() * 1000 - info.presentationTimeUs
    val wall = (info.presentationTimeUs + wallOffsetUs) / 1000
    val key = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
    if (muxer != null && key && wall - segStartWall >= segmentMs) finishSegment()
    if (muxer == null) {
      if (!key) return requestSync(codec)
      startSegment(fmt, wall, info.presentationTimeUs)
    } else if (!syncRequested && wall - segStartWall >= segmentMs - 1000 / fps) {
      requestSync(codec)
    }
    val buf = codec.getOutputBuffer(index) ?: return
    val out = MediaCodec.BufferInfo().apply { set(info.offset, info.size, info.presentationTimeUs - segBasePts, info.flags) }
    muxer?.writeSampleData(track, buf, out)
    lastWall = wall + 1000 / fps
  }

  private fun requestSync(codec: MediaCodec) {
    syncRequested = true
    runCatching { codec.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) }) }
  }

  private fun startSegment(fmt: MediaFormat, wall: Long, pts: Long) {
    val dir = File(root, HourBuckets.name(wall)).apply { mkdirs() }
    val part = File(dir, "seg_$wall.mp4.part")
    val m = MediaMuxer(part.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    m.setOrientationHint(rotation)
    track = m.addTrack(fmt)
    m.start()
    muxer = m
    partFile = part
    segStartWall = wall
    segBasePts = pts
    lastWall = wall
    syncRequested = false
  }

  private fun finishSegment() {
    val m = muxer ?: return
    muxer = null
    val part = partFile
    partFile = null
    val ok = runCatching { m.stop() }.isSuccess
    runCatching { m.release() }
    if (part == null) return
    if (!ok || lastWall <= segStartWall) {
      Log.w(TAG, "segment dropped (muxer ok=$ok, ${lastWall - segStartWall} ms)")
      part.delete()
      return
    }
    val done = File(part.parentFile, SegmentIndex.name(segStartWall, lastWall))
    if (part.renameTo(done)) onSegment(Segment(done.absolutePath, segStartWall, lastWall)) else part.delete()
  }

  companion object {
    private const val TAG = "SidekickVideo"
    /** MediaFormat.KEY_MAX_FPS_TO_ENCODER (API 29); harmless on older phones. */
    private const val KEY_MAX_FPS_TO_ENCODER = "max-fps-to-encoder"

    fun canEncode(mime: String): Boolean =
      MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.any { it.isEncoder && it.supportedTypes.any { t -> t.equals(mime, true) } }

    /** Removes files left by a crash mid-recording (unplayable: never finished). */
    fun cleanParts(root: File) {
      root.listFiles()?.forEach { dir -> dir.listFiles()?.filter { it.name.endsWith(".part") }?.forEach { it.delete() } }
    }
  }
}
