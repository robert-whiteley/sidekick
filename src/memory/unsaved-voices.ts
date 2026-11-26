/**
 * Consent mode (SPEC 4): voices that haven't agreed are not stored. While a conversation goes on
 * they are still told apart, in memory only: each gets a temporary id (negative, so it never
 * collides with a stored voice) and a "Person N" label for the live transcript, and is forgotten
 * once it hasn't been heard for FORGET_MS, or when the app closes. When one agrees, store.ts saves
 * it like any other voice and takes it out of here. Pure; tested.
 */
import { CONVERSATION_GAP_MS, type PersonRef } from './people-logic';
import { addToCentroid, type Speaker } from './voices';

export type UnsavedVoice = Speaker & { labelNo: number; lastAt: number };

/** Unheard this long, a voice that never agreed is forgotten (one conversation). */
export const FORGET_MS = CONVERSATION_GAP_MS;

export class UnsavedVoices {
  private voices: UnsavedVoice[] = [];
  private nextId = -1;

  constructor(private readonly forgetMs = FORGET_MS) {}

  /** The voices of the conversation going on at [now]; older ones are dropped. */
  all(now: number): UnsavedVoice[] {
    this.voices = this.voices.filter((v) => now - v.lastAt <= this.forgetMs);
    return this.voices;
  }

  /** Their label numbers, so a new stored or unsaved voice doesn't reuse one on screen. */
  labels(now: number): number[] {
    return this.all(now).map((v) => v.labelNo);
  }

  add(centroid: number[], count: number, labelNo: number, now: number): UnsavedVoice {
    const v: UnsavedVoice = {
      id: this.nextId--,
      centroid,
      count,
      isOwner: false,
      labelNo,
      lastAt: now,
    };
    this.voices.push(v);
    return v;
  }

  /** Heard again: kept for the conversation, and (if [voice]) its voiceprint learns, in memory. */
  heard(id: number, now: number, voice?: number[]) {
    const v = this.voices.find((x) => x.id === id);
    if (!v) return;
    v.lastAt = now;
    if (voice) {
      v.centroid = addToCentroid(v, voice);
      v.count++;
    }
  }

  /** Removes and returns a voice (it is being saved, now that it agreed). */
  take(id: number): UnsavedVoice | undefined {
    const v = this.voices.find((x) => x.id === id);
    this.voices = this.voices.filter((x) => x.id !== id);
    return v;
  }

  clear() {
    this.voices = [];
  }

  /** For the live transcript: what each unsaved voice is shown as. */
  people(now: number): PersonRef[] {
    return this.all(now).map((v) => ({ id: v.id, name: null, isOwner: false, labelNo: v.labelNo }));
  }
}

/** Whether a speaker id is an unsaved (in-memory) voice. */
export const isUnsavedId = (id: number | null | undefined) => id != null && id < 0;
