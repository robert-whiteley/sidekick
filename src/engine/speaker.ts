import * as Speech from 'expo-speech';

import SidekickNative from '../../modules/sidekick-native';

import { forSpeech, takeSentences } from './sentences';

/** Speaks a streamed answer sentence by sentence, so the voice starts after the first sentence. */
export class StreamingSpeaker {
  private buffer = '';
  private spokenUpTo = 0;
  constructor(private enabled: boolean) {}

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
  }

  stop() {
    this.enabled = false;
    this.pending = 0;
    void Speech.stop();
    SidekickNative.setMicPaused(false);
  }

  private pending = 0;

  // The microphone ignores audio while Sidekick talks, so it never transcribes itself.
  private say(text: string) {
    const t = forSpeech(text);
    if (!t) return;
    this.pending++;
    SidekickNative.setMicPaused(true);
    const done = () => {
      this.pending = Math.max(0, this.pending - 1);
      if (this.pending === 0) SidekickNative.setMicPaused(false);
    };
    Speech.speak(t, { onDone: done, onStopped: done, onError: done });
  }
}
