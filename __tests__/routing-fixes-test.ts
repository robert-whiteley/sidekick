/**
 * The reminder tool's words (tools.ts writes "remind me to <what> <when>" from the model's
 * arguments): a to-do without a time, a reminder with one.
 */
import { parseReminderRequest } from '@/memory/followup-logic';

const NOW = new Date(2026, 10, 26, 14, 30);

test('to-dos and reminders from the reminder tool', () => {
  expect(parseReminderRequest('remind me to buy milk ', NOW)).toMatchObject({
    kind: 'todo',
    title: 'Buy milk',
  });
  expect(parseReminderRequest('remind me to call Jo at 6pm', NOW)).toMatchObject({
    kind: 'reminder',
  });
  expect(parseReminderRequest('Add bread to my to-do list', NOW)).toMatchObject({
    kind: 'todo',
    title: 'Bread',
  });
});
