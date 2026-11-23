package dev.sidekick.engine

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

object Wav {
  /** Reads a 16-bit PCM WAV as mono floats in [-1, 1], resampled to 16 kHz (developer checks only). */
  fun read16kMono(f: File): FloatArray = readMono(f).let { (x, rate) -> resample(x, rate) }

  /** Reads a 16-bit PCM WAV as mono floats in [-1, 1] at its own rate: (samples, rate). */
  fun readMono(f: File): Pair<FloatArray, Int> {
    val b = ByteBuffer.wrap(f.readBytes()).order(ByteOrder.LITTLE_ENDIAN)
    var pos = 12
    var channels = 1
    var rate = SAMPLE_RATE
    while (pos + 8 <= b.limit()) {
      val id = String(ByteArray(4) { b.get(pos + it) })
      val size = b.getInt(pos + 4)
      if (id == "fmt ") {
        channels = b.getShort(pos + 10).toInt()
        rate = b.getInt(pos + 12)
      }
      if (id == "data") {
        val frames = minOf(size, b.limit() - pos - 8) / 2 / channels
        val mono = FloatArray(frames) { b.getShort(pos + 8 + it * 2 * channels) / 32768f }
        return mono to rate
      }
      pos += 8 + size + (size and 1)
    }
    error("No data chunk in ${f.name}")
  }

  private fun resample(x: FloatArray, rate: Int): FloatArray {
    if (rate == SAMPLE_RATE || x.isEmpty()) return x
    val n = (x.size.toLong() * SAMPLE_RATE / rate).toInt()
    return FloatArray(n) {
      val t = it.toDouble() * rate / SAMPLE_RATE
      val i = t.toInt().coerceAtMost(x.size - 1)
      val j = (i + 1).coerceAtMost(x.size - 1)
      val f = (t - i).toFloat()
      x[i] * (1 - f) + x[j] * f
    }
  }
}
