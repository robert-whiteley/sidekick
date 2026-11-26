/**
 * Asking about something shared into Sidekick (share-in.ts): a PDF (the folder-source PDF
 * reader), a text document, a recording (transcribed natively in the background with who said
 * what, then saved to memory), a web page (Online on only: that one page is fetched) and text
 * selected in another app (proofread, rewrite… and the new text handed back). Long texts are read
 * in parts that fit the model. Logic: shared-doc-logic.ts.
 */
import SidekickNative from '../../modules/sidekick-native';
import { integrationsNative, type RecordingStatus } from '@/integrations/native';
import { rememberExchange, ownerVoice } from '@/memory/store';
import { addSharedFile, readPdf } from '@/memory/sources';
import { clipText, type WebSource } from '@/web/lookup-logic';
import { isOnline } from '@/web/lookup';
import { fetchPage } from '@/web/page';
import { siteOf } from '@/web/page-logic';
import { askLlm } from './llm';
import { queueOnline } from './online-queue';
import { getSettings } from './settings';
import type { SharedItem } from './share-in';
import {
  type Attachment,
  combinePrompt,
  DOC_LIMITS,
  DOC_SYSTEM,
  docLabel,
  docParts,
  docPrompt,
  fileKind,
  firstUrl,
  labelSpeakers,
  parseRecordingLines,
  partPrompt,
  recordingReadyLine,
  TRANSCRIPT_QUESTION,
  transcriptText,
} from './shared-doc-logic';

export type SharedAnswer = { text: string; ms: number; web?: WebSource[]; waitingOnline?: boolean };

/** What the chat attaches for a share (a picture or plain text are handled by the Ask screen). */
export async function attachmentFor(item: SharedItem): Promise<Attachment | null> {
  const at = item.at || Date.now();
  if (typeof item.selection === 'string' && item.selection.trim()) {
    return {
      kind: 'selection',
      name: 'Selected text',
      at,
      text: item.selection,
      replaceable: !item.readonly && !!integrationsNative()?.processTextWaiting?.(),
    };
  }
  if (item.fileError)
    return {
      kind: 'text',
      name: item.fileError,
      at,
      error: "I couldn't open that file (it may be too big).",
    };
  if (item.filePath) {
    const name = item.fileName || 'Shared file';
    const kind = fileKind(item.mime, name);
    if (!kind) return { kind: 'text', name, at, error: "I can't read this kind of file yet." };
    if (kind === 'audio') return startRecording(item.filePath, name, at);
    try {
      if (kind === 'pdf') {
        const r = await readPdf(item.filePath);
        if (!r.text.trim())
          return { kind, name, at, error: "I couldn't find any text in this PDF." };
        return { kind, name, at, text: r.text, partial: !r.complete };
      }
      const text = SidekickNative.readText(item.filePath) ?? '';
      if (!text.trim()) return { kind, name, at, error: 'This file is empty.' };
      return { kind, name, at, text };
    } catch (e) {
      console.log(`[share] read failed: ${String(e)}`);
      return { kind, name, at, error: "I couldn't read that file." };
    } finally {
      // The text is in the chat now; the copy in the cache isn't needed.
      SidekickNative.deleteFile(item.filePath);
    }
  }
  const url = firstUrl(item.text ?? '');
  if (url) return { kind: 'page', name: item.subject?.trim() || siteOf(url), at, url };
  return null;
}

// --- Recordings ---

type KeptRecording = { id: string; path: string; name: string; at: number };
const KV_RECORDINGS = 'shared-recordings.v1';

function kept(): KeptRecording[] {
  try {
    const v = SidekickNative.kvGet(KV_RECORDINGS);
    return v ? (JSON.parse(v) as KeptRecording[]) : [];
  } catch {
    return [];
  }
}
const keep = (list: KeptRecording[]) => SidekickNative.kvSet(KV_RECORDINGS, JSON.stringify(list));

function startRecording(path: string, name: string, at: number): Attachment {
  const n = integrationsNative();
  const id = `rec${at}`;
  if (!n?.recordingStart)
    return { kind: 'audio', name, at, error: "Recordings can't be read on this phone yet." };
  keep([...kept().filter((r) => r.id !== id), { id, path, name, at }]);
  if (!n.recordingStart(id, path))
    return {
      kind: 'audio',
      name,
      at,
      error: 'Another recording is still being read. Try again after it.',
    };
  return { kind: 'audio', name, at, recordingId: id, progress: 0 };
}

