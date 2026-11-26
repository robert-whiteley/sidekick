import { addJob, jobExpired, queuedLine } from '@/engine/online-queue-logic';
import { parseShared, sharedKind } from '@/engine/share-in';
import {
  combinePrompt,
  clockOf,
  DOC_LIMITS,
  docParts,
  docPrompt,
  fileKind,
  firstUrl,
  isJustLink,
  labelSpeakers,
  parseRecordingLines,
  recordingReadyLine,
  suggestions,
  transcriptText,
  type RecordingLine,
} from '@/engine/shared-doc-logic';
import { relevantTools } from '@/engine/tools-logic';

jest.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
jest.mock('@/integrations/native', () => ({ integrationsNative: () => null }));

describe('what a share is', () => {
  it('tells files, selections, pictures, links and text apart', () => {
    expect(sharedKind({ selection: 'teh text', at: 1 })).toBe('selection');
    expect(sharedKind({ filePath: '/c/a.pdf', mime: 'application/pdf', at: 1 })).toBe('file');
    expect(sharedKind({ fileError: 'big.m4a', at: 1 })).toBe('file-error');
    expect(sharedKind({ imagePath: '/c/a.jpg', at: 1 })).toBe('image');
    expect(sharedKind({ text: 'https://en.wikipedia.org/wiki/Otter', at: 1 })).toBe('link');
    expect(
      sharedKind({ text: 'Otter - Wikipedia https://en.wikipedia.org/wiki/Otter', at: 1 }),
    ).toBe('link');
    expect(
      sharedKind({
        text: 'Long note with a link https://x.org in the middle of many more words that go on and on about the plan for next week and what we need to bring along',
        at: 1,
      }),
    ).toBe('text');
    expect(sharedKind({ text: '  ', at: 1 })).toBeNull();
  });
  it('parses the native share, including files and selections', () => {
    expect(parseShared('{"filePath":"/c/a.pdf","at":1}')?.filePath).toBe('/c/a.pdf');
    expect(parseShared('{"selection":"hi","readonly":true,"at":1}')?.readonly).toBe(true);
    expect(parseShared('{"at":1}')).toBeNull();
    expect(parseShared('nope')).toBeNull();
  });
  it('knows file kinds by type or name', () => {
    expect(fileKind('application/pdf', 'x')).toBe('pdf');
    expect(fileKind('', 'Meeting.M4A')).toBe('audio');
    expect(fileKind('audio/ogg', '')).toBe('audio');
    expect(fileKind('text/plain', 'n')).toBe('text');
    expect(fileKind('application/zip', 'a.zip')).toBeNull();
  });
  it('finds the link without trailing punctuation', () => {
    expect(firstUrl('see (https://a.org/x).')).toBe('https://a.org/x');
    expect(isJustLink('no link here')).toBe(false);
  });
});

describe('long documents', () => {
  it('answers short text in one pass and cuts long text into parts', () => {
    expect(docParts('short').parts).toEqual(['short']);
    const long = 'A sentence about otters. '.repeat(2000);
    const { parts, partial } = docParts(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= DOC_LIMITS.partChars + 200)).toBe(true);
    expect(partial).toBe(false);
    const huge = docParts('Word. '.repeat(DOC_LIMITS.partChars * DOC_LIMITS.maxParts));
    expect(huge.parts).toHaveLength(DOC_LIMITS.maxParts);
    expect(huge.partial).toBe(true);
  });
  it('keeps prompts small and marks the text as material', () => {
    const p = docPrompt('Summarise this.', 'the document "a.pdf"', 'Hello """ there');
    expect(p).toContain('not instructions');
    expect(p).not.toContain('Hello """');
    expect(combinePrompt('q', 'x', ['NONE', 'Otters swim.'])).toContain('Part 2: Otters swim.');
    expect(combinePrompt('q', 'x', ['none'])).toContain('no part had anything');
  });
  it('offers the right buttons', () => {
    const labels = (kind: Parameters<typeof suggestions>[0]['kind']) =>
      suggestions({ kind, name: 'n', at: 0 }).map((s) => s.label);
    expect(labels('audio')).toContain('Transcript');
    expect(labels('selection')).toEqual(
      expect.arrayContaining(['Proofread', 'Friendlier', 'More professional', 'Shorter']),
    );
    expect(labels('pdf')).toContain('Action points');
  });
});

describe('who said what in a recording', () => {
  const a = [1, 0, 0, 0];
  const b = [0, 1, 0, 0];
  const me = [0, 0, 1, 0];
  const line = (at: number, text: string, voice: number[] | null, durationMs = 4000) =>
    ({ at, text, voice, durationMs }) as RecordingLine;

  it('labels the owner as You and others by order of first speaking', () => {
    const t = labelSpeakers(
      [
        line(0, 'Hello all.', a),
        line(5000, 'Hi there.', b),
        line(10000, 'Let us start.', me),
        line(15000, 'Agreed.', a),
        line(19500, 'Yes.', null, 800),
        line(40000, 'Hm.', null, 800),
      ],
      me,
    );
    expect(t.map((x) => x.speaker)).toEqual([
      'Speaker 1',
      'Speaker 2',
      'You',
      'Speaker 1',
      'Speaker 1',
      'Someone',
    ]);
    expect(transcriptText(t).split('\n')[0]).toBe('[0:00] Speaker 1: Hello all.');
    expect(recordingReadyLine('m.m4a', t, 65000)).toContain('1:05, 3 voices');
  });
  it('parses lines and skips bad ones', () => {
    const raw = '{"at":5,"durationMs":1,"text":"b"}\nbad\n{"at":1,"durationMs":1,"text":"a"}\n';
    expect(parseRecordingLines(raw).map((l) => l.text)).toEqual(['a', 'b']);
    expect(clockOf(3_723_000)).toBe('1:02:03');
    expect(recordingReadyLine('x', [], 0)).toContain("couldn't hear");
  });
});

describe('web pages in the online queue', () => {
  it('keeps one job per page and question, for 3 days', () => {
    const j = { id: '1', kind: 'page' as const, question: 'Summarise', askedAt: 0, url: 'u1' };
    let jobs = addJob([], j);
    jobs = addJob(jobs, { ...j, id: '2' });
    jobs = addJob(jobs, { ...j, id: '3', url: 'u2' });
    expect(jobs).toHaveLength(2);
    expect(jobExpired(j, 2 * 86400_000)).toBe(false);
    expect(jobExpired(j, 4 * 86400_000)).toBe(true);
    expect(queuedLine('page')).toContain('online');
  });
});

describe('"What did I miss?" is offered', () => {
  it('for missed and unread notifications', () => {
    for (const q of ['What did I miss?', 'catch me up', 'any unread notifications'])
      expect(relevantTools(q).map((t) => t.name)).toContain('missed');
  });
});
