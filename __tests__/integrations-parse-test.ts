import { clockTime, mightBeAction, parseIntent, splitNameAndText } from '../src/integrations/parse';

// Monday 24 Nov 2025, 14:00 local.
const now = new Date(2025, 10, 24, 14, 0);
const p = (q: string, contacts: string[] = []) => parseIntent(q, now, contacts);

describe('messages', () => {
  it('splits name and text without a separator', () => {
    expect(p("text Sam I'm running late")).toEqual({
      type: 'message',
      name: 'Sam',
      text: "I'm running late",
      app: 'auto',
    });
  });
  it('uses known contact names', () => {
    expect(p('message Sam Taylor see you at 6', ['Sam', 'Sam Taylor'])).toMatchObject({
      name: 'Sam Taylor',
      text: 'See you at 6',
    });
  });
  it('reads the app', () => {
    expect(p('Send a WhatsApp to Mum saying happy birthday')).toEqual({
      type: 'message',
      name: 'Mum',
      text: 'Happy birthday',
      app: 'whatsapp',
    });
    expect(p('tell Jo on telegram that dinner is ready')).toMatchObject({
      name: 'Jo',
      text: 'Dinner is ready',
      app: 'telegram',
    });
  });
  it('handles let … know', () => {
    expect(p('Can you let Alex know I will be 10 minutes late?')).toMatchObject({
      type: 'message',
      name: 'Alex',
      text: 'I will be 10 minutes late',
    });
  });
  it('ignores tell me', () => {
    expect(p('tell me a joke')).toBeNull();
  });
  it('splitNameAndText falls back to one word', () => {
    expect(splitNameAndText('Sam dinner tonight')).toEqual({ name: 'Sam', text: 'dinner tonight' });
  });
});

describe('replies and reading', () => {
  it('replies to the latest or a named chat', () => {
    expect(p('reply on my way')).toEqual({ type: 'reply', name: null, text: 'On my way' });
    expect(p('reply to her with ok')).toEqual({ type: 'reply', name: null, text: 'Ok' });
    expect(p('reply to Sam saying sounds good')).toEqual({
      type: 'reply',
      name: 'Sam',
      text: 'Sounds good',
    });
  });
  it('reads messages and notifications', () => {
    expect(p('Read my messages')).toEqual({ type: 'readMessages', name: null });
    expect(p('any new texts?')).toEqual({ type: 'readMessages', name: null });
    expect(p('What did Sam say?')).toEqual({ type: 'readMessages', name: 'Sam' });
    expect(p('read my notifications')).toEqual({ type: 'readNotifications' });
  });
});

describe('email', () => {
  it('reads subject and body', () => {
    expect(p('email Dana about the invoice saying it is paid')).toEqual({
      type: 'email',
      name: 'Dana',
      subject: 'The invoice',
      body: 'It is paid',
    });
  });
  it('without a subject', () => {
    expect(p("send an email to Pat I'll send the slides tonight")).toMatchObject({
      type: 'email',
      name: 'Pat',
      subject: '',
      body: "I'll send the slides tonight",
    });
  });
});

describe('calls, alarms, timers, maps, media', () => {
  it('calls', () => {
    expect(p('call Mum')).toEqual({ type: 'call', name: 'Mum' });
    expect(p('Ring Dr Patel please')).toEqual({ type: 'call', name: 'Dr Patel' });
    expect(p('call me a taxi')).toBeNull();
  });
  it('alarms keep the hour as said', () => {
    expect(p('set an alarm for 6')).toEqual({ type: 'alarm', hour: 6, minute: 0, label: '' });
    expect(p('wake me up at 7:30')).toMatchObject({ hour: 7, minute: 30 });
    expect(p('set alarm for 6.45 pm')).toMatchObject({ hour: 18, minute: 45 });
    expect(clockTime('half past seven')).toEqual({ hour: 7, minute: 30 });
  });
  it('timers', () => {
    expect(p('set a timer for 10 minutes')).toEqual({ type: 'timer', seconds: 600, label: '' });
    expect(p('timer for 1 hour 30 minutes')).toMatchObject({ seconds: 5400 });
    expect(p('set a timer for half an hour')).toMatchObject({ seconds: 1800 });
  });
  it('navigation', () => {
    expect(p('navigate to the train station')).toEqual({
      type: 'navigate',
      destination: 'the train station',
      mode: 'driving',
    });
    expect(p('directions to Tesco on foot')).toMatchObject({
      destination: 'Tesco',
      mode: 'walking',
    });
    expect(p('take me home')).toMatchObject({ destination: 'home' });
  });
  it('media', () => {
    expect(p('pause the music')).toEqual({ type: 'media', cmd: 'pause' });
    expect(p('skip')).toEqual({ type: 'media', cmd: 'next' });
    expect(p('previous track')).toEqual({ type: 'media', cmd: 'previous' });
    expect(p("what's playing?")).toEqual({ type: 'nowPlaying' });
  });
  it('send it / cancel', () => {
    expect(p('Send it')).toEqual({ type: 'sendIt' });
    expect(p('yes send')).toEqual({ type: 'sendIt' });
    expect(p("don't send it")).toEqual({ type: 'cancelIt' });
  });
});

describe('calendar', () => {
  it('adds a timed event of an hour', () => {
    const e = p('add dentist tomorrow at 3pm to my calendar')!;
    expect(e).toMatchObject({ type: 'event', title: 'Dentist', allDay: false });
    if (e.type !== 'event') throw new Error();
    expect(new Date(e.start)).toEqual(new Date(2025, 10, 25, 15, 0));
    expect(e.end - e.start).toBe(3600_000);
  });
  it('all-day and duration', () => {
    const e = p('put Sam birthday on Friday in my calendar')!;
    expect(e).toMatchObject({ title: 'Sam birthday', allDay: true });
    const m = p('schedule a meeting with Jo on Thursday at 10 for 2 hours')!;
    if (m.type !== 'event') throw new Error();
    expect(m.title).toBe('Meeting with Jo');
    expect(m.end - m.start).toBe(7200_000);
  });
});

describe('mightBeAction', () => {
  it('only for action-like wording', () => {
    expect(mightBeAction('could you drop Sam a line about Friday')).toBe(true);
    expect(mightBeAction('what is the capital of France')).toBe(false);
    expect(mightBeAction('how do I make bread')).toBe(false);
  });
});
