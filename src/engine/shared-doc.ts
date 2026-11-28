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
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { readDeviceFile } from '@/files/device';
import { extOf, fileType } from '@/files/kinds';
import { csvSheet, type Sheet, sheetSummary, sheetText, toCsv } from '@/files/sheet';
import { DESCRIBE_PROMPT, parseDescription } from '@/memory/photo-text';
import { addSharedFile, readPdf } from '@/memory/sources';
import { clipText, type WebSource } from '@/web/lookup-logic';
import { isOnline } from '@/web/lookup';
import { fetchPage } from '@/web/page';
import { siteOf } from '@/web/page-logic';
import { answerStopped, askLlm } from './llm';
import { queueOnline } from './online-queue';
import { getSettings } from './settings';
import type { SharedItem } from './share-in';
import {
  type Attachment,
  clockOf,
  combinePrompt,
  DOC_NOTHING_FOUND,
  usefulNotes,
  DOC_LIMITS,
  DOC_SYSTEM,
  docLabel,
  docParts,
  docPrompt,
  firstUrl,
  labelSpeakers,
  parseRecordingLines,
  partPrompt,
  recordingReadyLine,
  SHEET_SUMMARY_QUESTION,
  TRANSCRIPT_QUESTION,
  transcriptText,
  videoText,
} from './shared-doc-logic';
import { answerSheetQuestion } from './sheet-query';

export type SharedAnswer = {
  text: string;
  ms: number;
  web?: WebSource[];
  waitingOnline?: boolean;
  /** Changes to keep on the attachment (a page read, a video looked at, a column added). */
  update?: Partial<Attachment>;
};

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
      kind: 'file',
      name: item.fileError,
      at,
      error: "I couldn't open that file (it may be too big: up to 400 MB works).",
    };
  if (item.filePath)
    return fileAttachment(item.filePath, item.fileName || 'Shared file', item.mime, at);
  const url = firstUrl(item.text ?? '');
  if (url) return { kind: 'page', name: item.subject?.trim() || siteOf(url), at, url };
  return null;
}

/**
 * A file shared in or attached: read with the file readers (src/files), a PDF with the PDF
 * reader, a recording or video's speech in the background. The copy in the cache is removed once
 * read (a recording's or video's when its speech is read).
 */
export async function fileAttachment(
  path: string,
  name: string,
  mime: string | undefined,
  at: number,
): Promise<Attachment> {
  const guess = fileType(name, mime);
  if (guess === 'audio') return startRecording(path, name, at);
  if (guess === 'video') return startVideo(path, name, at);
  let keepFile = false;
  try {
    const r = await readDeviceFile(path, name, mime);
    const typeLabel = r.label;
    switch (r.kind) {
      case 'media':
        if (r.type === 'audio') {
          keepFile = true;
          return startRecording(path, name, at);
        }
        if (r.type === 'video') {
          keepFile = true;
          return await startVideo(path, name, at);
        }
        if (r.type === 'image') {
          keepFile = true;
          return { kind: 'image', name, at, path, typeLabel };
        }
        {
          const pdf = await readPdf(path);
          if (!pdf.text.trim())
            return { kind: 'pdf', name, at, error: "I couldn't find any text in this PDF." };
          return { kind: 'pdf', name, at, text: pdf.text, partial: !pdf.complete };
        }
      case 'text':
        return {
          kind: 'text',
          name: r.title || name,
          at,
          text: r.text,
          partial: r.truncated,
          typeLabel,
        };
      case 'sheet':
        return {
          kind: 'sheet',
          name,
          at,
          text: r.text,
          partial: r.truncated,
          typeLabel,
          sheets: r.sheets,
          summary: r.summary,
        };
      default:
        return { kind: 'file', name, at, typeLabel, error: r.text };
    }
  } catch (e) {
    console.log(`[share] read failed: ${String(e)}`);
    return { kind: 'file', name, at, error: "I couldn't read that file." };
  } finally {
    // The text is in the chat now; the copy in the cache isn't needed.
    if (!keepFile) SidekickNative.deleteFile(path);
  }
}

/** Files bigger than this aren't copied in (as for shares, PhoneExtras.kt). */
const ATTACH_MAX_BYTES = 400_000_000;

/**
 * The paperclip: the system file picker (any kind of file, on both phones), the file copied into
 * the cache like a share. Null if nothing was picked.
 */
