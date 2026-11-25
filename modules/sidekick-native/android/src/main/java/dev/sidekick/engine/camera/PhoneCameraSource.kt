package dev.sidekick.engine.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.Range
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import java.io.File
import java.util.concurrent.Executors

/**
 * The phone's own camera through CameraX (Apache-2.0), with no screen: video goes straight into
 * the encoder's surface, frames for memory come from a low-cost analysis stream at
 * [CaptureConfig.sampleFps], and full-resolution stills are taken on request.
 */
class PhoneCameraSource(private val ctx: Context, private val cfg: CaptureConfig, private val rates: Rates) : FrameSource {
  override var videoSink: VideoSink? = null
  override var onLost: ((String) -> Unit)? = null

  private val main = Handler(Looper.getMainLooper())
  private val analysisExecutor = Executors.newSingleThreadExecutor { Thread(it, "sidekick-frames") }
  private val owner = ServiceLifecycleOwner()
  private var provider: ProcessCameraProvider? = null
  private var capture: ImageCapture? = null
  @Volatile private var lastFrameAt = 0L
  @Volatile private var stopped = false

  override fun start(onFrame: (Frame) -> Unit) {
    stopped = false
    val future = ProcessCameraProvider.getInstance(ctx)
    future.addListener(
      {
        if (stopped) return@addListener
        try {
          bind(future.get(), onFrame)
        } catch (e: Exception) {
          Log.w(TAG, "camera bind failed", e)
          onLost?.invoke("camera unavailable: ${e.message}")
        }
      },
      ContextCompat.getMainExecutor(ctx),
    )
  }

  private fun bind(p: ProcessCameraProvider, onFrame: (Frame) -> Unit) {
    provider = p
    val selector = if (cfg.lens == "front") CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
    val info = selector.filter(p.availableCameraInfos).firstOrNull() ?: throw IllegalStateException("no ${cfg.lens} camera")
    val rotation = info.sensorRotationDegrees
    val videoSize = Size(cfg.videoHeight * 16 / 9, cfg.videoHeight)

    val analysis =
      ImageAnalysis.Builder()
        .setResolutionSelector(selectorFor(Size(1280, 720)))
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
        .build()
    val intervalMs = (1000f / rates.sampleFps.coerceAtLeast(0.05f)).toLong()
    analysis.setAnalyzer(analysisExecutor) { image ->
      try {
        val now = System.currentTimeMillis()
        if (!stopped && now - lastFrameAt >= intervalMs) {
          lastFrameAt = now
          onFrame(Frame(now, upright(image)))
        }
      } catch (e: Exception) {
        Log.w(TAG, "frame failed", e)
      } finally {
        image.close()
      }
    }

    val useCases = ArrayList<UseCase>()
    useCases.add(analysis)
    val sink = videoSink
    if (sink != null && rates.recordVideo && rates.videoFps > 0) {
      val preview =
        Preview.Builder()
          .setResolutionSelector(selectorFor(videoSize))
          .apply { frameRange(info.supportedFrameRateRanges, rates.videoFps)?.let { setTargetFrameRate(it) } }
          .build()
      preview.setSurfaceProvider(analysisExecutor) { req ->
        val res = req.resolution
        val surface =
          try {
            sink.open(res.width, res.height, rotation)
          } catch (e: Exception) {
            Log.w(TAG, "encoder failed", e)
            req.willNotProvideSurface()
            return@setSurfaceProvider
          }
        // Main executor: the analysis executor is shut down on stop, before this result arrives.
        req.provideSurface(surface, ContextCompat.getMainExecutor(ctx)) { sink.close() }
      }
      useCases.add(preview)
    }
    val still = ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build()

    p.unbindAll()
    owner.resume()
    capture =
      try {
        p.bindToLifecycle(owner, selector, *(useCases + still).toTypedArray())
        still
      } catch (e: IllegalArgumentException) {
        // Some phones can't run three streams at once: go without separate stills.
        Log.i(TAG, "no still stream: ${e.message}")
        p.bindToLifecycle(owner, selector, *useCases.toTypedArray())
        null
      }
  }

  override fun stop() {
    stopped = true
    main.post {
      runCatching { provider?.unbindAll() }
      owner.destroy()
      capture = null
      analysisExecutor.shutdown()
    }
  }

  override fun takeStill(file: File, done: (Boolean) -> Unit) {
    val c = capture ?: return done(false)
    if (stopped) return done(false)
    c.takePicture(
      ImageCapture.OutputFileOptions.Builder(file).build(),
      analysisExecutor,
      object : ImageCapture.OnImageSavedCallback {
        override fun onImageSaved(output: ImageCapture.OutputFileResults) = done(true)

        override fun onError(e: ImageCaptureException) {
          Log.w(TAG, "still failed", e)
          done(false)
        }
      },
    )
  }

  private fun upright(image: ImageProxy): Bitmap {
    val bmp = image.toBitmap()
    val deg = image.imageInfo.rotationDegrees
    if (deg == 0) return bmp
    val m = Matrix().apply { postRotate(deg.toFloat()) }
    return Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true).also { if (it !== bmp) bmp.recycle() }
  }

  /** In a service there's no screen: a lifecycle that is "resumed" while capturing. */
  private class ServiceLifecycleOwner : LifecycleOwner {
    private val registry = LifecycleRegistry(this)
    override val lifecycle: Lifecycle
      get() = registry

    fun resume() {
      if (registry.currentState != Lifecycle.State.DESTROYED) registry.currentState = Lifecycle.State.RESUMED
    }

    fun destroy() {
      if (registry.currentState != Lifecycle.State.INITIALIZED) registry.currentState = Lifecycle.State.DESTROYED
    }
  }

  companion object {
    private const val TAG = "SidekickCamera"

    private fun selectorFor(size: Size) =
      ResolutionSelector.Builder()
        .setResolutionStrategy(ResolutionStrategy(size, ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
        .build()

    /** The camera range that reaches [fps] with the lowest top speed (less work); the encoder drops the rest. */
    fun frameRange(ranges: Set<Range<Int>>, fps: Int): Range<Int>? =
      ranges.filter { it.upper >= fps }.minWithOrNull(compareBy<Range<Int>>({ it.upper }, { it.lower }))
  }
}
