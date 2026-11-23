import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';

import { forSpeech, takeSentences } from './sentences';

/**
 * Speaks a streamed answer sentence by sentence, so the voice starts after the first sentence.
 * On Android the native voice speaks (Pocket TTS, else the system voice) and the microphone
 * keeps listening so the user can talk over it; elsewhere expo-speech with the mic paused.
 */
export class StreamingSpeaker {
  private buffer = '';
  private spokenUpTo = 0;
  private readonly native = Platform.OS === 'android';
  private readonly answerId: number;
  constructor(private enabled: boolean) {
    this.answerId = enabled && this.native ? SidekickNative.voiceBegin() : 0;
  }

  /** Call with the full answer so far each time it grows. */
  update(full: string) {
    if (!this.enabled) return;
    this.buffer = full.slice(this.spokenUpTo);
    const { done, rest } = takeSentences(this.buffer);
    for (const s of done) this.say(s);
    this.spokenUpTo = full.length - rest.length;
  }

  /** Call once the answer is complete to speak the last sentence. */
  finish(full: string) {
    if (!this.enabled) return;
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
    Speech.speak(t, { onDone: done, onStopped: done, onError: done });
  }
}
