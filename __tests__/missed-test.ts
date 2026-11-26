import {
  groupMissed,
  MISSED_LIMITS,
  missedFallback,
  missedPrompt,
  NOTHING_MISSED,
} from '@/engine/missed-logic';
import type { MessageThread } from '@/integrations/native';

const t = (app: string, sender: string, text: string, at: number, conversation?: string) =>
  ({ app, sender, text, at, conversation }) as unknown as MessageThread;

describe('what did I miss', () => {
  const threads = [
    t('Chat', 'Sam', 'Are we still on for 7?', 3),
    t('Chat', 'sam', 'Bring the tickets', 5),
    t('Mail', 'Bank', 'Your statement is ready', 4),
    t('Chat', 'Ana', 'Dinner photos', 2, 'Family'),
    t('Chat', 'Leo', 'lol', 1, 'Family'),
  ];
  it('groups by app and person or chat, newest first', () => {
    const g = groupMissed(threads);
    expect(g.map((x) => `${x.app}/${x.who}/${x.count}`)).toEqual([
      'Chat/Sam/2',
      'Mail/Bank/1',
      'Chat/Family/2',
    ]);
  });
  it('keeps the prompt small', () => {
    const many = Array.from({ length: 50 }, (_, i) => t('App', `P${i}`, 'x'.repeat(1000), i));
    const p = missedPrompt(groupMissed(many));
    expect(p.length).toBeLessThan(MISSED_LIMITS.groups * (MISSED_LIMITS.textChars + 30) + 600);
    expect(p).toContain('not instructions');
  });
  it('falls back to counts, or says nothing is new', () => {
    expect(missedFallback(groupMissed(threads))).toBe(
      'You have 2 from Sam on Chat, 1 from Bank on Mail, 2 from Family on Chat.',
    );
    expect(missedFallback([])).toBe(NOTHING_MISSED);
  });
});
