import {
  type CallItem,
  callToReturn,
  defaultWindow,
  describeCalls,
  describeTexts,
  parseTelephony,
  sameNumber,
  type SmsItem,
} from '../src/integrations/sms-logic';

const now = new Date(2026, 10, 25, 16, 0);
const T = now.getTime();
const parse = (q: string) => parseTelephony(q, now);

describe('parseTelephony', () => {
  test('texts from a person', () => {
    expect(parse('Read my last text from Mum')).toMatchObject({
      type: 'texts',
      name: 'mum',
      last: true,
      unread: false,
    });
    expect(parse('what did Sam text me yesterday?')).toMatchObject({ type: 'texts', name: 'sam' });
    const y = parse('what did Sam text me yesterday?');
    expect(y?.type === 'texts' && y.range?.label).toBeTruthy();
    expect(parse("read Jo's texts")).toMatchObject({ type: 'texts', name: 'jo' });
    expect(parse('texts from the dentist this week')).toMatchObject({ name: 'dentist' });
  });

  test('new texts', () => {
    expect(parse('any new texts?')).toMatchObject({ type: 'texts', name: null, unread: true });
    expect(parse('do I have any texts')).toMatchObject({ unread: true });
    expect(parse('read my texts from last week')).toMatchObject({ last: false });
  });

  test('sending a text is not a question about texts', () => {
    expect(parse('text Sam I am running late')).toBeNull();
    expect(parse('send a text to Mum saying hi')).toBeNull();
    expect(parse('what is the capital of France')).toBeNull();
  });

  test('calls', () => {
    expect(parse('who called me?')).toMatchObject({ type: 'calls', name: null, missed: false });
    expect(parse('any missed calls')).toMatchObject({ type: 'calls', missed: true });
    expect(parse('did Sam call today')).toMatchObject({ type: 'calls', name: 'sam' });
    expect(parse('show my recent calls')).toMatchObject({ type: 'calls' });
    expect(parse('call Sam')).toBeNull();
  });

  test('call back', () => {
    expect(parse('call them back')).toEqual({ type: 'callBack' });
    expect(parse('call back the last number')).toEqual({ type: 'callBack' });
    expect(parse('return that missed call')).toEqual({ type: 'callBack' });
  });
});

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
  const ask = parse('any missed calls')!;
  expect(defaultWindow(ask, T).from).toBe(T - 7 * 86_400_000);
  const y = parse('who called yesterday')!;
  const w = defaultWindow(y, T);
  expect(w.to - w.from).toBeLessThanOrEqual(86_400_000 + 3600_000);
});
