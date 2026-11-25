import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

import SidekickNative, { type VoiceInfo } from '../../modules/sidekick-native';
import { getSettings, type VoiceChoice } from './settings';

import { forSpeech, takeSentences } from './sentences';

/**
 * Speaks a streamed answer sentence by sentence, so the voice starts after the first sentence.
 * On Android the native voice speaks (Pocket TTS, else the system voice) and the microphone
 * keeps listening so the user can talk over it; elsewhere expo-speech with the mic paused.
 */
/** The voice decided for this phone and what speaks now (Android; null elsewhere). */
export function voiceInfo(): VoiceInfo | null {
  return Platform.OS === 'android' ? SidekickNative.voiceInfo() : null;
}

let appliedChoice: VoiceChoice | null = null;
let appliedRate: number | null = null;

/** Speech speed ("speak slower / faster", Settings): handed to the native voice when it changed. */
function applyRate() {
  const r = getSettings().speechRate ?? 1;
  if (r === appliedRate) return;
  try {
    SidekickNative.voiceSetRate?.(r);
    appliedRate = r;
  } catch {
    // Older native module: normal speed.
  }
}

/** Hands Settings' voice choice ("auto" = recommended) to the native voice when it changed. */
export function applyVoiceChoice() {
  if (Platform.OS !== 'android') return;
  applyRate();
  const c = getSettings().voiceChoice ?? 'auto';
  if (c === appliedChoice) return;
  SidekickNative.voiceSetChoice(c);
  appliedChoice = c;
}

export class StreamingSpeaker {
  private buffer = '';
  private spokenUpTo = 0;
  /** What has been spoken (or queued) so far; a reply that doesn't continue it starts over. */
  private spoken = '';
  private readonly native = Platform.OS === 'android';
  private readonly answerId: number;
  constructor(private enabled: boolean) {
    if (enabled && this.native) applyVoiceChoice();
    this.answerId = enabled && this.native ? SidekickNative.voiceBegin() : 0;
  }

  /** Call with the full answer so far each time it grows. */
  update(full: string) {
    if (!this.enabled) return;
    this.restartIfReplaced(full);
    this.buffer = full.slice(this.spokenUpTo);
    const { done, rest } = takeSentences(this.buffer);
    for (const s of done) this.say(s);
    this.spokenUpTo = full.length - rest.length;
    this.spoken = full.slice(0, this.spokenUpTo);
  }

  /** A new reply (e.g. the answer after an online lookup) is spoken from its start. */
  private restartIfReplaced(full: string) {
    if (this.spokenUpTo && !full.startsWith(this.spoken)) {
      this.spokenUpTo = 0;
      this.spoken = '';
    }
  }

  /** Call once the answer is complete to speak the last sentence. */
  finish(full: string) {
    if (!this.enabled) return;
    this.restartIfReplaced(full);
    const tail = full.slice(this.spokenUpTo).trim();
    if (tail) this.say(tail);
    this.spokenUpTo = full.length;
    if (this.native) SidekickNative.voiceEnd(this.answerId);
  }

  stop() {
    const was = this.enabled;
    this.enabled = false;
    this.pending = 0;
    if (this.native) {
      if (was) SidekickNative.voiceStop();
      return;
    }
    void Speech.stop();
    SidekickNative.setMicPaused(false);
  }

  private pending = 0;

  private say(text: string) {
    const t = forSpeech(text);
    if (!t) return;
    if (this.native) {
      SidekickNative.voiceSay(t, this.answerId);
      return;
    }
    // Without the native voice the microphone ignores audio while Sidekick talks.
    this.pending++;
    SidekickNative.setMicPaused(true);
    const done = () => {
      this.pending = Math.max(0, this.pending - 1);
      if (this.pending === 0) SidekickNative.setMicPaused(false);
    };
    Speech.speak(t, {
      rate: getSettings().speechRate ?? 1,
      onDone: done,
      onStopped: done,
      onError: done,
    });
  }
}
