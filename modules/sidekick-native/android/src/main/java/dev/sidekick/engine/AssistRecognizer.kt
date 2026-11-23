package dev.sidekick.engine

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.ContextParams
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.speech.RecognitionService
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * The system speech recogniser Android requires of every assistant app. While Sidekick is the
 * default assistant, other apps' [SpeechRecognizer] calls land here and are answered fully
 * on-device: Silero VAD finds where speech starts and ends, Parakeet transcribes it.
 *
 * One session at a time (the base class rejects a second client). Recording and transcription run
 * on a background thread; binder callbacks are safe to call from it.
 */
class AssistRecognitionService : RecognitionService() {
  @Volatile private var session: Session? = null

  override fun onStartListening(recognizerIntent: Intent?, listener: RecognitionService.Callback?) {
    listener ?: return
    session?.cancel()
    session = Session(this, recognizerIntent, listener).also { it.start() }
  }

  /** Stop recording now and return what was said so far. */
  override fun onStopListening(listener: RecognitionService.Callback?) {
    session?.stop()
  }

  override fun onCancel(listener: RecognitionService.Callback?) {
    session?.cancel()
    session = null
  }

  override fun onDestroy() {
    session?.cancel()
    session = null
    super.onDestroy()
  }

  private class Session(
    private val service: Context,
    intent: Intent?,
    private val cb: RecognitionService.Callback,
  ) {
    @Volatile private var stopRequested = false
    @Volatile private var cancelled = false
    private val limits = Limits.from(intent)
    private val language = intent?.getStringExtra(RecognizerIntent.EXTRA_LANGUAGE)

    fun start() {
      Thread({ run() }, "sidekick-recognizer").start()
    }

    fun stop() {
      stopRequested = true
    }

    fun cancel() {
      cancelled = true
    }

    private fun run() {
      try {
        record()
      } catch (t: Throwable) {
        Log.e(TAG, "recognition failed", t)
        fail(SpeechRecognizer.ERROR_CLIENT)
      }
    }

    @SuppressLint("MissingPermission") // Checked just below.
    private fun record() {
      if (service.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        return fail(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS)
      }
      // Parakeet TDT v2 is English-only.
      if (language != null && !language.lowercase().startsWith("en")) {
        return fail(
          if (Build.VERSION.SDK_INT >= 31) SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED else SpeechRecognizer.ERROR_CLIENT,
        )
      }
      if (SpeechPaths(Speech.modelsDir(service)).missing().isNotEmpty()) {
        return fail(
          if (Build.VERSION.SDK_INT >= 31) SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE else SpeechRecognizer.ERROR_CLIENT,
        )
      }
      // Background listening / push-to-talk / a conversation owns the mic.
      if (MicLoop.busy) return fail(SpeechRecognizer.ERROR_RECOGNIZER_BUSY)

      // First use in this process loads the models (a few seconds); later calls reuse them.
      val engine = Speech.engine(service.applicationContext, MicLoop.wakeKeywords)
      if (cancelled) return
      val rec = openRecorder() ?: return fail(SpeechRecognizer.ERROR_AUDIO)
      val vad = engine.newVad()
      val audio = ArrayList<FloatArray>()
      var total = 0
      var speechStartSample = -1
      var silentSinceMs = -1L
      var heardSpeech = false
      var timedOut = false
      try {
        rec.startRecording()
        if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) return fail(SpeechRecognizer.ERROR_AUDIO)
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        call { cb.readyForSpeech(Bundle()) }
        val startMs = System.currentTimeMillis()
        val chunk = FloatArray(SpeechEngine.VAD_WINDOW)
        while (!cancelled && !stopRequested) {
          val n = rec.read(chunk, 0, chunk.size, AudioRecord.READ_BLOCKING)
          if (n < 0) return fail(SpeechRecognizer.ERROR_AUDIO)
          if (n == 0) continue
          val samples = chunk.copyOf(n)
          audio.add(samples)
          total += n
          call { cb.rmsChanged(rmsDb(samples)) }
          vad.acceptWaveform(samples)
          while (!vad.empty()) vad.pop() // Only the speech/silence state is used here.
          val now = System.currentTimeMillis()
          val detected = vad.isSpeechDetected()
          if (detected) {
            silentSinceMs = -1
            if (!heardSpeech) {
              heardSpeech = true
              // The VAD confirms speech only after its minimum duration; keep a little lead-in.
              speechStartSample = maxOf(0, total - LEAD_IN_SAMPLES)
              call { cb.beginningOfSpeech() }
            }
          } else if (heardSpeech && silentSinceMs < 0) {
            // The VAD calls it silence only after its own minimum silence has already passed.
            silentSinceMs = now - VAD_SILENCE_MS
          }
          val elapsed = now - startMs
          if (!heardSpeech && elapsed >= NO_SPEECH_TIMEOUT_MS) {
            timedOut = true
            break
          }
          if (heardSpeech && silentSinceMs >= 0 && now - silentSinceMs >= limits.silenceMs && elapsed >= limits.minLengthMs) break
          if (elapsed >= MAX_LISTEN_MS) break
        }
      } finally {
        runCatching { rec.stop() }
        rec.release()
        vad.release()
      }
      if (cancelled) return
      if (heardSpeech) call { cb.endOfSpeech() }
      if (timedOut) return fail(SpeechRecognizer.ERROR_SPEECH_TIMEOUT)
      if (!heardSpeech) return fail(SpeechRecognizer.ERROR_NO_MATCH) // Stopped before any speech.

      Process.setThreadPriority(Process.THREAD_PRIORITY_DEFAULT)
      val text = engine.transcribe(concat(audio, speechStartSample, total))
      if (cancelled) return
      if (text.isBlank()) return fail(SpeechRecognizer.ERROR_NO_MATCH)
      val results =
        Bundle().apply {
          putStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION, arrayListOf(text))
          // Parakeet gives no confidence; -1 means "not available".
          putFloatArray(SpeechRecognizer.CONFIDENCE_SCORES, floatArrayOf(-1f))
        }
      call { cb.results(results) }
    }

    /**
     * 16 kHz mono float from the speech-recognition input. On Android 12+ the recording is
     * attributed to the calling app, so the privacy indicator and mic access follow that app.
     */
    @SuppressLint("MissingPermission")
    private fun openRecorder(): AudioRecord? {
      val minBuf =
        AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
      val bufBytes = maxOf(minBuf, SAMPLE_RATE * 4)
      val rec =
        try {
          if (Build.VERSION.SDK_INT >= 31) {
            val ctx =
              service.createContext(
                ContextParams.Builder().setNextAttributionSource(cb.callingAttributionSource).build(),
              )
            AudioRecord.Builder()
              .setContext(ctx)
              .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
              .setAudioFormat(
                AudioFormat.Builder()
                  .setSampleRate(SAMPLE_RATE)
                  .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                  .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                  .build(),
              )
              .setBufferSizeInBytes(bufBytes)
              .build()
          } else {
            AudioRecord(
              MediaRecorder.AudioSource.VOICE_RECOGNITION,
              SAMPLE_RATE,
              AudioFormat.CHANNEL_IN_MONO,
              AudioFormat.ENCODING_PCM_FLOAT,
              bufBytes,
            )
          }
        } catch (e: Exception) {
          Log.w(TAG, "could not open the mic", e)
          return null
        }
      if (rec.state != AudioRecord.STATE_INITIALIZED) {
        rec.release()
        return null
      }
      return rec
    }

    private fun fail(code: Int) {
      if (!cancelled) call { cb.error(code) }
    }

    /** The client may have gone away; a dead binder must not crash the recogniser. */
    private inline fun call(block: () -> Unit) {
      if (cancelled) return
      try {
        block()
      } catch (e: Exception) {
        Log.w(TAG, "client callback failed", e)
        cancelled = true
      }
    }
  }

  /** End-of-input timing; the caller may override it with RecognizerIntent extras. */
  private data class Limits(val silenceMs: Long, val minLengthMs: Long) {
    companion object {
      @Suppress("DEPRECATION") // Bundle.get: callers put these as Int or Long.
      fun from(intent: Intent?): Limits {
        fun extra(key: String): Long? =
          intent?.extras?.get(key)?.let { (it as? Number)?.toLong() }?.takeIf { it > 0 }
        val silence =
          extra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS)
            ?: extra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS)
            ?: DEFAULT_SILENCE_MS
        val minLength = extra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS) ?: 0L
        return Limits(silence.coerceIn(VAD_SILENCE_MS, MAX_LISTEN_MS), minLength.coerceAtMost(MAX_LISTEN_MS))
      }
    }
  }

  companion object {
    private const val TAG = "SidekickRecognizer"
    private const val NO_SPEECH_TIMEOUT_MS = 5_000L
    private const val MAX_LISTEN_MS = 15_000L
    /** Pause after speech that ends the input, unless the caller asks for another. */
    private const val DEFAULT_SILENCE_MS = 1_000L
    /** SpeechEngine.newVad's minSilenceDuration: silence already passed when the VAD flips off. */
    private const val VAD_SILENCE_MS = 600L
    /** SpeechEngine.newVad's minSpeechDuration (0.3 s) plus margin, kept before confirmed speech. */
    private const val LEAD_IN_SAMPLES = SAMPLE_RATE / 2

    /** dBFS mapped to the roughly -2..10 range Google's recogniser reports, for level meters. */
    private fun rmsDb(samples: FloatArray): Float {
      var sum = 0.0
      for (x in samples) sum += x * x
      val dbfs = 20 * log10(sqrt(sum / samples.size) + 1e-9)
      return ((dbfs + 60) / 5).toFloat().coerceIn(-2f, 10f)
    }

    private fun concat(chunks: List<FloatArray>, from: Int, total: Int): FloatArray {
      val out = FloatArray(total - from)
      var pos = 0
      for (c in chunks) {
        val end = pos + c.size
        if (end > from) {
          val skip = maxOf(0, from - pos)
          c.copyInto(out, pos + skip - from, skip, c.size)
        }
        pos = end
      }
      return out
    }
  }
}
