/**
 * Runtime side of hands-free mode, quiet hours, read-back, reading incoming messages aloud, the
 * daily briefing and haptics. Logic lives in hands-free-logic.ts / readback-logic.ts (tested).
 */
import { drafts, noteThreadRead } from './actions';
import { headphonesOn, listOutputs } from './devices';
import {
  handsFreeActive,
  incomingSpeech,
  isCarDevice,
  newIncoming,
  readIncomingWanted,
  speechAllowed,
} from './hands-free-logic';
import { readBackWanted } from './readback-logic';
import { getSettings } from './settings';
import { doNotDisturb, messageThreads } from '@/integrations/native';
import type { Draft } from '@/integrations/types';

/** The headset button counts as "walking" for this long after its last press. */
const WALK_MODE_MS = 15 * 60_000;
let lastHeadsetAsk = 0;

/** The headset / Bluetooth button asked a question (walk mode). */
export function noteHeadsetAsk(now = Date.now()) {
  lastHeadsetAsk = now;
}

export function carConnected(): boolean {
  try {
    return listOutputs().some(isCarDevice);
  } catch {
    return false;
  }
}

/** Driving or walking: spoken answers, read-back and bigger buttons. */
export function handsFreeOn(now = Date.now()): boolean {
  return handsFreeActive(getSettings().handsFree, {
    car: carConnected(),
    walkMode: lastHeadsetAsk > 0 && now - lastHeadsetAsk < WALK_MODE_MS,
  });
}

/** Sound goes only to the user's ears (headphones) or the car they are driving. */
function privateAudio(): boolean {
  return headphonesOn() || carConnected();
}

/** May Sidekick speak out loud now (quiet hours, Do Not Disturb)? */
export function canSpeakNow(now = new Date()): boolean {
  const s = getSettings();
  return speechAllowed({
    quiet: s.quietSpeech ?? true,
    now,
    start: s.quietStart,
    end: s.quietEnd,
    dnd: doNotDisturb(),
    private: privateAudio(),
  });
}

/** Should this draft be read back before it sends? */
export function readBackOn(spoken: boolean): boolean {
  return readBackWanted(getSettings().readBack, {
    spoken,
    handsFree: handsFreeOn(),
    speechAllowed: canSpeakNow(),
  });
}

/** A light tick: 'send' (done), 'cancel', 'listen' (listening started). */
export function haptic(kind: 'send' | 'cancel' | 'listen') {
  if (!(getSettings().haptics ?? true)) return;
  void import('expo-haptics')
    .then((H) =>
      kind === 'send'
        ? H.notificationAsync(H.NotificationFeedbackType.Success)
        : H.impactAsync(
            kind === 'cancel' ? H.ImpactFeedbackStyle.Medium : H.ImpactFeedbackStyle.Light,
          ),
    )
    .catch(() => {});
}

/** Ticks when a draft is sent (or scheduled) and when it is cancelled. Call once; returns a stop. */
export function hapticsForDrafts(): () => void {
  const seen = new Map<string, Draft['status']>();
  return drafts.subscribe((all) => {
    for (const d of all) {
      const was = seen.get(d.id);
      seen.set(d.id, d.status);
      if (was === undefined || was === d.status) continue;
      if (d.status === 'sent' || (d.status === 'queued' && d.scheduledAt)) haptic('send');
      else if (d.status === 'cancelled') haptic('cancel');
    }
  });
}

// --- Reading incoming messages aloud ---

const POLL_MS = 5000;

/**
 * Watches for new messages while the app runs and calls [say] with the text to speak (when the
 * setting, headphones and quiet hours allow). Returns a stop function.
 */
export function watchIncoming(say: (text: string) => void): () => void {
  let since = Date.now();
  const t = setInterval(() => {
    const s = getSettings();
    if ((s.readIncoming ?? 'off') === 'off') {
      since = Date.now();
      return;
    }
    if (
      !readIncomingWanted(s.readIncoming, { headphones: privateAudio(), handsFree: handsFreeOn() })
    )
      return;
    if (!canSpeakNow()) return;
    const fresh = newIncoming(messageThreads(true), since);
    if (!fresh.length) return;
    since = Math.max(since, ...fresh.map((f) => f.at));
    for (const m of fresh) {
      noteThreadRead({ ...m, at: Date.now() });
      say(incomingSpeech(m));
    }
  }, POLL_MS);
  return () => clearInterval(t);
}
