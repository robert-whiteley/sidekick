package dev.sidekick.engine.camera

/** Live capture settings from JS (all optional; defaults are the plan's Recommended values). */
data class CaptureConfig(
  /** "auto" (a USB camera when one is open, else the phone's; Recommended), "usb" or "phone". */
  val source: String = "auto",
  /** "back" or "front" (phone camera). */
  val lens: String = "back",
  /** Frames looked at per second (embedded unless near-identical). */
  val sampleFps: Float = 2f,
  val recordVideo: Boolean = true,
  val videoFps: Int = 10,
  val videoHeight: Int = 720,
  val segmentSec: Int = 3,
  /** ≈ 0.5 GB per hour at 720p 10 fps. */
  val videoBitrate: Int = 1_100_000,
  /** "avc" (plays everywhere) or "hevc" (about half the size, where the phone can encode it). */
  val codec: String = "avc",
  val keepVideoHours: Int = 48,
  /** 0 = no cap besides the free-space reserve. */
  val maxVideoMb: Long = 0,
  /** 0 = keep stills as long as their memories. */
  val keepStillsDays: Int = 0,
  /** 0 = Recommended: max(2 GB, 10 % of storage). */
  val reserveMb: Long = 0,
  /** Mean brightness-grid difference (0..1) below which a frame counts as a repeat. */
  val dedupeThreshold: Float = 0.04f,
  /** A still scene still gets a keyframe this often. */
  val keyframeMaxGapSec: Int = 60,
  /** Longest edge of stored keyframes. */
  val keyframeEdge: Int = 640,
  /** How many recent frames are kept for live questions. */
  val liveFrames: Int = 4,
  /** EmbeddingGemma 2 model (null: frames are journalled without a vector). */
  val embedModelPath: String? = null,
  val dims: Int = 256,
  /** PaddleOCR files (null: no text check). */
  val ocrDetPath: String? = null,
  val ocrRecPath: String? = null,
  val ocrDictPath: String? = null,
  /** Text check at most this often (ms). */
  val ocrEveryMs: Long = 2_000,
  /** Keep filming with the screen off / locked (Recommended); false pauses it until unlocked. */
  val whileLocked: Boolean = true,
) {
  companion object {
    fun from(m: Map<String, Any?>?): CaptureConfig {
      if (m == null) return CaptureConfig()
      val d = CaptureConfig()
      fun num(k: String) = (m[k] as? Number)
      fun str(k: String) = m[k] as? String
      return CaptureConfig(
        source = str("source") ?: d.source,
        lens = str("lens") ?: d.lens,
        sampleFps = num("sampleFps")?.toFloat()?.coerceIn(0.1f, 10f) ?: d.sampleFps,
        recordVideo = m["recordVideo"] as? Boolean ?: d.recordVideo,
        videoFps = num("videoFps")?.toInt()?.coerceIn(1, 30) ?: d.videoFps,
        videoHeight = num("videoHeight")?.toInt()?.coerceIn(240, 2160) ?: d.videoHeight,
        segmentSec = num("segmentSec")?.toInt()?.coerceIn(1, 600) ?: d.segmentSec,
        videoBitrate = num("videoBitrate")?.toInt()?.coerceIn(100_000, 50_000_000) ?: d.videoBitrate,
        codec = str("codec") ?: d.codec,
        keepVideoHours = num("keepVideoHours")?.toInt()?.coerceAtLeast(1) ?: d.keepVideoHours,
        maxVideoMb = num("maxVideoMb")?.toLong()?.coerceAtLeast(0) ?: d.maxVideoMb,
        keepStillsDays = num("keepStillsDays")?.toInt()?.coerceAtLeast(0) ?: d.keepStillsDays,
        reserveMb = num("reserveMb")?.toLong()?.coerceAtLeast(0) ?: d.reserveMb,
        dedupeThreshold = num("dedupeThreshold")?.toFloat()?.coerceIn(0f, 1f) ?: d.dedupeThreshold,
        keyframeMaxGapSec = num("keyframeMaxGapSec")?.toInt()?.coerceAtLeast(1) ?: d.keyframeMaxGapSec,
        keyframeEdge = num("keyframeEdge")?.toInt()?.coerceIn(128, 2048) ?: d.keyframeEdge,
        liveFrames = num("liveFrames")?.toInt()?.coerceIn(1, 10) ?: d.liveFrames,
        embedModelPath = str("embedModelPath"),
        dims = num("dims")?.toInt() ?: d.dims,
        ocrDetPath = str("ocrDetPath"),
        ocrRecPath = str("ocrRecPath"),
        ocrDictPath = str("ocrDictPath"),
        ocrEveryMs = num("ocrEveryMs")?.toLong()?.coerceAtLeast(200) ?: d.ocrEveryMs,
        whileLocked = m["whileLocked"] as? Boolean ?: d.whileLocked,
      )
    }
  }
}
