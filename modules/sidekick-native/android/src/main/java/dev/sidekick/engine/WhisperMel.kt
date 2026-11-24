package dev.sidekick.engine

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Whisper-style log-mel features for Smart Turn (pure logic, no Android, so it unit-tests on the
 * JVM). Same steps as pipecat-ai/smart-turn's inference.py, which uses Hugging Face's
 * WhisperFeatureExtractor(chunk_length=8, do_normalize=True):
 *
 * 1. Keep the last 8 s of 16 kHz audio; shorter audio is padded with zeros at the start.
 * 2. Zero-mean, unit-variance over those 8 s.
 * 3. 400-point STFT (periodic Hann, hop 160, reflect-padded edges), power spectrum.
 * 4. 80 Slaney mel filters (0-8 kHz), log10 (floor 1e-10), last frame dropped.
 * 5. Clamp to (max - 8), then (x + 4) / 4.
 *
 * Output: [MELS] x [FRAMES], mel-major, ready for an input of shape (1, 80, 800).
 */
object WhisperMel {
  const val SECONDS = 8
  const val SAMPLES = SECONDS * 16000
  const val MELS = 80
  const val FRAMES = SAMPLES / 160 // 801 STFT frames, the last one dropped
  private const val N_FFT = 400
  private const val HOP = 160
  private const val BINS = N_FFT / 2 + 1

  private val window = DoubleArray(N_FFT) { 0.5 - 0.5 * cos(2 * PI * it / N_FFT) }
  private val twCos = DoubleArray(N_FFT) { cos(-2 * PI * it / N_FFT) }
  private val twSin = DoubleArray(N_FFT) { sin(-2 * PI * it / N_FFT) }

  /** Slaney-style mel filters (as librosa / transformers' mel_filter_bank with norm="slaney"). */
  private class Filter(val from: Int, val weights: DoubleArray)

  private val filters: Array<Filter> = run {
    fun hzToMel(f: Double) = if (f < 1000.0) 3.0 * f / 200.0 else 15.0 + ln(f / 1000.0) * 27.0 / ln(6.4)
    fun melToHz(m: Double) = if (m < 15.0) 200.0 * m / 3.0 else 1000.0 * kotlin.math.exp(ln(6.4) * (m - 15.0) / 27.0)
    val lo = hzToMel(0.0)
    val hi = hzToMel(8000.0)
    val pts = DoubleArray(MELS + 2) { melToHz(lo + (hi - lo) * it / (MELS + 1)) }
    val fft = DoubleArray(BINS) { 8000.0 * it / (BINS - 1) }
    Array(MELS) { m ->
      val enorm = 2.0 / (pts[m + 2] - pts[m])
      val w = DoubleArray(BINS) { k ->
        val down = (fft[k] - pts[m]) / (pts[m + 1] - pts[m])
        val up = (pts[m + 2] - fft[k]) / (pts[m + 2] - pts[m + 1])
        max(0.0, minOf(down, up)) * enorm
      }
      val first = w.indexOfFirst { it > 0 }.coerceAtLeast(0)
      val last = w.indexOfLast { it > 0 }.coerceAtLeast(first)
      Filter(first, w.copyOfRange(first, last + 1))
    }
  }

