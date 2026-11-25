import {
  briefingDue,
  briefingText,
  handsFreeActive,
  inQuietWindow,
  incomingSpeech,
  isCarDevice,
  newIncoming,
  readIncomingWanted,
  speechAllowed,
  summaryPrompt,
  summaryWindow,
} from '@/engine/hands-free-logic';
import type { MessageThread } from '@/integrations/native';

test('car kits by name; headphones are not cars', () => {
  const bt = (name: string) => ({ kind: 'bluetooth', name });
  expect(isCarDevice(bt('VW BT 4521'))).toBe(true);
  expect(isCarDevice(bt('My Car'))).toBe(true);
  expect(isCarDevice(bt('Uconnect'))).toBe(true);
  expect(isCarDevice(bt('Toyota Corolla'))).toBe(true);
  expect(isCarDevice(bt('Galaxy Buds2'))).toBe(false);
  expect(isCarDevice(bt('AirPods Pro'))).toBe(false);
  expect(isCarDevice(bt('Jabra Elite 75t'))).toBe(false);
  expect(isCarDevice(bt('Sony WH-1000XM5'))).toBe(false);
  expect(isCarDevice({ kind: 'wired', name: 'Car' })).toBe(false);
});

test('hands-free: auto follows car or walk mode; on/off force it', () => {
  expect(handsFreeActive(null, { car: false, walkMode: false })).toBe(false);
  expect(handsFreeActive(null, { car: true, walkMode: false })).toBe(true);
  expect(handsFreeActive('auto', { car: false, walkMode: true })).toBe(true);
  expect(handsFreeActive('on', { car: false, walkMode: false })).toBe(true);
  expect(handsFreeActive('off', { car: true, walkMode: true })).toBe(false);
});

test('quiet window wraps past midnight', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 25, h, m);
  expect(inQuietWindow(at(23), 22 * 60, 7 * 60)).toBe(true);
  expect(inQuietWindow(at(3), 22 * 60, 7 * 60)).toBe(true);
  expect(inQuietWindow(at(7), 22 * 60, 7 * 60)).toBe(false);
  expect(inQuietWindow(at(12), 22 * 60, 7 * 60)).toBe(false);
  expect(inQuietWindow(at(13), 12 * 60, 14 * 60)).toBe(true);
  expect(inQuietWindow(at(13), 600, 600)).toBe(false);
});

test('speech allowed: quiet hours and Do Not Disturb, headphones exempt', () => {
  const base = { quiet: true, now: new Date(2026, 10, 25, 23), start: 22 * 60, end: 7 * 60 };
  expect(speechAllowed({ ...base, dnd: false, private: false })).toBe(false);
  expect(speechAllowed({ ...base, dnd: false, private: true })).toBe(true);
  expect(speechAllowed({ ...base, quiet: false, dnd: false, private: false })).toBe(true);
  expect(speechAllowed({ ...base, quiet: false, dnd: true, private: false })).toBe(false);
  expect(speechAllowed({ ...base, quiet: false, dnd: true, private: true })).toBe(true);
  expect(
    speechAllowed({ ...base, now: new Date(2026, 10, 25, 12), dnd: false, private: false }),
  ).toBe(true);
});

const thread = (o: Partial<MessageThread>): MessageThread => ({
  key: 'k',
  pkg: 'com.whatsapp',
  app: 'WhatsApp',
  conversation: 'Sam',
  sender: 'Sam',
  text: 'Running late',
  at: 100,
  canReply: true,
  ...o,
});

test('read incoming: off by default; headphones or car; newest per chat', () => {
  expect(readIncomingWanted(null, { headphones: true, handsFree: true })).toBe(false);
  expect(readIncomingWanted('headphones', { headphones: false, handsFree: false })).toBe(false);
  expect(readIncomingWanted('headphones', { headphones: true, handsFree: false })).toBe(true);
  expect(readIncomingWanted('headphones', { headphones: false, handsFree: true })).toBe(true);
  expect(readIncomingWanted('always', { headphones: false, handsFree: false })).toBe(true);
  const list = [
    thread({ at: 50 }),
    thread({ at: 120, text: 'Still coming?' }),
    thread({ at: 110, text: 'Hi', conversation: 'Jo', sender: 'Jo' }),
  ];
  const fresh = newIncoming(list, 100);
  expect(fresh.map((t) => t.text)).toEqual(['Hi', 'Still coming?']);
  expect(incomingSpeech(fresh[1])).toBe(
    'Sam on WhatsApp says: Still coming? Say reply and your answer.',
  );
  expect(incomingSpeech(thread({ conversation: 'Family', sender: 'Jo', canReply: false }))).toBe(
    'Jo in Family on WhatsApp says: Running late',
  );
  expect(incomingSpeech(thread({ text: 'x'.repeat(400) })).length).toBeLessThan(340);
});

test('summary windows: today, yesterday, this week; other questions are not', () => {
  const now = new Date(2026, 10, 25, 15, 0); // Wednesday
  const today = summaryWindow('What did we talk about today?', now)!;
  expect(today.label).toBe('today');
  expect(today.from).toBe(new Date(2026, 10, 25).getTime());
  expect(summaryWindow('what did we talk about yesterday', now)!.label).toBe('yesterday');
  const week = summaryWindow('What have we discussed this week?', now)!;
  expect(week.from).toBe(new Date(2026, 10, 23).getTime()); // Monday
  expect(summaryWindow('Summarise my conversations last week', now)!.to).toBe(
    new Date(2026, 10, 23).getTime(),
  );
  expect(summaryWindow('What did Sam say about the car?', now)).toBeNull();
  expect(summaryWindow('what time is it', now)).toBeNull();
});

test('summary prompt: lines spread and capped; none → null', () => {
  const w = { from: 0, to: 3_600_000, label: 'today' };
  expect(summaryPrompt(w, [])).toBeNull();
  const lines = Array.from({ length: 500 }, (_, i) => ({
    at: i * 1000,
    who: 'Me',
    text: `line ${i}`,
  }));
  const p = summaryPrompt(w, lines)!;
  expect(p.split('\n').filter((l) => l.startsWith('[')).length).toBe(120);
  expect(p).toContain('line 0');
  expect(p).toContain('what we talked about today');
});

test('briefing: due once a day after its time; calendar + digest', () => {
  const now = new Date(2026, 10, 25, 9, 0);
  expect(briefingDue(now, 8 * 60, null)).toBe(true);
  expect(briefingDue(now, 10 * 60, null)).toBe(false);
  expect(briefingDue(now, 8 * 60, new Date(2026, 10, 25, 8, 30).getTime())).toBe(false);
  expect(briefingDue(now, 8 * 60, new Date(2026, 10, 24, 8, 30).getTime())).toBe(true);
  const events = [
    { title: 'Standup', start: new Date(2026, 10, 25, 10).getTime(), allDay: false },
    { title: 'Holiday', start: new Date(2026, 10, 25).getTime(), allDay: true },
    { title: 'Tomorrow', start: new Date(2026, 10, 26, 10).getTime(), allDay: false },
  ];
  const t = briefingText(events, 'Today: Call mum.', now)!;
  expect(t).toMatch(/^On your calendar: Holiday; Standup at .*10.*\. Today: Call mum\.$/);
  expect(t).not.toContain('Tomorrow');
  expect(briefingText([], null, now)).toBeNull();
});
