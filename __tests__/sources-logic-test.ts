import {
  askedNumberOf,
  chunkText,
  eventItem,
  eventText,
  fileItems,
  fileKeyPrefix,
  findContacts,
  folderKeyPrefix,
  hash,
  isDue,
  isIndexableFile,
  notificationKey,
  notificationText,
  numberAnswer,
  planSync,
  retentionCutoff,
  SYNC_EVERY_MS,
} from '../src/memory/sources-logic';
import { contactNameMatches, fullNameFromContacts } from '../src/memory/names';

describe('planSync', () => {
  it('inserts new, updates changed, removes missing, keeps unchanged', () => {
    const plan = planSync(
      [
        { id: 1, key: 'a', ver: '1' },
        { id: 2, key: 'b', ver: '1' },
        { id: 3, key: 'c', ver: '1' },
      ],
      [
        { key: 'a', ver: '1', at: 0, text: 'same' },
        { key: 'b', ver: '2', at: 0, text: 'changed' },
        { key: 'd', ver: '1', at: 0, text: 'new' },
        { key: 'd', ver: '1', at: 0, text: 'duplicate' },
      ],
    );
    expect(plan.insert.map((i) => i.key)).toEqual(['d']);
    expect(plan.update).toEqual([{ key: 'b', ver: '2', at: 0, text: 'changed', id: 2 }]);
    expect(plan.remove).toEqual([3]);
  });

  it('removes everything when the source is empty', () => {
    expect(planSync([{ id: 7, key: 'x', ver: null }], []).remove).toEqual([7]);
  });
});

describe('scheduling and retention', () => {
  it('is due first time, after the interval, or if the clock went back', () => {
    expect(isDue('folders', null, 1000)).toBe(true);
    expect(isDue('folders', 1000, 1000 + SYNC_EVERY_MS.folders - 1)).toBe(false);
    expect(isDue('folders', 1000, 1000 + SYNC_EVERY_MS.folders)).toBe(true);
    expect(isDue('contacts', 5000, 1000)).toBe(true);
  });

  it('cuts off by retention days, or never', () => {
    expect(retentionCutoff(0, 10)).toBe(-Infinity);
    expect(retentionCutoff(1, 86_400_000 * 3)).toBe(86_400_000 * 2);
  });

  it('hashes stably', () => {
    expect(hash('abc')).toBe(hash('abc'));
    expect(hash('abc')).not.toBe(hash('abd'));
  });
});

describe('folders', () => {
  it('reads only text files under the size limit', () => {
    expect(isIndexableFile('notes.md', 100)).toBe(true);
    expect(isIndexableFile('Todo.TXT', null)).toBe(true);
    expect(isIndexableFile('report.pdf', 100)).toBe(false);
    expect(isIndexableFile('photo.jpg', 100)).toBe(false);
    expect(isIndexableFile('.hidden.md', 100)).toBe(false);
    expect(isIndexableFile('huge.txt', 5_000_000)).toBe(false);
  });

  it('chunks at paragraph boundaries within the limit', () => {
    const para = 'word '.repeat(50).trim(); // 249 chars
    const chunks = chunkText([para, para, para, para, para].join('\n\n'), 600);
    expect(chunks.length).toBe(3);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(600));
    expect(chunks.join(' ').split('word').length - 1).toBe(250);
  });

  it('splits one huge paragraph and caps the number of chunks', () => {
    const long = 'Sentence here. '.repeat(400);
    const chunks = chunkText(long, 200, 5);
    expect(chunks.length).toBe(5);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(200));
    expect(chunkText('x'.repeat(450), 200)).toEqual([
      'x'.repeat(200),
      'x'.repeat(200),
      'x'.repeat(50),
    ]);
    expect(chunkText('   ')).toEqual([]);
  });

  it('keys chunks by folder and file, with the path in the text', () => {
    const items = fileItems('content://tree/A', 'content://tree/A/doc/1', 'A/x.md', 42, 'hello');
    expect(items).toEqual([
      {
        key: 'file:content://tree/A|content://tree/A/doc/1#0',
        ver: '42',
        at: 42,
        text: 'File A/x.md:\nhello',
      },
    ]);
    expect(
      items[0].key.startsWith(fileKeyPrefix('content://tree/A', 'content://tree/A/doc/1')),
    ).toBe(true);
    expect(items[0].key.startsWith(folderKeyPrefix('content://tree/A'))).toBe(true);
    expect(items[0].key.startsWith(folderKeyPrefix('content://tree/AB'))).toBe(false);
  });
});

