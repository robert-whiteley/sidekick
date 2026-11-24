import { addresseeOf, findNameCues } from '../src/memory/names';
import { factPrompt, parseFacts } from '../src/memory/fact-extraction';

const names = (t: string) => findNameCues(t).map((c) => `${c.who}:${c.name}`);

test('self-introductions name the speaker', () => {
  expect(names('My name is Priya.')).toEqual(['speaker:Priya']);
  expect(names("hi, i'm sam, nice to meet you")).toEqual(['speaker:Sam']);
  expect(names("I'm Tom, pleased to meet you.")).toEqual(['speaker:Tom']);
  expect(names('Call me Jo.')).toEqual(['speaker:Jo']);
});

test('addressing names the other person', () => {
  expect(names('Thanks, Sam.')).toEqual(['addressee:Sam']);
  expect(names('cheers dave')).toEqual(['addressee:Dave']);
  expect(names('Sam, can you pass the salt?')).toEqual(['addressee:Sam']);
  expect(names('What do you think, Alex?')).toEqual(['addressee:Alex']);
});

test('common phrases are not names', () => {
  for (const t of [
    'Thanks, sure.',
    'Hi there!',
    'Thank you, everyone.',
    "I'm tired.",
    "I'm going home.",
    'Hey Sidekick, what time is it?',
    'Thanks a lot.',
    'Sorry, I missed that.',
    'Morning, guys.',
    'Okay, so what now?',
    'The train leaves at four.',
  ]) {
    expect(names(t)).toEqual([]);
  }
});

test('addressee is the single other nearby voice', () => {
  const line = { at: 100_000, speakerId: 1, isOwner: true };
  expect(addresseeOf(line, [{ at: 95_000, speakerId: 2, isOwner: false }])).toBe(2);
  expect(addresseeOf(line, [{ at: 50_000, speakerId: 2, isOwner: false }])).toBeNull();
  expect(
    addresseeOf(line, [
      { at: 95_000, speakerId: 2, isOwner: false },
      { at: 105_000, speakerId: 3, isOwner: false },
    ]),
  ).toBeNull();
  expect(addresseeOf(line, [{ at: 99_000, speakerId: 1, isOwner: true }])).toBeNull();
});

test('fact extraction parses model replies', () => {
  expect(factPrompt(['my locker code is 4512'])).toContain('- my locker code is 4512');
  expect(parseFacts('NONE')).toEqual([]);
  expect(parseFacts('None.')).toEqual([]);
  expect(
    parseFacts(
      "Here are the facts:\n- My locker code is 4512\n2. My sister's birthday is 3 May.\n* **My locker code is 4512**\nIs that right?",
    ),
  ).toEqual(['My locker code is 4512.', "My sister's birthday is 3 May."]);
});

describe('parseFacts grounding', () => {
  const said = ['my door code is 4321', 'Sam starts school on Monday'];
  it('drops remarks about the task', () => {
    expect(parseFacts('Please provide the conversation you are referring to.', said)).toEqual([]);
  });
  it('keeps facts starting with My or a name that was said', () => {
    expect(
      parseFacts('My door code is 4321\nSam starts school on Monday\nBob likes tea', said),
    ).toEqual(['My door code is 4321.', 'Sam starts school on Monday.']);
  });
});

describe('parseFacts rejects templates and made-up facts', () => {
  const said = ['I have got the dentist on Friday', 'the door code is 4321'];
  it('drops placeholders and facts that were not said', () => {
    expect(
      parseFacts(
        'My birthday is [Date].\nMy name is [Name].\nMy preference is coffee.\nMy dentist appointment is on Friday.\nMy door code is 4321.',
        said,
      ),
    ).toEqual(['My dentist appointment is on Friday.', 'My door code is 4321.']);
  });
});
