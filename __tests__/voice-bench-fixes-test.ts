// Fixes found with the voice bench (bench/voice): name cues and the speaker choice.
import { addresseeOf, findNameCues, replySettled } from '../src/memory/names';
import { chooseSpeaker, VOICE_RULES } from '../src/memory/voices';

const names = (t: string) => findNameCues(t).map((c) => `${c.who}:${c.name}${c.strong ? '!' : ''}`);
const u = (at: number, speakerId: number | null, isOwner = false) => ({ at, speakerId, isOwner });

describe('more self-introductions', () => {
  it('greetings with "there" / "hiya" before "I\'m"', () => {
    expect(names("Hi there, I'm Bram. Nice to meet you.")).toEqual(['speaker:Bram!']);
    expect(names("Hiya, I'm Ines, I'm the new flatmate.")).toEqual(['speaker:Ines!']);
  });
  it('"I\'m Elsie by the way"', () => {
    expect(names("Thank you. I'm Elsie by the way, I don't think we've met.")).toEqual([
      'speaker:Elsie!',
    ]);
  });
  it('"And I\'m Ruth." only with a capital letter, and only as a suggestion', () => {
    expect(names("And I'm Ruth. Nice to meet you.")).toEqual(['speaker:Ruth!']);
    expect(names("And I'm Lucas. I'm covering the evening shift.")).toEqual(['speaker:Lucas']);
    expect(names("and I'm late.")).toEqual([]);
    expect(names("And I'm done, thanks.")).toEqual([]);
  });
});

describe('"Sam, can you…" waits for the answer', () => {
  const line = u(100_000, 1, true);
  it('is not settled until another voice answers', () => {
    expect(replySettled(line, [u(95_000, 2)], 100_000)).toBe(false);
    expect(replySettled(line, [u(95_000, 2), u(103_000, 3)], 103_000)).toBe(true);
    expect(addresseeOf(line, [u(95_000, 2), u(103_000, 3)], true)).toBe(3);
  });
  it('the owner answering does not count; the window closing does', () => {
    expect(replySettled(line, [u(102_000, 1, true)], 102_000)).toBe(false);
    expect(replySettled(line, [], 111_000)).toBe(true);
  });
});

describe('chooseSpeaker (store.ts assignSpeaker)', () => {
  const owner = { id: 1, centroid: [1, 0, 0], count: 5, isOwner: true };
  const sam = { id: 2, centroid: [0, 1, 0], count: 5, isOwner: false };
  it('joins and learns from a clear match', () => {
    const c = chooseSpeaker([0.1, 0.9, 0], false, 3000, false, [owner, sam]);
    expect(c).toMatchObject({ kind: 'join', learn: true, owner: false });
  });
  it('starts a new person only from a long clip', () => {
    expect(chooseSpeaker([0, 0, 1], false, 3000, false, [owner, sam]).kind).toBe('new');
    expect(chooseSpeaker([0, 0, 1], false, 2000, false, [owner, sam]).kind).toBe('none');
  });
  it('a short clip joins a clearly closest voice without learning, never the owner', () => {
    expect(chooseSpeaker([0.1, 0.6, 0], false, 1000, false, [owner, sam])).toMatchObject({
      kind: 'join',
      learn: false,
    });
    expect(chooseSpeaker([0.9, 0.1, 0], false, 1000, false, [owner, sam]).kind).toBe('none');
  });
  it('a wake-word clip that does not sound like the owner is matched like anyone else', () => {
    const c = chooseSpeaker([0, 1, 0], true, 3000, false, [owner, sam]);
    expect(c).toMatchObject({ kind: 'join', owner: false });
    expect(chooseSpeaker([0.9, 0.1, 0], true, 3000, false, [owner, sam])).toMatchObject({
      kind: 'join',
      owner: true,
    });
  });
  it('the first owner clip starts the owner', () => {
    expect(chooseSpeaker([1, 0, 0], true, 2000, false, [sam])).toEqual({
      kind: 'new',
      owner: true,
    });
  });
  it('rules can be changed (bench sweeps)', () => {
    const strict = { ...VOICE_RULES, sameVoice: 0.999 };
    expect(chooseSpeaker([0.1, 0.9, 0], false, 3000, false, [sam], strict).kind).toBe('new');
  });
});
