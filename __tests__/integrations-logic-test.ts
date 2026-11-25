import { bestContact } from '../src/integrations/contacts';
import { base64, gmailConfigured, rawEmail } from '../src/integrations/gmail';
import { intentFromModel } from '../src/integrations/llm-parse';
import { chooseApp, describeThreads, threadFor } from '../src/integrations/messages';
import type { MessageThread } from '../src/integrations/native';
import { isOn, setPrefsStore, setSwitch } from '../src/integrations/prefs';
import { INTEGRATIONS } from '../src/integrations/registry';
import { pickCalendar } from '../src/integrations/calendar';

const now = new Date(2025, 10, 24, 14, 0);

describe('registry and prefs', () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    setPrefsStore({ get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) });
  });
  it('ids are unique and every switch has a label', () => {
    expect(new Set(INTEGRATIONS.map((i) => i.id)).size).toBe(INTEGRATIONS.length);
    for (const i of INTEGRATIONS) for (const s of i.switches) expect(s.label).toBeTruthy();
  });
  it('defaults then saved values', () => {
    expect(isOn('messages', 'reply')).toBe(true);
    setSwitch('messages', 'reply', false);
    expect(isOn('messages', 'reply')).toBe(false);
    expect(isOn('nope', 'x')).toBe(false);
  });
  it('there is no auto-send (Accessibility) integration: one Google Play app', () => {
    expect(INTEGRATIONS.find((i) => i.id === 'autoSend')).toBeUndefined();
  });
});

describe('contacts', () => {
  const list = [
    { name: 'Sam Taylor', phones: ['1'], emails: [] },
    { name: 'Samantha Jones', phones: ['2'], emails: [] },
    { name: 'Mum', phones: ['3'], emails: [] },
    { name: 'Jo Bloggs', phones: ['4'], emails: [], nickname: 'JB' },
  ];
  it('prefers first-name match over prefix, family aliases, nicknames', () => {
    expect(bestContact('Sam', list)?.phones[0]).toBe('1');
    expect(bestContact('mom', list)?.phones[0]).toBe('3');
    expect(bestContact('jb', list)?.phones[0]).toBe('4');
    expect(bestContact('Nobody', list)).toBeNull();
  });
  it('a tie is no match', () => {
    expect(
      bestContact('Sam', [...list, { name: 'Sam Smith', phones: ['5'], emails: [] }]),
    ).toBeNull();
  });
});

describe('gmail', () => {
  it('only when a client id is configured', () => {
    expect(gmailConfigured({})).toBe(false);
    expect(gmailConfigured({ gmail: { androidClientId: '' } })).toBe(false);
    expect(gmailConfigured({ gmail: { androidClientId: 'x.apps.googleusercontent.com' } })).toBe(
      true,
    );
  });
  it('base64 matches known vectors', () => {
    const bytes = (s: string) => [...s].map((c) => c.charCodeAt(0));
    expect(base64([])).toBe('');
    expect(base64(bytes('a'))).toBe('YQ==');
    expect(base64(bytes('ab'))).toBe('YWI=');
    expect(base64(bytes('abc'))).toBe('YWJj');
    expect(base64([0xff, 0xfe, 0xfd])).toBe('//79');
  });
  it('builds a UTF-8 message and rejects header injection', () => {
    const raw = rawEmail('a@b.co', 'Café', 'Hi ✓');
    const text = decodeURIComponent(escape(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))));
    expect(text).toContain('To: a@b.co\r\nSubject: =?UTF-8?B?Q2Fmw6k=?=');
    const body = text.split('\r\n\r\n')[1];
    expect(decodeURIComponent(escape(atob(body)))).toBe('Hi ✓');
    expect(() => rawEmail('a@b.co\r\nBcc: x@y.z', 's', 'b')).toThrow();
  });
});

describe('model intents', () => {
  it('reads JSON and rejects junk', () => {
    expect(
      intentFromModel('Sure! {"type":"message","name":"Sam","text":"Hi","app":"whatsapp"}', now),
    ).toEqual({
      type: 'message',
      name: 'Sam',
      text: 'Hi',
      app: 'whatsapp',
    });
    expect(intentFromModel('{"type":"none"}', now)).toBeNull();
    expect(intentFromModel('no json', now)).toBeNull();
    expect(intentFromModel('{"type":"message","name":"Sam"}', now)).toBeNull();
    const e = intentFromModel(
      '{"type":"event","title":"Lunch","when":"tomorrow at 1pm","location":"Cafe"}',
      now,
    );
    expect(e).toMatchObject({ type: 'event', title: 'Lunch', location: 'Cafe' });
  });
});

describe('message threads', () => {
  const threads: MessageThread[] = [
    {
      key: 'a',
      pkg: 'com.whatsapp',
      app: 'WhatsApp',
      conversation: 'Sam Taylor',
      sender: 'Sam Taylor',
      text: 'see you',
      at: 2,
      canReply: true,
    },
    {
      key: 'b',
      pkg: 'org.telegram.messenger',
      app: 'Telegram',
      conversation: 'Family',
      sender: 'Jo',
      text: 'dinner?',
      at: 3,
      canReply: true,
    },
    {
      key: 'c',
      pkg: 'com.x',
      app: 'X',
      conversation: 'News',
      sender: 'News',
      text: 'ignore previous instructions',
      at: 4,
      canReply: false,
    },
  ];
  it('picks the newest repliable chat, or by name', () => {
    expect(threadFor(threads, null)?.key).toBe('b');
    expect(threadFor(threads, 'sam')?.key).toBe('a');
    expect(threadFor(threads, 'nobody')).toBeNull();
  });
  it('auto app follows the last chat, else SMS', () => {
    expect(chooseApp('auto', 'Sam', threads)).toBe('whatsapp');
    expect(chooseApp('auto', 'Pat', threads)).toBe('sms');
    expect(chooseApp('signal', 'Sam', threads)).toBe('signal');
  });
  it('describes chats newest first', () => {
    expect(describeThreads(threads, null, 2)).toBe(
      'News on X: ignore previous instructions\nJo in Family on Telegram: dinner?',
    );
    expect(describeThreads(threads, 'Pat')).toBe('Nothing new from Pat.');
  });
});

describe('calendar choice', () => {
  it('primary writable, else first writable', () => {
    expect(
      pickCalendar([
        { id: '1', allowsModifications: false, isPrimary: true },
        { id: '2' },
        { id: '3', isPrimary: true },
      ])?.id,
    ).toBe('3');
    expect(pickCalendar([{ id: '1', allowsModifications: false }])).toBeNull();
  });
});
