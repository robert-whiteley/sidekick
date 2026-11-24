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

  /** Whether Sidekick said [word] in this exchange (its own voice may then set off the wake word). */
  @Synchronized
  fun hasSaid(word: String): Boolean = said.any { it.lowercase().contains(word.lowercase()) }

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

/**
 * Ends a spoken question early (Smart Turn), fed one VAD speech probability per 32 ms chunk. The
 * VAD alone ends a segment after [limitMs] of quiet; after [checkAfterMs] of quiet this asks once
 * (CHECK) whether the turn sounds finished. If speech resumes, the next pause asks again.
 */
class TurnEnd(
  private val checkAfterMs: Int = CHECK_AFTER_MS,
  private val limitMs: Int = LIMIT_MS,
  private val chunkMs: Int = BargeIn.CHUNK_MS,
) {
  enum class Step { NONE, CHECK }

  private var turnMs = 0
  private var speechMs = 0
  private var quietMs = 0
  private var asked = false
  /** Numbers each CHECK, so a late answer about an earlier pause is ignored. */
  var pause = 0
    private set

  fun feed(speechProbability: Float): Step {
    if (turnMs == 0 && speechProbability < SPEECH) return Step.NONE
    turnMs += chunkMs
    when {
      speechProbability >= SPEECH -> {
        speechMs += chunkMs
        quietMs = 0
        asked = false
      }
      // Like Silero: in between neither starts nor stops a pause.
      speechProbability < QUIET || quietMs > 0 -> quietMs += chunkMs
    }
    if (quietMs >= limitMs) {
      reset() // the VAD ends this segment itself
      return Step.NONE
    }
    if (!asked && quietMs >= checkAfterMs && speechMs >= MIN_SPEECH_MS) {
      asked = true
      pause++
      return Step.CHECK
    }
    return Step.NONE
  }

  /** Whether the pause numbered [id] is still going on (nothing said since). */
  fun stillPaused(id: Int): Boolean = asked && id == pause && quietMs > 0

  /** How much audio belongs to this turn (for the model), in ms. */
  fun turnMs(): Int = turnMs

  fun reset() {
    turnMs = 0
    speechMs = 0
    quietMs = 0
    asked = false
  }

  companion object {
    /** Pipecat pairs Smart Turn with 0.2 s of VAD silence; one more 32 ms chunk for the hand-off. */
    const val CHECK_AFTER_MS = 256
    /** SpeechEngine's minSilenceDuration: today's end of a turn. */
    const val LIMIT_MS = 600
    /** SpeechEngine's minSpeechDuration: shorter blips are not a turn. */
    const val MIN_SPEECH_MS = 300
    const val SPEECH = 0.5f
    const val QUIET = 0.35f
  }
}

/**
 * Only the owner may talk over Sidekick. Once [BargeIn] confirms speech, the audio since the voice
 * was turned down is collected until it is [minSamples] long (a voiceprint of shorter clips is
 * unreliable), then the caller compares its voiceprint with the owner's (VERIFY, then [verified]).
 * With no owner voice known yet, BargeIn's STOP passes straight through, as before. The wake word
 * is always accepted (MicLoop), so short interruptions still work with it.
 */
class OwnerBarge(
  private val minSamples: Int = (MIN_VOICEPRINT_SEC * SAMPLE_RATE).toInt(),
  private val giveUpQuietMs: Int = TurnEnd.LIMIT_MS,
  private val chunkMs: Int = BargeIn.CHUNK_MS,
) {
  enum class Step { NONE, STOP, VERIFY, REJECT }

  private val clip = ArrayList<FloatArray>()
  private var size = 0
  private var confirmed = false
  private var verifying = false
  private var done = false
  private var quietMs = 0

  /** One mic chunk while Sidekick speaks, with BargeIn's decision and state for it. */
  fun feed(action: BargeIn.Action, ducked: Boolean, speech: Boolean, samples: FloatArray, ownerKnown: Boolean): Step {
    if (done || verifying) return Step.NONE
    if (action == BargeIn.Action.STOP) {
      if (!ownerKnown) {
        done = true
        return Step.STOP
      }
      confirmed = true
    }
    if (!confirmed && !ducked) {
      clear() // a blip, not someone talking
      return Step.NONE
    }
    clip.add(samples)
    size += samples.size
    if (confirmed) {
      quietMs = if (speech) 0 else quietMs + chunkMs
      // Stopped talking before there was enough to tell who it was: not accepted (wake word works).
      if (quietMs >= giveUpQuietMs) {
        clear()
        return Step.REJECT
      }
      if (size >= minSamples) {
        verifying = true
        return Step.VERIFY
      }
    }
    return Step.NONE
  }

  /** The audio to check (after VERIFY). */
  fun clip(): FloatArray {
    val out = FloatArray(size)
    var i = 0
    for (c in clip) {
      c.copyInto(out, i)
      i += c.size
    }
    return out
  }

  /** The voiceprint check's answer; true if Sidekick should stop. */
  fun verified(isOwner: Boolean): Boolean {
    if (!verifying) return false
    verifying = false
    if (isOwner) done = true else clear()
    return isOwner
  }

  /** True while the voice should stay turned down (collecting or checking). */
  fun holding(): Boolean = !done && (confirmed || verifying)

  fun reset() {
    clear()
    done = false
  }

  private fun clear() {
    clip.clear()
    size = 0
    confirmed = false
    verifying = false
    quietMs = 0
  }

  companion object {
    /** Same as MicLoop: CAM++ voiceprints of shorter clips are unreliable. */
    const val MIN_VOICEPRINT_SEC = 1.5f
    /** Same-voice threshold, as src/memory/voices.ts (SAME_VOICE). */
    const val SAME_VOICE = 0.55f

    fun isOwner(voice: FloatArray?, owner: FloatArray): Boolean =
      voice != null && Turns.cosine(voice, owner) >= SAME_VOICE
  }
}

/** The last [capacity] samples fed to the VAD, for Smart Turn. */
class AudioRing(private val capacity: Int) {
  private val buf = FloatArray(capacity)
  private var written = 0L

  fun write(samples: FloatArray) {
    for (x in samples) {
      buf[(written % capacity).toInt()] = x
      written++
    }
  }

  /** The newest [n] samples (fewer if not that many were written). */
  fun last(n: Int): FloatArray {
    val k = minOf(n.toLong(), written, capacity.toLong()).toInt()
    val out = FloatArray(k)
    val start = written - k
    for (i in 0 until k) out[i] = buf[((start + i) % capacity).toInt()]
    return out
  }

  fun clear() {
    written = 0
  }
}

/**
 * Silero v5/v6 scores 512 new samples only with the 64 before them in front (576 in all), which
 * sherpa's streaming VAD adds itself but its one-shot `compute` does not. Without them the speech
 * probability stays near 0, so barge-in and Smart Turn never fired.
 */
class SileroWindow(private val context: Int = CONTEXT) {
  private var last = FloatArray(context)

  fun next(samples: FloatArray): FloatArray {
    val out = FloatArray(context + samples.size)
    last.copyInto(out)
    samples.copyInto(out, context)
    last = out.copyOfRange(out.size - context, out.size)
    return out
  }

  fun reset() {
    last = FloatArray(context)
  }

  companion object {
    const val CONTEXT = 64
  }
}