export async function pickAttachment(): Promise<SharedItem | null> {
  const r = await File.pickFileAsync({ mimeTypes: ['*/*'] });
  if (r.canceled || !r.result) return null;
  const picked = r.result;
  const at = Date.now();
  const name = picked.name || 'Attached file';
  if ((picked.size ?? 0) > ATTACH_MAX_BYTES) return { fileError: name, at };
  try {
    const dir = new Directory(Paths.cache, 'attached');
    if (!dir.exists) dir.create({ intermediates: true });
    // Pictures stay for the questions after; anything left from earlier days goes.
    for (const old of dir.list())
      if (old instanceof File && at - (old.modificationTime ?? at) > 2 * 86_400_000) old.delete();
    // A plain name for the copy (the real name travels with it), so its path needs no escaping.
    const ext = extOf(name)
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8);
    const copy = new File(dir, ext ? `${at}.${ext}` : String(at));
    picked.copy(copy);
    return {
      filePath: copy.uri.replace(/^file:\/\//, ''),
      fileName: name,
      mime: picked.type || undefined,
      at,
    };
  } catch (e) {
    console.log(`[attach] copy failed: ${String(e)}`);
    return { fileError: name, at };
  }
}

// --- Videos: a few still pictures, and the speech like a recording ---

/** Still pictures taken from a video (looked at when it is first asked about). */
const VIDEO_FRAMES = 4;
const FRAME_EDGE = 768;

