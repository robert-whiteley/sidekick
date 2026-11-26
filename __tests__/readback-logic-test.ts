import {
  confirmFromModel,
  editedFields,
  readBackText,
  readBackWanted,
} from '@/engine/readback-logic';
import type { Draft } from '@/integrations/types';

const msg = {
  id: 'm',
  kind: 'message',
  title: 'Message to Sam',
  fields: { name: 'Sam', to: '+440000', text: "I'm running late", app: 'sms' },
  integration: 'messages',
  status: 'draft',
  at: 0,
} as Draft;
const email = {
  id: 'e',
  kind: 'email',
  title: 'Email to Jo',
  fields: { name: 'Jo', to: 'jo@example.com', subject: 'Report', body: 'It is attached.' },
  integration: 'gmail',
  status: 'draft',
  at: 0,
} as Draft;
const event = {
  id: 'v',
  kind: 'event',
  title: 'Dentist',
  fields: {
    title: 'Dentist',
    start: new Date(2026, 11, 4, 15, 0).getTime(),
    end: new Date(2026, 11, 4, 16, 0).getTime(),
    allDay: false,
    location: '',
  },
  integration: 'calendar',
  status: 'draft',
  at: 0,
} as Draft;

test('read-back says who, what and asks', () => {
  expect(readBackText(msg)).toBe("Text to Sam: I'm running late. Send it?");
  expect(readBackText(email)).toBe('Email to Jo, subject Report: It is attached. Send it?');
  expect(readBackText(event)).toMatch(
    /^Add Dentist, Friday, .*(4.*December|December.*4).*, to your calendar\?$/,
  );
  expect(readBackText({ ...msg, fields: { ...msg.fields, replyKey: 'k' } } as Draft)).toMatch(
    /^Reply to Sam:/,
  );
  expect(
    readBackText({ ...msg, scheduledAt: new Date(2026, 11, 4, 18).getTime() } as Draft),
  ).toMatch(/^Text to Sam at .*: I'm running late\. Send it\?$/);
});

test('read-back wanted: voice (Recommended) only when spoken or hands-free; never when quiet', () => {
  const o = { spoken: false, handsFree: false, speechAllowed: true };
  expect(readBackWanted(null, o)).toBe(false);
  expect(readBackWanted(null, { ...o, spoken: true })).toBe(true);
  expect(readBackWanted(null, { ...o, handsFree: true })).toBe(true);
  expect(readBackWanted('always', o)).toBe(true);
  expect(readBackWanted('off', { ...o, spoken: true })).toBe(false);
  expect(readBackWanted('always', { ...o, speechAllowed: false })).toBe(false);
});

test('edits change the right field', () => {
  expect(editedFields(msg, { kind: 'replace', text: 'On my way' })).toEqual({ text: 'On my way' });
  expect(editedFields(msg, { kind: 'append', text: 'sorry' })).toEqual({
    text: "I'm running late. Sorry",
  });
  expect(editedFields(email, { kind: 'append', text: 'thanks' })).toEqual({
    body: 'It is attached. Thanks',
  });
  expect(editedFields(event, { kind: 'replace', text: 'Dentist check-up' })).toEqual({
    title: 'Dentist check-up',
  });
  expect(editedFields(msg, { kind: 'yes' })).toBeNull();
});

test('the model reply is read safely', () => {
  expect(confirmFromModel('{"answer":"replace","text":"Hi!"}')).toEqual({
    kind: 'replace',
    text: 'Hi!',
  });
  expect(confirmFromModel('Sure: {"answer":"yes"}')).toEqual({ kind: 'yes' });
  expect(confirmFromModel('{"answer":"other"}')).toBeNull();
  expect(confirmFromModel('{"answer":"append"}')).toBeNull();
  expect(confirmFromModel('nope')).toBeNull();
});