export function recordingStatus(id: string): RecordingStatus | null {
  try {
    return integrationsNative()?.recordingStatus?.(id) ?? null;
  } catch {
    return null;
  }
}

/** Calls [onChange] while recordings are being read (native progress events). */
export function watchRecordings(onChange: () => void): () => void {
  const sub = integrationsNative()?.addListener?.('onRecording', onChange);
  return () => sub?.remove();
}

export type ReadRecording = { name: string; text: string; line: string };

/**
 * A recording that has been read: who said what, saved to memory as a file (not off the record),
 * the native copy and the audio file removed. Null if it isn't finished.
 */
export async function finishRecording(
  id: string,
  offRecord: boolean,
): Promise<ReadRecording | null> {
  const n = integrationsNative();
  const st = recordingStatus(id);
  if (!n || !st || (!st.finished && !st.error)) return null;
  const rec = kept().find((r) => r.id === id);
  const name = rec?.name ?? 'the recording';
  const done = () => {
    n.recordingForget?.(id);
    if (rec) SidekickNative.deleteFile(rec.path);
    keep(kept().filter((r) => r.id !== id));
  };
  if (st.error) {
    done();
    return { name, text: '', line: `I couldn't read "${name}": ${st.error}` };
  }
  const lines = labelSpeakers(
    parseRecordingLines(n.recordingLines?.(id) ?? ''),
    await ownerVoice().catch(() => null),
  );
  const text = transcriptText(lines);
  if (text && !offRecord) {
    const day = new Date(rec?.at ?? Date.now()).toDateString().slice(4, 10);
    await addSharedFile(id, `recording "${name}" (shared ${day}, who said what)`, text, rec?.at);
  }
  done();
  return { name, text, line: recordingReadyLine(name, lines, st.totalMs) };
}

/**
 * At start: recordings left unfinished when the app was closed carry on; finished ones not yet
 * saved are saved. Returns those finished now.
 */
export async function resumeRecordings(offRecord: boolean): Promise<ReadRecording[]> {
  const n = integrationsNative();
  if (!n?.recordingStart) return [];
  const out: ReadRecording[] = [];
  for (const r of kept()) {
    const st = recordingStatus(r.id);
    if (!st) {
      keep(kept().filter((x) => x.id !== r.id));
      continue;
    }
    if (st.finished || st.error) {
      const done = await finishRecording(r.id, offRecord).catch(() => null);
      if (done) out.push(done);
    } else if (!st.running) n.recordingStart(r.id, r.path);
  }
  return out;
}

export function cancelRecording(id: string) {
  const n = integrationsNative();
  n?.recordingCancel?.(id);
  n?.recordingForget?.(id);
  const rec = kept().find((r) => r.id === id);
  if (rec) SidekickNative.deleteFile(rec.path);
  keep(kept().filter((r) => r.id !== id));
}

// --- Answers ---

/** Reads [text] (one pass, or notes from each part, then the answer from the notes). */
export async function answerFromText(
  label: string,
  text: string,
  question: string,
  onText: (full: string) => void,
  onStatus: (line: string) => void = () => {},
): Promise<{ text: string; ms: number }> {
  const t0 = Date.now();
  const { parts, partial } = docParts(text);
  const ask = (prompt: string, maxTokens: number, stream: (full: string) => void) =>
    askLlm(prompt, null, stream, { system: DOC_SYSTEM, maxTokens, scratch: true });
  let answer: string;
  if (parts.length <= 1) {
    onStatus('Reading…');
    answer = (
      await ask(docPrompt(question, label, parts[0] ?? ''), DOC_LIMITS.answerTokens, onText)
    ).text;
  } else {
    const notes: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      onStatus(`Reading part ${i + 1} of ${parts.length}…`);
      notes.push(
        (
          await ask(
            partPrompt(question, label, i, parts.length, parts[i]),
            DOC_LIMITS.noteTokens,
            () => {},
          )
        ).text,
      );
    }
    onStatus('Writing the answer…');
    answer = (await ask(combinePrompt(question, label, notes), DOC_LIMITS.answerTokens, onText))
      .text;
  }
  answer = answer.trim();
  if (partial) {
    answer = `${answer}\n\n(It was too long to read all of it: this is from the first part.)`;
    onText(answer);
  }
  return { text: answer, ms: Date.now() - t0 };
}

