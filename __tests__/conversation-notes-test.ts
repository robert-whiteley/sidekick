import {
  actionFollowups,
  conversationEnded,
  freshLive,
  type HeardLine,
  joinNames,
  mergeNotes,
  NOTE_MIN_INTERVAL_MS,
  notePassDue,
  noteText,
  notePrompt,
  parseNote,
  splitConversations,
} from '@/memory/conversation-note-logic';
import { backupDue, backupName, nextSlot } from '../src/integrations/drive-backup';

const MIN = 60_000;
// Monday 23 November 2026, 10:00 local time.
const T0 = new Date(2026, 10, 23, 10, 0).getTime();

/** n lines, one every [step] ms from [start], alternating Sam and me. */
function talk(start: number, n: number, step = 30_000, idStart = 1): HeardLine[] {
  return Array.from({ length: n }, (_, i) => ({
    id: idStart + i,
    at: start + i * step,
    text: `line ${i}`,
    who: i % 2 ? 'Me' : 'Sam',
    isOwner: i % 2 === 1,
  }));
}

describe('live notes: when a pass runs', () => {
  it('splits at 5-minute gaps', () => {
    const a = talk(T0, 10);
    const b = talk(T0 + 20 * MIN, 10, 30_000, 100);
    const cs = splitConversations([...a, ...b]);
    expect(cs.map((c) => c.from)).toEqual([T0, T0 + 20 * MIN]);
    expect(conversationEnded(cs[0], false, b[9].at, true)).toBe(true);
    expect(conversationEnded(cs[1], true, b[9].at + MIN, true)).toBe(false);
    expect(conversationEnded(cs[1], true, b[9].at + 5 * MIN, true)).toBe(true);
    expect(conversationEnded(cs[1], true, b[9].at + MIN, false)).toBe(true);
  });

  it('starts a note from the first line with someone else, at a short pause, no minimum length', () => {
    const [c] = splitConversations(talk(T0, 1)); // Sam says one thing
    const live = freshLive(c.from);
    expect(notePassDue(c, live, c.to + 5_000, false)).toBe(false); // still talking
    expect(notePassDue(c, live, c.to + 20_000, false)).toBe(true); // a pause
    expect(notePassDue(c, live, c.to + 1_000, true)).toBe(true); // Listen off
  });

  it('updates every few new lines, not more often than the interval', () => {
    const [c] = splitConversations(talk(T0, 8, 2_000));
    const now = c.to + 1_000;
    const live = { ...freshLive(c.from), noteId: 5, handled: 4, passAt: now - 10_000 };
    expect(notePassDue(c, live, now, false)).toBe(false); // too soon after the last pass
    expect(notePassDue(c, { ...live, passAt: now - NOTE_MIN_INTERVAL_MS }, now, false)).toBe(true);
    expect(notePassDue(c, { ...live, handled: 8, passAt: 0 }, now, false)).toBe(false); // nothing new
    expect(notePassDue(c, { ...live, deleted: true, passAt: 0 }, now, true)).toBe(false);
  });

  it('never for talking alone', () => {
    const alone = talk(T0, 10).map((l) => ({ ...l, who: 'Me', isOwner: true }));
    const [c] = splitConversations(alone);
    expect(notePassDue(c, freshLive(c.from), c.to + 30 * MIN, true)).toBe(false);
  });
});

