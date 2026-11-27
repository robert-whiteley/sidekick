import {
  type CallItem,
  callToReturn,
  defaultWindow,
  describeCalls,
  describeTexts,
  sameNumber,
  type SmsItem,
} from '../src/integrations/sms-logic';

const now = new Date(2026, 10, 25, 16, 0);
const T = now.getTime();

test('numbers match on their last digits', () => {
  expect(sameNumber('+44 7700 900123', '07700900123')).toBe(true);
  expect(sameNumber('+44 7700 900123', '07700900124')).toBe(false);
  expect(sameNumber('123', '123')).toBe(false);
});

const sms = (o: Partial<SmsItem>): SmsItem => ({
  address: '+447700900123',
  name: 'Mum',
  body: 'Hello',
  at: T - 3600_000,
  sent: false,
  read: true,
  ...o,
});

test('describeTexts reads received texts, newest first', () => {
  const items = [
    sms({ body: 'Older', at: T - 7200_000 }),
    sms({ body: 'Newest', at: T - 60_000 }),
    sms({ body: 'Mine', sent: true, at: T }),
  ];
  const ask = { type: 'texts' as const, name: 'mum', last: true, unread: false, range: null };
  expect(describeTexts(items, ask, T)).toBe('Mum (today 15:59): Newest');
  const all = describeTexts(items, { ...ask, last: false }, T);
  expect(all.split('\n')).toHaveLength(2);
  expect(describeTexts([], { ...ask, unread: true }, T)).toBe('No new texts from mum.');
  expect(describeTexts([sms({ name: null })], { ...ask, name: null }, T)).toMatch(
    /^\+447700900123/,
  );
});

const call = (o: Partial<CallItem>): CallItem => ({
  number: '07700900123',
  name: 'Sam',
  type: 'incoming',
  at: T - 600_000,
  seconds: 125,
  ...o,
});

test('describeCalls and the call to return', () => {
  const items = [
    call({ type: 'outgoing', at: T - 60_000, name: 'Jo', number: '0111' }),
    call({ type: 'missed', at: T - 120_000 }),
    call({ at: T - 86_400_000 }),
  ];
  const ask = { type: 'calls' as const, name: null, missed: false, range: null };
  const text = describeCalls(items, ask, T);
  expect(text.split('\n')[0]).toBe('You called Jo, today 15:59, 2 min');
  expect(text).toContain('Missed call from Sam, today 15:58');
  expect(describeCalls(items, { ...ask, missed: true }, T).split('\n')).toHaveLength(1);
  expect(describeCalls([], { ...ask, missed: true }, T)).toBe('No missed calls.');
  expect(callToReturn(items)?.type).toBe('missed');
  expect(callToReturn([call({ type: 'outgoing' })])).toBeNull();
});

test('default windows', () => {
  const ask = { type: 'calls' as const, name: null, missed: true, range: null };
  expect(defaultWindow(ask, T).from).toBe(T - 7 * 86_400_000);
  const yFrom = new Date(2026, 10, 24).getTime();
  const y = { ...ask, range: { from: yFrom, to: yFrom + 86_400_000, label: 'yesterday' } };
  const w = defaultWindow(y, T);
  expect(w.to - w.from).toBeLessThanOrEqual(86_400_000 + 3600_000);
});