const pageSource = (url: string, title: string, text: string): WebSource => ({
  name: siteOf(url),
  title,
  url,
  text: clipText(text),
});

/** Reads one page now and answers; throws while still offline (the online queue retries). */
export async function answerPageNow(url: string, question: string): Promise<string> {
  if (!getSettings().webLookup || !(await isOnline())) throw new Error('offline');
  const r = await fetchPage(url);
  if (!r.ok) {
    if (r.reason === 'offline') throw new Error('offline');
    return pageError(r.reason);
  }
  const a = await answerFromText(`the web page "${r.page.title}"`, r.page.text, question, () => {});
  return `${a.text}\n\nSource: ${r.page.url}`;
}

function pageError(reason: 'unreadable' | 'not-html' | 'empty' | 'offline'): string {
  if (reason === 'not-html')
    return "That link isn't a web page I can read (try sharing the file itself).";
  if (reason === 'empty') return "I couldn't find any text on that page.";
  return "I couldn't read that page.";
}

/**
 * A question about a web page (shared, or a link pasted in the question). Online off or no
 * internet: says so and keeps it for later (not off the record).
 */
export async function answerAboutPage(
  url: string,
  question: string,
  onText: (full: string) => void,
  onStatus: (line: string) => void,
  offRecord: boolean,
  page?: { title: string; text: string },
): Promise<SharedAnswer & { page?: { title: string; text: string } }> {
  const say = (text: string, extra: Partial<SharedAnswer> = {}) => {
    onText(text);
    return { text, ms: 0, ...extra };
  };
  const later = (why: string) =>
    offRecord
      ? say(`${why} You're off the record, so I won't keep it for later.`)
      : say(`${why} ${queueOnline('page', question, Date.now(), url)}`, { waitingOnline: true });
  if (!page) {
    if (!getSettings().webLookup)
      return later('Reading a web page needs Online (the button at the top).');
    onStatus('Reading the page…');
    if (!(await isOnline())) return later("There's no internet right now.");
    const r = await fetchPage(url);
    if (!r.ok)
      return r.reason === 'offline'
        ? later("I couldn't reach the page.")
        : say(pageError(r.reason));
    page = { title: r.page.title, text: r.page.text };
    url = r.page.url;
  }
  const a = await answerFromText(
    `the web page "${page.title}"`,
    page.text,
    question,
    onText,
    onStatus,
  );
  return { ...a, web: [pageSource(url, page.title, page.text)], page };
}

/**
 * The answer about an attachment. Saves the exchange in memory like a chat turn (not off the
 * record, and not for text selected in another app: that text belongs to the other app).
 */
export async function answerShared(
  a: Attachment,
  question: string,
  onText: (full: string) => void,
  onStatus: (line: string) => void,
  offRecord: boolean,
): Promise<SharedAnswer & { page?: { title: string; text: string } }> {
  const q = question.trim() || 'Summarise this.';
  if (a.error) {
    onText(a.error);
    return { text: a.error, ms: 0 };
  }
  if (a.kind === 'audio' && !a.text) {
    const st = a.recordingId ? recordingStatus(a.recordingId) : null;
    const pct = st && st.totalMs ? Math.round((st.doneMs / st.totalMs) * 100) : 0;
    const text = `I'm still reading the recording (${pct}%). Ask again when it's done; I'll say when.`;
    onText(text);
    return { text, ms: 0 };
  }
  if (a.kind === 'audio' && q === TRANSCRIPT_QUESTION) {
    onText(a.text!);
    return { text: a.text!, ms: 0 };
  }
  const r =
    a.kind === 'page' && a.url
      ? await answerAboutPage(
          a.url,
          q,
          onText,
          onStatus,
          offRecord,
          a.text ? { title: a.name, text: a.text } : undefined,
        )
      : await answerFromText(docLabel(a), a.text ?? '', q, onText, onStatus);
  if (!offRecord && a.kind !== 'selection' && !('waitingOnline' in r && r.waitingOnline))
    await rememberExchange(`${q} (about ${docLabel(a)})`, r.text).catch(() => {});
  return r;
}