describe('calendar', () => {
  const start = new Date(2026, 11, 3, 10, 0).getTime();
  const ev = {
    id: 'e1',
    title: 'Dentist',
    start,
    end: start + 30 * 60_000,
    allDay: false,
    location: 'High St Dental',
    notes: 'Bring\nform',
  };

  it('writes the date out so the event is findable by words', () => {
    const t = eventText(ev);
    expect(t).toContain('Calendar event: Dentist on Thu 3 Dec 2026, 10:00–10:30');
    expect(t).toContain('at High St Dental');
    expect(t).toContain('Notes: Bring form');
  });

  it('marks all-day events', () => {
    expect(
      eventText({ ...ev, start: Date.UTC(2026, 11, 3), allDay: true, location: null, notes: null }),
    ).toBe('Calendar event: Dentist on Thu 3 Dec 2026 (all day)');
  });

  it('keys each occurrence and versions by content', () => {
    const a = eventItem(ev);
    expect(a.key).toBe(`cal:e1@${start}`);
    expect(a.at).toBe(start);
    expect(eventItem({ ...ev, title: 'Dentist (moved)' }).ver).not.toBe(a.ver);
    expect(eventItem({ ...ev, start: start + 7 * 86_400_000 }).key).not.toBe(a.key);
  });
});

describe('notifications', () => {
  const base = { at: 1, pkg: 'com.whatsapp', app: 'WhatsApp' };

  it('keeps message text with the app name', () => {
    expect(notificationText({ ...base, title: 'Sam', text: 'Running late' })).toBe(
      'Notification from WhatsApp: Sam: Running late',
    );
    expect(notificationText({ ...base, app: null, title: null, text: 'Hi' })).toBe(
      'Notification from com.whatsapp: Hi',
    );
  });

  it('skips status categories, own app, empty and one-time codes', () => {
    expect(notificationText({ ...base, text: 'Playing', category: 'transport' })).toBeNull();
    expect(notificationText({ ...base, text: 'x' }, 'com.whatsapp')).toBeNull();
    expect(notificationText({ ...base, title: ' ', text: '' })).toBeNull();
    expect(notificationText({ ...base, text: 'Your verification code is 482913' })).toBeNull();
    expect(notificationText({ ...base, text: 'Code review at 3pm' })).not.toBeNull();
  });

  it('dedupes the same text from the same app', () => {
    const t = 'Notification from WhatsApp: Sam: hi';
    expect(notificationKey(base, t)).toBe(notificationKey({ ...base, at: 99 }, t));
    expect(notificationKey(base, t)).not.toBe(notificationKey({ ...base, pkg: 'x' }, t));
  });
});

describe('contacts', () => {
  const contacts = [
    { name: 'Sam Jones', phones: [{ label: 'mobile', number: '+44 7700 900123' }] },
    { name: 'Sam Patel', phones: [{ label: null, number: '01632 960001' }] },
    { name: 'Alex Kim', phones: [] },
    { name: 'José García', phones: [{ label: 'work', number: '555' }] },
  ];

  it('recognises number questions', () => {
    expect(askedNumberOf("What's Sam Jones's number?")).toBe('Sam Jones');
    expect(askedNumberOf('what is Alex’s phone number')).toBe('Alex');
    expect(askedNumberOf("what's my mum's mobile number")).toBe('mum');
    expect(askedNumberOf('number for Jose Garcia')).toBe('Jose Garcia');
    expect(askedNumberOf('How do I call Sam?')).toBe('Sam');
    expect(askedNumberOf('what did Sam say about the number of guests')).toBeNull();
    expect(askedNumberOf('what is the time')).toBeNull();
  });

  it('finds contacts by full name, then by words, ignoring accents', () => {
    expect(findContacts('sam jones', contacts).map((c) => c.name)).toEqual(['Sam Jones']);
    expect(findContacts('Sam', contacts).map((c) => c.name)).toEqual(['Sam Jones', 'Sam Patel']);
    expect(findContacts('Jose Garcia', contacts).map((c) => c.name)).toEqual(['José García']);
    expect(findContacts('Zed', contacts)).toEqual([]);
  });

  it('answers with numbers, or says it found none', () => {
    expect(numberAnswer('Sam Jones', contacts)).toBe('Sam Jones: +44 7700 900123 (mobile).');
    expect(numberAnswer('Sam', contacts)).toBe(
      'Sam Jones: +44 7700 900123 (mobile). Sam Patel: 01632 960001.',
    );
    expect(numberAnswer('Alex', contacts)).toBe(
      "I couldn't find a phone number for Alex in your contacts.",
    );
  });

  it('makes heard names specific and suggests contact names', () => {
    const names = contacts.map((c) => c.name);
    expect(fullNameFromContacts('Alex', names)).toBe('Alex Kim');
    expect(fullNameFromContacts('Sam', names)).toBe('Sam');
    expect(fullNameFromContacts('Pat', names)).toBe('Pat');
    expect(contactNameMatches('sa', names)).toEqual(['Sam Jones', 'Sam Patel']);
    expect(contactNameMatches('pat', names)).toEqual(['Sam Patel']);
    expect(contactNameMatches('s', names)).toEqual([]);
    expect(contactNameMatches('Alex Kim', names)).toEqual([]);
  });
});