describe('note text', () => {
  const c = { from: T0, to: T0 + 5 * MIN, lines: talk(T0, 10) };

  it('prompts with the live names; updates send the note and only the new lines', () => {
    expect(notePrompt(c)).toContain('Sam: line 0');
    expect(notePrompt(c)).toContain('Me: line 1');
    const prev = parseNote(
      'Topics: the launch\nActions: Sam will send the deck by Friday\nSummary: Launch.',
      c,
    )!;
    const p = notePrompt(c, prev, 8);
    expect(p).toContain('Topics: the launch');
    expect(p).toContain('Said since:\nSam: line 8\nMe: line 9');
    expect(p).toContain('Said just before:\nSam: line 4');
    expect(p).not.toContain('line 0');
  });

  it('parses the four lines; people come from the voices, not the model', () => {
    const n = parseNote(
      '**Topics:** the launch; budget\nDecisions: none\nActions: Sam will send the deck by Friday; I will book the room (done)\nSummary: Planning the launch.',
      c,
    );
    expect(n).toEqual({
      people: ['Sam'],
      topics: ['the launch', 'budget'],
      decisions: [],
      actions: ['Sam will send the deck by Friday'],
      done: ['I will book the room'],
      summary: 'Planning the launch',
    });
    expect(noteText(n!)).toBe(
      'Conversation with Sam\nPlanning the launch\nTopics: the launch; budget\nAction items: Sam will send the deck by Friday\nDone: I will book the room',
    );
    expect(parseNote('I cannot help with that.', c)).toBeNull();
  });

  it('merges an update: keeps dropped points, changed actions replace, done ones move out', () => {
    const prev = {
      people: ['Sam'],
      topics: ['the launch'],
      decisions: ['launch in May'],
      actions: ['Sam will send the deck by Friday', 'I will call the venue'],
      done: [],
      summary: 'Planning.',
    };
    const next = {
      people: ['Sam', 'Alex'],
      topics: ['budget'],
      decisions: [],
      actions: ['Sam will send the deck by Monday'],
      done: ['I will call the venue'],
      summary: '',
    };
    expect(mergeNotes(prev, next)).toEqual({
      people: ['Sam', 'Alex'],
      topics: ['the launch', 'budget'],
      decisions: ['launch in May'],
      actions: ['Sam will send the deck by Monday'],
      done: ['I will call the venue'],
      summary: 'Planning.',
    });
    expect(mergeNotes(null, next)).toBe(next);
  });

  it('joins names', () => {
    expect(joinNames(['Sam'])).toBe('Sam');
    expect(joinNames(['Sam', 'Alex', 'Person 3'])).toBe('Sam, Alex and Person 3');
  });

  it('turns action items into dated to-dos for approval', () => {
    const [deck, room] = actionFollowups(
      ['Sam will send the deck by Friday', 'I will book the room'],
      T0,
      42,
    );
    expect(deck).toMatchObject({ kind: 'todo', title: 'Sam will send the deck', allDay: true });
    expect(new Date(deck.dueAt!).getDate()).toBe(27);
    expect(deck.sourceMomentId).toBe(42);
    expect(room).toMatchObject({ title: 'I will book the room', dueAt: null, whenText: '' });
  });
});

describe('drive backup schedule', () => {
  const base = { lastAt: null, lastTryAt: null, now: T0, wifi: true, charging: true };
  it('runs weekly on Wi-Fi while charging', () => {
    expect(backupDue(base)).toBe(true);
    expect(backupDue({ ...base, wifi: false })).toBe(false);
    expect(backupDue({ ...base, charging: false })).toBe(false);
    expect(backupDue({ ...base, lastAt: T0 - 3 * 86_400_000 })).toBe(false);
    expect(backupDue({ ...base, lastAt: T0 - 7 * 86_400_000 })).toBe(true);
    expect(backupDue({ ...base, lastTryAt: T0 - 60 * MIN })).toBe(false);
  });

  it('alternates two files, keeping the last two', () => {
    const m = new Map<string, string>();
    const store = {
      get: (k: string) => m.get(k) ?? null,
      set: (k: string, v: string) => m.set(k, v),
    };
    expect(nextSlot(store)).toBe(0);
    m.set('driveBackup.nextSlot', '1');
    expect(nextSlot(store)).toBe(1);
    expect(backupName(new Date(2026, 10, 5))).toBe('Sidekick backup 2026-11-05.zip');
  });
});

test('a chat line only for recent conversations; old ones stay in Memory', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { noticeWanted } = require('@/memory/conversation-note-logic');
  const now = 10 * 3600_000;
  expect(noticeWanted({ from: now - 600_000, to: now - 60_000, lines: [] }, now)).toBe(true);
  expect(noticeWanted({ from: 0, to: now - 2 * 3600_000, lines: [] }, now)).toBe(false);
});

describe('details the model chooses', () => {
  const c = {
    from: 0,
    to: 60_000,
    lines: [{ who: 'Dr Lee', text: 'Take 400 mg ibuprofen three times a day.', at: 0 }],
  } as unknown as Parameters<typeof parseNote>[1];
  it('asks for an optional Details line, with no fixed kinds of conversation', () => {
    const p = notePrompt(c);
    expect(p).toMatch(/Details: only if/);
    expect(p).not.toMatch(/meeting|lecture|doctor/i);
  });
  it('parses and keeps details across updates', () => {
    const n = parseNote(
      'Topics: knee pain\nDecisions: none\nActions: none\nSummary: A check-up.\nDetails: ibuprofen 400 mg three times a day',
      c,
    )!;
    expect(n.details).toEqual(['ibuprofen 400 mg three times a day']);
    const next = parseNote('Topics: knee pain\nDecisions: none\nActions: none\nSummary: Done.', c)!;
    const merged = mergeNotes(n, next);
    expect(merged.details).toEqual(['ibuprofen 400 mg three times a day']);
    expect(noteText(merged)).toMatch(/Details: ibuprofen/);
    expect(notePrompt(c, merged, 1)).toMatch(/Details: ibuprofen/);
  });
});
