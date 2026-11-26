/** "What did I miss?": summarises the unread notifications on the phone (missed-logic.ts). */
import type { MessageThread } from '@/integrations/native';
import { askLlm } from './llm';
import {
  groupMissed,
  MISSED_LIMITS,
  MISSED_SYSTEM,
  missedFallback,
  missedPrompt,
  NOTHING_MISSED,
} from './missed-logic';

export async function summariseMissed(threads: MessageThread[]): Promise<string> {
  const groups = groupMissed(threads);
  if (!groups.length) return NOTHING_MISSED;
  try {
    const { text } = await askLlm(missedPrompt(groups), null, () => {}, {
      system: MISSED_SYSTEM,
      maxTokens: MISSED_LIMITS.answerTokens,
      scratch: true,
    });
    return text.trim() || missedFallback(groups);
  } catch (e) {
    console.log(`[missed] model failed: ${String(e)}`);
    return missedFallback(groups);
  }
}
