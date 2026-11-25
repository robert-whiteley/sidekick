package dev.sidekick.engine

import android.util.Log
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * When to re-decode the words said so far, so they appear while the user is still talking.
 * Parakeet is an offline model (no streaming output), so the growing clip is decoded again every
 * [intervalMs]; one decode at a time, never while the previous one runs, and only for clips the
 * phone can redo quickly ([maxSamples]); the final text always comes from the full clip.
 */
class PartialPolicy(
  private val intervalMs: Long = INTERVAL_MS,
  private val minSamples: Int = MIN_SAMPLES,
  private val maxSamples: Int = MAX_SAMPLES,
) {
  private var lastMs = Long.MIN_VALUE / 2
  private var lastSamples = 0

  fun due(nowMs: Long, samples: Int, busy: Boolean): Boolean =
    !busy &&
      samples >= minSamples &&
      samples <= maxSamples &&
      nowMs - lastMs >= intervalMs &&
      samples > lastSamples // nothing new said: same text

  fun started(nowMs: Long, samples: Int) {
    lastMs = nowMs
    lastSamples = samples
  }

  fun reset() {
    lastMs = Long.MIN_VALUE / 2
    lastSamples = 0
  }

  companion object {
    const val INTERVAL_MS = 700L
    const val MIN_SAMPLES = 16000 / 2 // 0.5 s: shorter is mostly noise
    const val MAX_SAMPLES = 16000 * 30 // longer clips take too long to redo on a mid-range CPU
  }
}

/** Runs partial decodes on their own thread and emits `onPartialTranscript` if still current. */
object Partials {
  private const val TAG = "SidekickPartial"
  private val exec = Executors.newSingleThreadExecutor { r -> Thread(r, "sidekick-partial") }
  private val busy = AtomicBoolean(false)
  /** Bumped when a turn ends (or a new one starts): older partials are dropped. */
  private val token = AtomicInteger(0)

  val isBusy: Boolean
    get() = busy.get()

  fun current(): Int = token.get()

  /** A new utterance (push-to-talk start, a question taken): later results of older ones are dropped. */
  fun next(): Int = token.incrementAndGet()

  fun offer(
    audio: FloatArray,
    source: String,
    engine: () -> SpeechEngine?,
    clean: (String) -> String,
    emit: (Map<String, Any?>) -> Unit,
  ) {
    if (!busy.compareAndSet(false, true)) return
    val t = token.get()
    exec.execute {
      try {
        val e = engine() ?: return@execute
        val text = clean(e.transcribe(audio))
        if (text.isNotBlank() && t == token.get()) emit(mapOf("text" to text, "source" to source))
      } catch (x: Throwable) {
        Log.w(TAG, "partial failed: ${x.message}")
      } finally {
        busy.set(false)
      }
    }
  }
}