  /** The last ≤8 s of [audio] as a (1, 80, 800) feature tensor. */
  fun features(audio: FloatArray): FloatArray {
    // 1. Last 8 s, zeros in front.
    val x = DoubleArray(SAMPLES)
    val n = minOf(audio.size, SAMPLES)
    val src = audio.size - n
    for (i in 0 until n) x[SAMPLES - n + i] = audio[src + i].toDouble()
    // 2. Normalise.
    var mean = 0.0
    for (v in x) mean += v
    mean /= SAMPLES
    var variance = 0.0
    for (v in x) variance += (v - mean) * (v - mean)
    variance /= SAMPLES
    val scale = 1.0 / sqrt(variance + 1e-7)
    for (i in x.indices) x[i] = (x[i] - mean) * scale

    // 3-4. STFT -> power -> mel -> log10.
    val out = FloatArray(MELS * FRAMES)
    val re = DoubleArray(N_FFT)
    val im = DoubleArray(N_FFT)
    val outRe = DoubleArray(N_FFT)
    val outIm = DoubleArray(N_FFT)
    val tmpRe = DoubleArray(N_FFT)
    val tmpIm = DoubleArray(N_FFT)
    val power = DoubleArray(BINS)
    var top = Double.NEGATIVE_INFINITY
    val pad = N_FFT / 2
    for (t in 0 until FRAMES) {
      val start = t * HOP - pad
      for (i in 0 until N_FFT) {
        re[i] = reflect(x, start + i) * window[i]
        im[i] = 0.0
      }
      fft(re, im, 0, 1, N_FFT, outRe, outIm, 0, tmpRe, tmpIm)
      for (k in 0 until BINS) power[k] = outRe[k] * outRe[k] + outIm[k] * outIm[k]
      for (m in 0 until MELS) {
        val f = filters[m]
        var s = 0.0
        for (j in f.weights.indices) s += f.weights[j] * power[f.from + j]
        val v = log10(max(s, 1e-10))
        if (v > top) top = v
        out[m * FRAMES + t] = v.toFloat()
      }
    }
    // 5. Dynamic range and scaling.
    val floor = (top - 8.0).toFloat()
    for (i in out.indices) out[i] = (max(out[i], floor) + 4f) / 4f
    return out
  }

  /** numpy "reflect" padding (the edge sample is not repeated). */
  private fun reflect(x: DoubleArray, i: Int): Double {
    val n = x.size
    return when {
      i < 0 -> x[-i]
      i >= n -> x[2 * n - 2 - i]
      else -> x[i]
    }
  }

  /**
   * Mixed-radix (400 = 2^4 * 5^2) decimation-in-time DFT of x[off + stride * j], j < [n], into
   * out[o until o + n]. [tmpRe]/[tmpIm] are scratch (each level finishes with it before returning).
   */
  private fun fft(
    xr: DoubleArray, xi: DoubleArray, off: Int, stride: Int, n: Int,
    outR: DoubleArray, outI: DoubleArray, o: Int, tmpRe: DoubleArray, tmpIm: DoubleArray,
  ) {
    if (n == 1) {
      outR[o] = xr[off]
      outI[o] = xi[off]
      return
    }
    val p = if (n % 2 == 0) 2 else if (n % 5 == 0) 5 else n
    val m = n / p
    if (p == n) {
      // Plain DFT for any other length (not reached for 400).
      for (k in 0 until n) {
        var sr = 0.0
        var si = 0.0
        for (j in 0 until n) {
          val w = (j * k * (N_FFT / n)) % N_FFT
          val a = xr[off + j * stride]
          val b = xi[off + j * stride]
          sr += a * twCos[w] - b * twSin[w]
          si += a * twSin[w] + b * twCos[w]
        }
        tmpRe[k] = sr
        tmpIm[k] = si
      }
    } else {
      for (r in 0 until p) fft(xr, xi, off + r * stride, stride * p, m, outR, outI, o + r * m, tmpRe, tmpIm)
      val step = N_FFT / n
      for (k in 0 until n) {
        val km = k % m
        var sr = 0.0
        var si = 0.0
        for (r in 0 until p) {
          val w = (r * k * step) % N_FFT
          val a = outR[o + r * m + km]
          val b = outI[o + r * m + km]
          sr += a * twCos[w] - b * twSin[w]
          si += a * twSin[w] + b * twCos[w]
        }
        tmpRe[k] = sr
        tmpIm[k] = si
      }
    }
    for (k in 0 until n) {
      outR[o + k] = tmpRe[k]
      outI[o + k] = tmpIm[k]
    }
  }
}
