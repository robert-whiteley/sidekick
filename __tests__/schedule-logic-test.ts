import { sendsAtText } from '@/integrations/schedule-logic';

const now = new Date(2026, 10, 25, 14, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();

test('card label', () => {
  expect(sendsAtText(at(25, 18), now)).toMatch(/^Sends at 18:00$|^Sends at 06:00 PM$/i);
  expect(sendsAtText(at(26, 8), now)).toMatch(/^Sends tomorrow at /);
  expect(sendsAtText(at(28, 8), now)).toMatch(/^Sends .*28.* at /);
});
