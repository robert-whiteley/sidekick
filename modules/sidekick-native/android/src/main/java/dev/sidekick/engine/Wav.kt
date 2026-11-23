package dev.sidekick.engine

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

object Wav {
  /** Reads the PCM data of a 16-bit mono WAV as floats in [-1, 1] (no resampling). */
  fun read16kMono(f: File): FloatArray {
    val b = ByteBuffer.wrap(f.readBytes()).order(ByteOrder.LITTLE_ENDIAN)
    var pos = 12
    while (pos + 8 <= b.limit()) {
      val id = String(ByteArray(4) { b.get(pos + it) })
      val size = b.getInt(pos + 4)
      if (id == "data") {
        val n = minOf(size, b.limit() - pos - 8) / 2
        return FloatArray(n) { b.getShort(pos + 8 + it * 2) / 32768f }
      }
      pos += 8 + size + (size and 1)
    }
    error("No data chunk in ${f.name}")
  }
}
