package dev.sidekick.engine

import kotlin.math.sqrt

/**
 * Turn-taking for spoken conversation (pure logic, no Android, so it unit-tests on the JVM).
 *
 * While Sidekick speaks, and for [followUpMs] after it finishes, anything the user says is the
 * next question: no wake word needed. Speaking over Sidekick (barge-in) stops it and the chat
 * history is kept for the next answer.
 */
class Turns(private val followUpMs: Long = FOLLOW_UP_MS) {
  enum class State { IDLE, SPEAKING, FOLLOW_UP }

  private var state = State.IDLE
  private var followUpUntil = 0L
  /** When Sidekick started talking in this exchange; earlier speech is never a reply. */
  private var since = Long.MAX_VALUE
  /** What Sidekick said in this exchange, to recognise its own voice coming back. */
  private val said = ArrayDeque<String>()

  @Synchronized
  fun state(now: Long): State {
    if (state == State.FOLLOW_UP && now > followUpUntil) {
      state = State.IDLE
      said.clear()
    }
    return state
  }

  /** Sidekick started saying [sentence]. */
  @Synchronized
  fun speaking(sentence: String, now: Long) {
    if (state != State.SPEAKING) since = minOf(since, now)
    state = State.SPEAKING
    said.addLast(sentence)
    while (said.size > MAX_SAID) said.removeFirst()
  }

  /** Sidekick finished (or was stopped): the follow-up window starts now. */
  @Synchronized
  fun finished(now: Long) {
    // state(now) first: a window that already closed must not reopen (e.g. Stop pressed later).
    if (state(now) == State.IDLE) return
    state = State.FOLLOW_UP
    followUpUntil = now + followUpMs
  }

  /** The user is talking over Sidekick; their words become the next question. */
  @Synchronized
  fun bargedIn(now: Long) = finished(now)

  /** Whether speech that started at [segmentStartMs] answers Sidekick (no wake word needed). */
  @Synchronized
  fun isFollowUp(segmentStartMs: Long, now: Long): Boolean =
    when (state(now)) {
      State.SPEAKING -> true
      // IDLE too: speech that began in the window may finish transcribing after it closed.
      else -> segmentStartMs in since..followUpUntil
    }

  /** True while the mic must stay on for a reply (even with background listening off). */
  fun active(now: Long): Boolean = state(now) != State.IDLE

  /** A follow-up question was taken: the window closes until the next answer starts speaking. */
  @Synchronized
  fun questionTaken() {
    state = State.IDLE
    followUpUntil = 0
    since = Long.MAX_VALUE
  }

  /** Whether [transcript] is just Sidekick's own voice picked up by the mic. */
  @Synchronized
  fun isEcho(transcript: String): Boolean = isEcho(transcript, said.joinToString(" "))

  companion object {
    const val FOLLOW_UP_MS = 8000L
    private const val MAX_SAID = 6

    private fun words(s: String) =
      s.lowercase().replace(Regex("[^a-z0-9' ]"), " ").split(Regex("\\s+")).filter { it.isNotBlank() }

    /** Most of the heard words are words Sidekick just said: it heard itself. */
    fun isEcho(transcript: String, said: String): Boolean {
      val heard = words(transcript)
      if (heard.isEmpty()) return false
      val spoken = words(said).toHashSet()
      if (spoken.isEmpty()) return false
      val overlap = heard.count { it in spoken }.toFloat() / heard.size
      return overlap >= ECHO_OVERLAP && heard.size >= 2
    }

    const val ECHO_OVERLAP = 0.7f

    fun cosine(a: FloatArray, b: FloatArray): Float {
      if (a.size != b.size || a.isEmpty()) return 0f
      var dot = 0.0
      var na = 0.0
      var nb = 0.0
      for (i in a.indices) {
        dot += a[i] * b[i]
        na += a[i] * a[i]
        nb += b[i] * b[i]
      }
      return (dot / (sqrt(na) * sqrt(nb) + 1e-9)).toFloat()
    }
  }
}

/**
 * Decides, per 32 ms mic chunk while Sidekick is speaking, whether the user is talking over it:
 * on the first likely-speech chunk the voice is turned down (duck), and after [confirmMs] of
 * speech it stops. The threshold is higher than normal listening, since echo leaks through.
 */
class BargeIn(
  private val threshold: Float = PLAYBACK_THRESHOLD,
  private val confirmMs: Int = CONFIRM_MS,
  private val chunkMs: Int = CHUNK_MS,
) {
  enum class Action { NONE, DUCK, STOP }

  private var speechMs = 0
  private var quietMs = 0
  private var stopped = false

  fun feed(speechProbability: Float): Action {
    if (stopped) return Action.NONE
    if (speechProbability >= threshold) {
      speechMs += chunkMs
      quietMs = 0
    } else if (speechMs > 0) {
      // A short dip (between syllables) doesn't reset; a real pause does.
      quietMs += chunkMs
      if (quietMs > MAX_GAP_MS) {
        speechMs = 0
        quietMs = 0
      }
    }
    return when {
      speechMs >= confirmMs -> {
        stopped = true
        Action.STOP
      }
      speechMs > 0 -> Action.DUCK
      else -> Action.NONE
    }
  }

  /** True while ducked and waiting for confirmation (the caller restores the volume on false). */
  fun ducked(): Boolean = !stopped && speechMs > 0

  fun reset() {
    speechMs = 0
    quietMs = 0
    stopped = false
  }

  companion object {
    const val PLAYBACK_THRESHOLD = 0.7f
    const val CONFIRM_MS = 300
    const val CHUNK_MS = 32
    private const val MAX_GAP_MS = 96

  }
}

/** Splits streamed text into whole sentences so speech starts before the answer is finished. */
class SentenceSplitter {
  private val buffer = StringBuilder()

  /** Adds streamed text; returns the sentences it completed. */
  fun push(text: String): List<String> {
    buffer.append(text)
    val out = mutableListOf<String>()
    var last = 0
    // Same rule as src/engine/sentences.ts: . ! ? or newline (plus closing quotes) then a space.
    for (m in END.findAll(buffer)) {
      val stop = m.range.last + 1
      buffer.substring(last, stop).trim().takeIf { it.isNotEmpty() }?.let(out::add)
      last = stop
    }
    buffer.delete(0, last)
    return out
  }

  /** The unfinished remainder, once the answer is complete. */
  fun finish(): String = buffer.toString().trim().also { buffer.clear() }

  companion object {
    private val END = Regex("\\n|[.!?]+[\"')\\]]*(?=\\s)")
  }
}
