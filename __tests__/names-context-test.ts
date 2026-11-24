import { mentionedPerson, speakerLabel } from '../src/memory/people-logic';
import {
  addEvidence,
  addresseeOf,
  AUTO_NAME_AT,
  findNameCues,
  namePrompt,
  parseWhoGuesses as parse,
} from '../src/memory/names';

const u = (at: number, speakerId: number | null, isOwner = false) => ({ at, speakerId, isOwner });

describe('who a name is said to', () => {
  const line = u(100_000, 1, true); // the owner speaks

  it('a question by name: the voice that answers next', () => {
    const [cue] = findNameCues('Sam, can you pass the salt?');
    expect(cue.replyExpected).toBe(true);
    // Person 2 spoke before, Person 3 answers.
    expect(addresseeOf(line, [u(95_000, 2), u(103_000, 3)], cue.replyExpected)).toBe(3);
  });

  it('thanks by name: the voice that just spoke', () => {
    const [cue] = findNameCues('Thanks, Sam.');
    expect(cue.replyExpected).toBe(false);
    expect(addresseeOf(line, [u(92_000, 2), u(97_000, 3), u(104_000, 2)], false)).toBe(3);
  });

  it('a question ending in a name', () => {
    const [cue] = findNameCues('How was the trip, Sam?');
    expect(cue).toMatchObject({ name: 'Sam', who: 'addressee', replyExpected: true });
  });

  it('falls back to the only other voice nearby, never the owner or the speaker', () => {
    expect(addresseeOf(line, [u(115_000, 2)], true)).toBe(2); // answered after 15 s
    expect(addresseeOf(line, [u(103_000, 1, true)], true)).toBeNull();
    expect(addresseeOf(u(100_000, 4), [u(103_000, 4)], true)).toBeNull();
  });
});

describe('names from the whole conversation', () => {
  it('lists lines with labels', () => {
    const p = namePrompt([
      { who: 'Me', text: 'Mum, this is Sam.' },
      { who: 'Person 3', text: 'Hello, lovely to meet you.' },
    ]);
    expect(p).toContain('Me: Mum, this is Sam.\nPerson 3: Hello, lovely to meet you.');
  });
});

describe('evidence adds up', () => {
  it('applies a name after enough cues', () => {
    let s = { name: null as string | null, count: 0 };
    for (let i = 1; i < AUTO_NAME_AT; i++) {
      const n = addEvidence(s, 'Sam', 1)!;
      expect(n.apply).toBe(false);
      s = n;
    }
    expect(addEvidence(s, 'Sam', 1)!.apply).toBe(true);
  });

  it('context plus one cue is enough', () => {
    const ctx = addEvidence({ name: null, count: 0 }, 'Sam', 2)!;
    expect(ctx.apply).toBe(false);
    expect(addEvidence(ctx, 'Sam', 1)!.apply).toBe(true);
  });

  it('a one-off different name is replaced; a well-supported one is not', () => {
    expect(addEvidence({ name: 'Bob', count: 1 }, 'Sam', 1)).toEqual({
      name: 'Sam',
      count: 1,
      apply: false,
    });
    expect(addEvidence({ name: 'Bob', count: 2 }, 'Sam', 1)).toBeNull();
  });
});

describe('who is who, from context', () => {
  it('reads names and descriptions, keeping only said names', () => {
    const heard = 'Would you like to order? Yes please. Thanks Maria. Next stop is Leeds.';
    expect(
      parse(
        'Person 2 | Maria | waiter\nPerson 3 | - | bus driver\nPerson 4 | Bob | man\nPerson 5 | - | -',
        ['Person 2', 'Person 3', 'Person 4', 'Person 5'],
        heard,
      ),
    ).toEqual([
      { label: 'Person 2', name: 'Maria', description: 'waiter' },
      { label: 'Person 3', name: null, description: 'bus driver' },
      { label: 'Person 4', name: null, description: 'man' },
    ]);
  });

  it('drops long or empty descriptions', () => {
    expect(parse('Person 1 | - | a very tall person in a blue coat', ['Person 1'], '')).toEqual([]);
    expect(parse('Person 1 | - | unknown', ['Person 1'], '')).toEqual([]);
  });

  it('labels: name, then role, then generic with number', () => {
    const p = { id: 7, isOwner: false, labelNo: 3 };
    expect(speakerLabel({ ...p, name: null, description: 'bus driver' })).toBe('Bus driver');
    expect(speakerLabel({ ...p, name: null, description: 'man' })).toBe('Man 3');
    expect(speakerLabel({ ...p, name: 'Sam', description: 'waiter' })).toBe('Sam');
    expect(speakerLabel({ ...p, name: null })).toBe('Person 3');
  });

  it('finds "the waiter" in a question', () => {
    const people = [
      { id: 1, isOwner: false, labelNo: 1, name: null, description: 'waiter' },
      { id: 2, isOwner: false, labelNo: 2, name: null, description: 'man' },
    ];
    expect(mentionedPerson('What did the waiter recommend?', people)?.id).toBe(1);
    expect(mentionedPerson('What did the man say?', people)).toBeNull();
  });
});

describe('roleFromLines', () => {
  const { roleFromLines } = jest.requireActual('../src/memory/names');
  it('reads a bus driver from their own lines', () => {
    expect(
      roleFromLines([
        "Hi, I'm Clara. Where would you like to go today? The number twelve leaves in five minutes.",
        "That's two pounds fifty. Please tap your card on the reader and take a seat.",
      ]),
    ).toBe('bus driver');
  });
  it('reads a waiter', () => {
    expect(
      roleFromLines([
        "Good evening, I'm Maya, I'll be looking after your table tonight. Can I get you any drinks?",
        'And are you ready to order your starters?',
      ]),
    ).toBe('waiter');
  });
  it('says nothing without a cue', () => {
    expect(roleFromLines(['A single ticket to the station please, Clara.'])).toBeNull();
  });
});
