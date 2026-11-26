package dev.sidekick.engine

/**
 * Cuts a heard line where the voice changes. A line ends after 0.6 s of silence, but people
 * often answer each other faster than that, so one line held two or three people and got one
 * voice (voice bench: 56% of line time mixed). The line is looked at again: cut at every pause
 * of [PAUSE_SEC] or more, and a cut is kept only where the voiceprints on both sides differ.
 * Pieces too short to judge stay with the line they are in. Pure; tested.
 */
object LineSplit {
  /** Shortest pause that may separate two people (the speech detector's silence setting). */
  const val PAUSE_SEC = 0.25f
  /** Pieces shorter than this give voiceprints too noisy to compare. */
  const val JUDGE_SEC = 1.0f
  /**
   * Below this voiceprint similarity two pieces are different people. Voice bench (CAM++, made-up
   * voices, clean to 0 dB noise): same person's pieces mostly score 0.5-0.9, different people
   * under 0.3.
   */
  const val CHANGE = 0.4f

  /**
   * Speech with no pause to cut at (a noisy cafe keeps the detector on for the whole 25 s) is
   * also judged in blocks of about this length; cuts fall at the quietest moment nearby.
   */
  const val BLOCK_SEC = 2.0f
  private const val FRAME = 320 // 20 ms
  private const val REACH_SEC = 0.3f

  /** [pieces] with every piece of at least two blocks split into about [BLOCK_SEC] blocks. */
  fun blocks(audio: FloatArray, pieces: List<Pair<Int, Int>>, block: Int = (BLOCK_SEC * SAMPLE_RATE).toInt()): List<Pair<Int, Int>> {
    val out = mutableListOf<Pair<Int, Int>>()
    for ((a, e) in pieces) {
      val n = (e - a) / block
      if (n < 2) {
        out.add(a to e)
        continue
      }
      val edges = listOf(a) + (1 until n).map { k -> quietest(audio, a + (k.toLong() * (e - a) / n).toInt()) } + e
      for (k in 0 until n) out.add(edges[k] to edges[k + 1])
    }
    return out
  }

  /** The middle of the quietest 20 ms within [REACH_SEC] of [around]: between words, not in one. */
  fun quietest(audio: FloatArray, around: Int): Int {
    val reach = (REACH_SEC * SAMPLE_RATE).toInt()
    val lo = maxOf(0, around - reach)
    val hi = minOf(audio.size - FRAME, around + reach)
    if (hi <= lo) return around
    var best = lo
    var bestE = Double.MAX_VALUE
    var i = lo
    while (i < hi) {
      var e = 0.0
      for (j in i until i + FRAME) e += audio[j] * audio[j]
      if (e < bestE) {
        bestE = e
        best = i
      }
      i += FRAME / 2
    }
    return best + FRAME / 2
  }

  /**
   * Words of one transcription of the whole line shared out to its parts by when each starts
   * (seconds from the line start), so cutting a line never cuts into the speech-to-text.
   */
  fun shareWords(words: List<Pair<String, Float>>, parts: List<Pair<Int, Int>>): List<String> =
    parts.map { (from, to) ->
      words.filter { (_, at) -> (at * SAMPLE_RATE).toInt().let { it >= from && it < to } }.joinToString(" ") { it.first }
    }

  /** Parakeet's tokens with times as words: a token starting with a space starts a word. */
  fun words(tokens: Array<String>, times: FloatArray): List<Pair<String, Float>> {
    val out = mutableListOf<Pair<String, Float>>()
    for (i in tokens.indices) {
      val tok = tokens[i]
      val at = times.getOrElse(i) { out.lastOrNull()?.second ?: 0f }
      if (tok.startsWith(" ") || out.isEmpty()) out.add(tok.trim() to at)
      else out[out.size - 1] = (out.last().first + tok) to out.last().second
    }
    return out.filter { it.first.isNotEmpty() }
  }

  /**
   * The line's parts as [from, to) sample ranges covering [length] samples. [pieces]: speech
   * spans inside the line, in order; [voiceOf]: a span's voiceprint (null if it can't be had).
   */
  fun parts(
    length: Int,
    pieces: List<Pair<Int, Int>>,
    voiceOf: (Int, Int) -> FloatArray?,
    judge: Int = (JUDGE_SEC * SAMPLE_RATE).toInt(),
    change: Float = CHANGE,
  ): List<Pair<Int, Int>> {
    if (pieces.size < 2) return listOf(0 to length)
    val groups = mutableListOf<IntArray>()
    var lastVoice: FloatArray? = null
    for ((a, b) in pieces) {
      val v = if (b - a >= judge) voiceOf(a, b) else null
      val prev = lastVoice
      val g = groups.lastOrNull()
      if (g != null && (v == null || prev == null || Turns.cosine(v, prev) >= change)) {
        g[1] = b
        if (v != null) lastVoice = v
        continue
      }
      groups.add(intArrayOf(a, b))
      lastVoice = v
    }
    if (groups.size < 2) return listOf(0 to length)
    // Each cut halfway through the pause; the first and last parts keep the line's own edges.
    return groups.mapIndexed { i, g ->
      val from = if (i == 0) 0 else (groups[i - 1][1] + g[0]) / 2
      val to = if (i == groups.size - 1) length else (g[1] + groups[i + 1][0]) / 2
      from to to
    }
  }
}
