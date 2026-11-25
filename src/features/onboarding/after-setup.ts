import SidekickNative from '../../../modules/sidekick-native';
import { CALIBRATION_PROMPT } from '@/engine/backend-choice';
import { askLlmInBackground, ensureLlm } from '@/engine/llm';
import { updateSettings } from '@/engine/settings';
import { introMessage, type IntroMessage } from './first-run';

const INTRO_KEY = 'onboarding.intro.v1';
const SPEED_KEY = 'onboarding.speed.v1';

/** The download finished on a first run: the chat shows the intro once. */
export function markFirstRunDone() {
  if (!SidekickNative.kvGet(INTRO_KEY)) SidekickNative.kvSet(INTRO_KEY, 'pending');
}

/**
 * The intro message, the first time the chat opens after setup; null after that. The chat
 * keeps it in its history like any other message.
 */
export function takeIntroMessage(): IntroMessage | null {
  if (SidekickNative.kvGet(INTRO_KEY) !== 'pending') return null;
  SidekickNative.kvSet(INTRO_KEY, 'shown');
  return introMessage();
}

let speed: Promise<void> | null = null;

/**
 * Silent speed check right after setup: loads the model on the fastest chip (the load measures
 * each chip once) and times one short answer, so the Recommended settings can follow this
 * phone's real speed. No screen, nothing to tap; it yields to any question asked meanwhile.
 */
export function runSpeedCheck(): Promise<void> {
  if (SidekickNative.kvGet(SPEED_KEY)) return Promise.resolve();
  speed ??= (async () => {
    try {
      await ensureLlm();
      const { stats } = await askLlmInBackground(CALIBRATION_PROMPT, null, { maxTokens: 48 });
      if (stats.decodeTokensPerSec > 0) {
        updateSettings({ measuredTokPerSec: Math.round(stats.decodeTokensPerSec * 10) / 10 });
        SidekickNative.kvSet(SPEED_KEY, String(Date.now()));
      }
    } catch (e) {
      console.log(`[setup] speed check skipped: ${String(e)}`);
    } finally {
      speed = null;
    }
  })();
  return speed;
}
