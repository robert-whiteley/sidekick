import {
  conversationsWith,
  findRequest,
  labelFor,
  mentionedPerson,
  nextLabelNo,
  personByName,
  personContext,
  type PersonRef,
  requestFollowup,
  selfFacts,
  speakerLabel,
} from '../src/memory/people-logic';
import { findNameCues } from '../src/memory/names';

const sam: PersonRef = { id: 4, name: 'Sam Jones', isOwner: false, labelNo: 2 };
const anon: PersonRef = { id: 7, name: null, isOwner: false, labelNo: 3 };
const me: PersonRef = { id: 1, name: null, isOwner: true, labelNo: null };

test('labels: You, name, or a stable "Person N"', () => {
  expect(speakerLabel(me)).toBe('You');
  expect(speakerLabel(sam)).toBe('Sam Jones');
  expect(speakerLabel(anon)).toBe('Person 3');
  expect(speakerLabel(null)).toBe('Someone');
  expect(nextLabelNo([])).toBe(1);
  expect(nextLabelNo([1, null, 4])).toBe(5);
});

test('renames show everywhere: labels are looked up by speaker id', () => {
  const people = new Map([[7, anon]]);
  expect(labelFor(7, people)).toBe('Person 3');
  people.set(7, { ...anon, name: 'Priya' });
  expect(labelFor(7, people)).toBe('Priya');
  expect(labelFor(null, people)).toBe('Someone');
  expect(labelFor(99, people)).toBe('Someone');
});

test('strong self-introductions vs weak cues', () => {
  const strong = (t: string) => findNameCues(t).map((c) => `${c.name}:${c.strong}`);
  expect(strong('My name is Priya.')).toEqual(['Priya:true']);
  expect(strong("hi, i'm sam, nice to meet you")).toEqual(['Sam:true']);
  expect(strong('Call me Jo.')).toEqual(['Jo:false']);
  expect(strong("It's Tom here")).toEqual(['Tom:false']);
  expect(strong('Thanks, Sam.')).toEqual(['Sam:false']);
});

test('requests the owner gives someone', () => {
  expect(findRequest('Sam, can you send the report by Friday?')).toEqual({
    name: 'Sam',
    task: 'send the report by Friday',
  });
  expect(findRequest('Priya, please book the room for Tuesday.')).toEqual({
    name: 'Priya',
    task: 'book the room for Tuesday',
  });
  expect(findRequest('Could you take the bins out, Dave?')).toEqual({
    name: 'Dave',
    task: 'take the bins out',
  });
  expect(findRequest("Alex, don't forget to call the plumber")).toEqual({
    name: 'Alex',
    task: 'call the plumber',
  });
});

test('not requests', () => {
  for (const t of [
    'Sam, can you hear me?',
    'Can you believe it, Sam?',
    'Thanks, Sam.',
    'Everyone, can you sit down please',
    'Sam, can you?',
    'I need to send the report',
  ])
    expect(findRequest(t)).toBeNull();
});

test('a request becomes a dated to-do', () => {
  const now = new Date(2026, 10, 23, 12, 0); // Monday 23 Nov 2026
  const f = requestFollowup({ name: 'Sam', task: 'send the report by Friday' }, now);
  expect(f.title).toBe('Send the report by Friday');
  expect(f.kind).toBe('todo');
  expect(new Date(f.dueAt!).getDay()).toBe(5);
  expect(f.allDay).toBe(true);
  expect(requestFollowup({ name: 'Sam', task: 'water the plants' }, now).dueAt).toBeNull();
});

test('facts people say about themselves', () => {
  expect(selfFacts('I live in Leeds. Anyway, how are you?')).toEqual(['I live in Leeds']);
  expect(selfFacts("I'm a nurse at the hospital")).toEqual(["I'm a nurse at the hospital"]);
  expect(selfFacts('My wife is called Ana.')).toEqual(['My wife is called Ana']);
  expect(selfFacts("I'm allergic to peanuts")).toEqual(["I'm allergic to peanuts"]);
  expect(selfFacts("I'm a bit tired")).toEqual([]);
  expect(selfFacts('Do you live in Leeds?')).toEqual([]);
  expect(selfFacts('Pass the salt')).toEqual([]);
});

test('finding a person by full or first name', () => {
  const people = [sam, anon, me, { id: 9, name: 'Sam Lee', isOwner: false, labelNo: 5 }];
  expect(personByName('Sam Jones', people)?.id).toBe(4);
  expect(personByName('sam', people)).toBeNull(); // two Sams
  expect(personByName('sam', [sam])?.id).toBe(4);
  expect(mentionedPerson('What did I ask Sam to do?', [sam, anon])?.id).toBe(4);
  expect(mentionedPerson("what's sam's wife called", [sam])?.id).toBe(4);
  expect(mentionedPerson('what did I ask Sam to do', people)).toBeNull();
  expect(mentionedPerson('what did Sam Lee say', people)?.id).toBe(9);
  expect(mentionedPerson('what time is it', [sam])).toBeNull();
});

test('conversations are split by gaps and kept only if the person spoke', () => {
  const m = 60_000;
  const lines = [
    { id: 1, at: 0, text: 'hi', speakerId: 1 },
    { id: 2, at: 1 * m, text: 'hello', speakerId: 4 },
    { id: 3, at: 60 * m, text: 'alone', speakerId: 1 },
    { id: 4, at: 120 * m, text: 'again', speakerId: 4 },
  ];
  const c = conversationsWith(lines, 4);
  expect(c.map((x) => x.lines.map((l) => l.id))).toEqual([[4], [1, 2]]);
});

test('person context for the prompt', () => {
  const t = personContext('Sam', {
    notes: 'Works in finance',
    facts: ['I live in Leeds'],
    requests: [{ title: 'Send the report', status: 'suggested', due: 'Fri' }],
  });
  expect(t).toContain('My notes about Sam: Works in finance');
  expect(t).toContain('Sam said: "I live in Leeds"');
  expect(t).toContain('What I asked Sam to do:\n- Send the report (Fri)');
  expect(personContext('Sam', { notes: '', facts: [], requests: [] })).toContain(
    'What I asked Sam to do: nothing recorded.',
  );
});
