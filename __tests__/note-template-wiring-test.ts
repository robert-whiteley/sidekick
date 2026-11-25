import {
  type Conversation,
  mergeNotes,
  notePrompt,
  noteText,
  parseNote,
} from '../src/memory/conversation-note-logic';
import { NOTE_TEMPLATES } from '../src/memory/note-templates';

const conv = {
  from: 0,
  to: 60_000,
  lines: [
    { who: 'Me', text: 'Let us go through the budget first.', at: 0 },
    { who: 'Sam', text: 'Sure, and I will send the deck by Friday.', at: 5000 },
  ],
} as unknown as Conversation;

test('a meeting template adds its sections to the prompt and the note', () => {
  const t = NOTE_TEMPLATES.meeting;
  const prompt = notePrompt(conv, null, 0, t);
  expect(prompt).toContain('exactly 6 lines');
  expect(prompt).toContain('Agenda:');
  const reply =
    'Topics: budget\nDecisions: none\nActions: Sam will send the deck by Friday\n' +
    'Summary: Budget review.\nAgenda: budget; deck\nOpen questions: none';
  const note = parseNote(reply, conv, t);
  expect(note?.sections?.[0]).toEqual({ name: 'Agenda', items: ['budget', 'deck'] });
  const merged = mergeNotes(note, { ...note!, sections: undefined });
  expect(merged.sections?.[0].name).toBe('Agenda');
  expect(noteText(merged)).toContain('Agenda: budget; deck');
});

test('no template keeps the four-line prompt', () => {
  expect(notePrompt(conv)).toContain('exactly 4 lines');
});
