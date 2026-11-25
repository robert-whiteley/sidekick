import {
  actionFollowups,
  endedConversations,
  type HeardLine,
  joinNames,
  noteText,
  notePrompt,
  parseNote,
} from '@/memory/conversation-note-logic';
import { backupDue, backupName, nextSlot } from '../src/integrations/drive-backup';
import {
  type DayRecap,
  distinctPlaces,
  isEmptyRecap,
  recapDue,
  recapLine,
  recapMinutes,
} from '@/memory/day-recap-logic';

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

describe('conversation end detection', () => {
  it('waits while it is still going, then writes after 5 min of silence', () => {
    const lines = talk(T0, 10); // 10:00 to 10:04:30
    const end = lines[lines.length - 1].at;
    expect(endedConversations(lines, end + 2 * MIN, true)).toEqual({ ready: [], until: null });
    const r = endedConversations(lines, end + 5 * MIN, true);
    expect(r.ready).toHaveLength(1);
    expect(r.ready[0]).toMatchObject({ from: T0, to: end });
    expect(r.until).toBe(end);
  });

  it('ends at once when Listen is off', () => {
    const lines = talk(T0, 10);
    expect(endedConversations(lines, lines[9].at + MIN, false).ready).toHaveLength(1);
  });

  it('skips short exchanges and talking alone, but moves past them', () => {
    const short = talk(T0, 4); // 1.5 min, 4 lines
    expect(endedConversations(short, T0 + 30 * MIN, true)).toEqual({
      ready: [],
      until: short[3].at,
    });
    const alone = talk(T0, 10).map((l) => ({ ...l, who: 'Me', isOwner: true }));
    expect(endedConversations(alone, T0 + 30 * MIN, true).ready).toEqual([]);
  });

  it('splits at 5-minute gaps and keeps the one still going', () => {
    const a = talk(T0, 10);
    const b = talk(T0 + 20 * MIN, 10, 30_000, 100);
    const r = endedConversations([...a, ...b], b[9].at + MIN, true);
    expect(r.ready.map((c) => c.from)).toEqual([T0]);
    expect(r.until).toBe(a[9].at);
  });
});

describe('note text', () => {
  const c = { from: T0, to: T0 + 5 * MIN, lines: talk(T0, 10) };

  it('prompts with the live names', () => {
    expect(notePrompt(c)).toContain('Sam: line 0');
    expect(notePrompt(c)).toContain('Me: line 1');
  });

  it('parses the four lines; people come from the voices, not the model', () => {
    const n = parseNote(
      '**Topics:** the launch; budget\nDecisions: none\nActions: Sam will send the deck by Friday; I will book the room\nSummary: Planning the launch.',
      c,
    );
    expect(n).toEqual({
      people: ['Sam'],
      topics: ['the launch', 'budget'],
      decisions: [],
      actions: ['Sam will send the deck by Friday', 'I will book the room'],
      summary: 'Planning the launch',
    });
    expect(noteText(n!)).toBe(
      'Conversation with Sam\nPlanning the launch\nTopics: the launch; budget\nAction items: Sam will send the deck by Friday; I will book the room',
    );
    expect(parseNote('I cannot help with that.', c)).toBeNull();
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

describe('day recap', () => {
  it('is due once a day from the chosen time', () => {
    const at8pm = new Date(2026, 10, 23, 20, 0).getTime();
    expect(recapMinutes('20:00')).toBe(1200);
    expect(recapMinutes('off')).toBeNull();
    expect(recapDue('20:00', null, at8pm - MIN)).toBe(false);
    expect(recapDue('20:00', null, at8pm + MIN)).toBe(true);
    expect(recapDue('20:00', at8pm + MIN, at8pm + 60 * MIN)).toBe(false);
    expect(recapDue('20:00', at8pm - 86_400_000, at8pm + MIN)).toBe(true);
    expect(recapDue(null, null, at8pm + MIN)).toBe(false);
  });

  it('summarises in one line', () => {
    const r: DayRecap = {
      day: T0,
      notes: [{ id: 1, at: T0, title: 'Conversation with Sam', text: '' }],
      places: distinctPlaces(['Leeds, GB', null, 'York, GB', 'Leeds, GB']),
      seen: [],
      done: ['Call Mum'],
      pending: [],
    };
    expect(r.places).toEqual(['Leeds, GB', 'York, GB']);
    expect(recapLine(r)).toBe('Your day: 1 conversation, 2 places, 1 to-do done');
    expect(isEmptyRecap({ ...r, notes: [], places: [], done: [] })).toBe(true);
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