async function startVideo(path: string, name: string, at: number): Promise<Attachment> {
  let frames: { path: string; atMs: number }[] = [];
  try {
    const dir = new Directory(Paths.cache, 'video-frames', `v${at}`).uri.replace(/^file:\/\//, '');
    frames =
      (await SidekickNative.videoFrames?.(path, VIDEO_FRAMES, dir, FRAME_EDGE))?.frames ?? [];
  } catch (e) {
    console.log(`[share] video frames failed: ${String(e)}`);
  }
  const speech = startRecording(path, name, at);
  // Another recording still being read: try again after it.
  if (speech.error && integrationsNative()?.recordingStart) {
    SidekickNative.deleteFile(path);
    frames.forEach((f) => SidekickNative.deleteFile(f.path));
    return { ...speech, kind: 'video' };
  }
  const noSpeech = !speech.recordingId;
  if (noSpeech) SidekickNative.deleteFile(path);
  if (!frames.length && noSpeech)
    return { kind: 'video', name, at, error: "I couldn't read this video on this phone." };
  return {
    kind: 'video',
    name,
    at,
    typeLabel: 'Video',
    frames,
    recordingId: speech.recordingId,
    progress: noSpeech ? 1 : 0,
    noSpeech: noSpeech || undefined,
  };
}

/** What a video's still pictures show (the chat model looks at each; once per video). */
export async function describeFrames(
  frames: { path: string; atMs: number }[],
  onStatus: (line: string) => void,
): Promise<string> {
  const lines: string[] = [];
  for (let i = 0; i < frames.length; i++) {
    onStatus(`Looking at the video (${i + 1} of ${frames.length})…`);
    const f = frames[i];
    const r = await askLlm(DESCRIBE_PROMPT, f.path, () => {}, { maxTokens: 120, scratch: true });
    const d = parseDescription(r.text);
    if (d) lines.push(`[${clockOf(f.atMs)}] ${d}`);
    SidekickNative.deleteFile(f.path);
  }
  return lines.join('\n');
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
    if (!usefulNotes(notes).length && !answerStopped()) {
      answer = DOC_NOTHING_FOUND;
      onText(answer);
    } else {
      onStatus('Writing the answer…');
      answer = (await ask(combinePrompt(question, label, notes), DOC_LIMITS.answerTokens, onText))
        .text;
    }
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
  if (a.kind === 'sheet' && a.sheets?.length)
    return answerSheet(a, a.sheets, q, onText, onStatus, offRecord);
  if (a.kind === 'video') return answerVideo(a, q, onText, onStatus, offRecord);
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

/**
 * A question with a table pasted into it (shared-doc-logic.ts pastedTable): answered like an
 * attached spreadsheet, worked out exactly on the cells.
 */
export function answerPastedTable(
  pasted: { table: string; question: string },
  onText: (full: string) => void,
  onStatus: (line: string) => void,
  offRecord: boolean,
): Promise<SharedAnswer> {
  const sheet = csvSheet(pasted.table, 'Pasted table', false, '\t');
  const a: Attachment = {
    kind: 'sheet',
    name: 'Pasted table',
    at: Date.now(),
    sheets: [sheet],
    text: sheetText([sheet]),
  };
  return answerSheet(a, [sheet], pasted.question || 'Sum it up.', onText, onStatus, offRecord);
}

const remember = async (a: Attachment, q: string, text: string, offRecord: boolean) => {
  if (!offRecord) await rememberExchange(`${q} (about ${docLabel(a)})`, text).catch(() => {});
};

const sheetAsk = async (prompt: string, system: string, maxTokens: number) =>
  (await askLlm(prompt, null, () => {}, { system, maxTokens, scratch: true })).text;

/**
 * A question about a spreadsheet: worked out exactly with a formula (sheet-query.ts) when it is
 * a calculation; otherwise read like a document (its summary, then its cells as text).
 */
async function answerSheet(
  a: Attachment,
  sheets: Sheet[],
  q: string,
  onText: (full: string) => void,
  onStatus: (line: string) => void,
  offRecord: boolean,
): Promise<SharedAnswer> {
  const t0 = Date.now();
  if (q === SHEET_SUMMARY_QUESTION) {
    const text = a.summary ?? sheetSummary(sheets);
    onText(text);
    return { text, ms: 0 };
  }
  onStatus('Working it out…');
  const r = await answerSheetQuestion(q, sheets, 0, sheetAsk);
  if (r.kind === 'read') {
    const text = `${a.summary ?? sheetSummary(sheets)}\n\n${a.text ?? sheetText(sheets)}`;
    const x = await answerFromText(docLabel(a), text, q, onText, onStatus);
    await remember(a, q, x.text, offRecord);
    return x;
  }
  onText(r.text);
  await remember(a, q, r.text, offRecord);
  const update: Partial<Attachment> | undefined =
    r.kind === 'answer' && r.sheets
      ? {
          sheets: r.sheets,
          changed: true,
          summary: sheetSummary(r.sheets),
          text: sheetText(r.sheets),
        }
      : undefined;
  return { text: r.text, ms: Date.now() - t0, update };
}

/** A question about a video: its pictures looked at once, then answered with its speech. */
async function answerVideo(
  a: Attachment,
  q: string,
  onText: (full: string) => void,
  onStatus: (line: string) => void,
  offRecord: boolean,
): Promise<SharedAnswer> {
  if (a.recordingId && !a.text && (a.progress ?? 0) < 1) {
    const st = recordingStatus(a.recordingId);
    const pct = st && st.totalMs ? Math.round((st.doneMs / st.totalMs) * 100) : 0;
    const text = `I'm still listening to the video (${pct}%). Ask again when it's done; I'll say when.`;
    onText(text);
    return { text, ms: 0 };
  }
  if (q === TRANSCRIPT_QUESTION && a.text) {
    onText(a.text);
    return { text: a.text, ms: 0 };
  }
  let frameNotes = a.frameNotes;
  if (frameNotes === undefined && a.frames?.length)
    frameNotes = await describeFrames(a.frames, onStatus);
  const body = videoText({ ...a, frameNotes });
  if (!body.trim()) {
    const text =
      "I couldn't find anything to go on in this video: no speech, and the pictures couldn't be read.";
    onText(text);
    return { text, ms: 0, update: { frameNotes: frameNotes ?? '' } };
  }
  const r = await answerFromText(docLabel(a), body, q, onText, onStatus);
  await remember(a, q, r.text, offRecord);
  return { ...r, update: frameNotes !== a.frameNotes ? { frameNotes, frames: [] } : undefined };
}

/** A spreadsheet with a new column, as a CSV file handed to the share sheet (save or send it). */
export async function shareSheetCsv(a: Attachment): Promise<boolean> {
  const sheet = a.sheets?.[0];
  if (!sheet) return false;
  const base = a.name.replace(/\.[^.]+$/, '') || 'sheet';
  const file = new File(Paths.cache, `${base} (changed).csv`);
  if (file.exists) file.delete();
  file.create();
  file.write(toCsv(sheet));
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: `Save ${base}` });
  return true;
}
