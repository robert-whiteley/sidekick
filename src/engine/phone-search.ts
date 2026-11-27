/**
 * The find_on_phone tool: finds a photo or file the user allowed (Settings → Phone search) and
 * answers from it. "Find my latest invoice from Acme and tell me the cost": the files and photos
 * that match by meaning and by words are listed (newest first when the newest is wanted), the
 * model picks the one the request means, then answers from its whole text (the amounts in it
 * are listed exactly). The found photo is shown in the chat; Open shows the original.
 */
import { Platform } from 'react-native';

import { getSettings } from './settings';
import { askLlm } from './llm';
import { SYSTEM_PROMPT } from './prompts';
import { getDb, vecParam } from '@/memory/db';
import { queryVector, readRecentNow, searchPhotos, shownCopy } from '@/memory/gallery';
import { embedPending } from '@/memory/store';
import {
  answerPrompt,
  fileKeyOf,
  fileBody,
  fileUriOf,
  type Found,
  inRange,
  orderFound,
  parsePick,
  PICK_SYSTEM,
  pickPrompt,
  splitFileText,
} from '@/memory/gallery-logic';
import { ftsQuery, fuseRankings } from '@/memory/search-logic';

export type FindRequest = {
  what: string;
  type: 'photo' | 'file' | 'any';
  newest: boolean;
  from?: number;
  to?: number;
};

export type FindResult = {
  text: string;
  ms: number;
  /** The found photo's chat copy. */
  photoPath?: string;
  link?: { label: string; href: string; open?: string };
};

const SETTINGS = '/settings/phone-search';

/** Whether anything is allowed for phone search at all. */
export function phoneSearchOn(): boolean {
  const s = getSettings();
  return s.sourceGallery || (s.sourceFolders && (s.folderUris.length > 0 || s.fileUris.length > 0));
}

/** Picked files whose passages match [query], best first, one entry per file. */
async function searchFiles(
  query: string,
  queryVec: number[] | null,
  opts: { from?: number; to?: number; k: number },
): Promise<Found[]> {
  const d = await getDb();
  const lists: number[][] = [];
  if (queryVec) {
    // Files are a small part of memory: a wide search, then only file passages.
    const r = await d.execute(
      `SELECT v.id AS id FROM (SELECT id, distance FROM moments_vec WHERE embedding MATCH ? AND k = 400) v
       JOIN moments m ON m.id = v.id WHERE m.kind = 'file' ORDER BY v.distance`,
      [vecParam(queryVec)],
    );
    lists.push(r.rows.map((x) => x.id as number));
  }
  const fq = ftsQuery(query);
  if (fq) {
    const r = await d.execute(
      `SELECT f.rowid AS id FROM moments_fts f JOIN moments m ON m.id = f.rowid
       WHERE moments_fts MATCH ? AND m.kind = 'file' ORDER BY rank LIMIT 200`,
      [fq],
    );
    lists.push(r.rows.map((x) => x.id as number));
  }
  const ids = fuseRankings(lists);
  if (!ids.length) return [];
  const r = await d.execute(
    `SELECT id, at, text, source_key FROM moments WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  const byId = new Map(r.rows.map((x) => [x.id as number, x]));
  const out: Found[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const x = byId.get(id);
    const fileKey = x ? fileKeyOf((x.source_key as string | null) ?? '') : null;
    if (!x || !fileKey || seen.has(fileKey)) continue;
    seen.add(fileKey);
    const { path, body } = splitFileText(x.text as string);
    out.push({
      kind: 'file',
      ref: fileUriOf(fileKey),
      title: path || 'a file',
      at: x.at as number,
      excerpt: body,
      fileKey,
    });
  }
  return inRange(out, opts.from, opts.to).slice(0, opts.k);
}

/** Every passage of one file, for the answer. */
async function wholeFile(fileKey: string): Promise<string> {
  const d = await getDb();
  const r = await d.execute(
    'SELECT text, source_key FROM moments WHERE source_key IS NOT NULL AND substr(source_key, 1, ?) = ?',
    [fileKey.length, fileKey],
  );
  return fileBody(
    r.rows.map((x) => ({
      n: Number(String(x.source_key).slice(fileKey.length)) || 0,
      text: x.text as string,
    })),
  );
}

const ask = async (prompt: string, system: string, maxTokens: number) =>
  (await askLlm(prompt, null, () => {}, { system, maxTokens, scratch: true })).text;

/** Runs one phone search and writes the answer (streamed to [onText]). */
export async function findOnPhone(
  question: string,
  req: FindRequest,
  onText: (full: string) => void,
  status: (line: string) => void,
): Promise<FindResult> {
  const t0 = Date.now();
  const say = (text: string, link?: FindResult['link']): FindResult => {
    onText(text);
    return { text, ms: Date.now() - t0, link };
  };
  if (!phoneSearchOn())
    return say(
      'Phone search is off. Choose which photos and folders I may search, then ask again.',
      {
        label: 'Open Phone search',
        href: SETTINGS,
      },
    );
  status('Searching your phone…');
  const what = req.what.trim() || question;
  const range = { from: req.from, to: req.to };
  // New since the last idle tick: today's photos are listed and read now (a few seconds at most),
  // and file passages still waiting for a vector get one (~0.3 s each), so nothing recent is missed.
  if (req.type !== 'file')
    await readRecentNow({
      ...range,
      onProgress: (n) => status(`Reading ${n === 1 ? 'a new photo' : `${n} new photos`}…`),
    }).catch((e) => console.log(`[phone-search] recent photos: ${String(e)}`));
  if (req.type !== 'photo')
    await embedPending(16, { photos: false }).catch((e) =>
      console.log(`[phone-search] file vectors: ${String(e)}`),
    );
  const queryVec = await queryVector(what);
  // Only what the user allowed is in the index: photos (library or picked folders) and files.
  const k = 8;
  const [photos, files] = await Promise.all([
    req.type !== 'file'
      ? searchPhotos(what, { ...range, k, queryVec }).catch(() => [])
      : Promise.resolve([]),
    req.type !== 'photo'
      ? searchFiles(what, queryVec, { ...range, k }).catch(() => [])
      : Promise.resolve([]),
  ]);
  const photoFound: Found[] = photos.map((p) => ({
    kind: 'photo',
    ref: p.key,
    title: p.name,
    at: p.at,
    place: p.place,
    excerpt: p.text,
  }));
  // Both lists are best first: interleave so neither crowds the other out.
  const mixed: Found[] = [];
  for (let i = 0; i < Math.max(photoFound.length, files.length); i++) {
    if (files[i]) mixed.push(files[i]);
    if (photoFound[i]) mixed.push(photoFound[i]);
  }
  const found = orderFound(mixed, req.newest, k);
  console.log(`[phone-search] ${photos.length} photos, ${files.length} files`);
  if (!found.length)
    return say("I couldn't find that on your phone. It may not be in what I'm allowed to search.", {
      label: 'Open Phone search',
      href: SETTINGS,
    });
  let i = 0;
  if (found.length > 1) {
    status('Choosing…');
    i = parsePick(await ask(pickPrompt(question, found, req.newest), PICK_SYSTEM, 8), found.length);
    if (i < 0) return say("I couldn't find that on your phone.");
  }
  const f = found[i];
  status(f.kind === 'photo' ? 'Reading the photo…' : 'Reading the file…');
  const photoPath = f.kind === 'photo' ? ((await shownCopy(f.ref)) ?? undefined) : undefined;
  if (f.kind === 'photo' && !photoPath) return say('That photo is no longer on your phone.');
  const body = f.kind === 'file' && f.fileKey ? await wholeFile(f.fileKey) : f.excerpt;
  // Little text read from the photo: the model looks at the photo itself.
  const image = f.kind === 'photo' && body.trim().length < 40 ? (photoPath ?? null) : null;
  const { text } = await askLlm(answerPrompt(question, f, body), image, onText, {
    system: SYSTEM_PROMPT,
    maxTokens: 200,
    scratch: true,
  });
  // Android opens the original in the phone's own app; the iPhone shows the photo in the chat.
  const open =
    Platform.OS === 'android'
      ? {
          label: f.kind === 'photo' ? 'Open the photo' : 'Open the file',
          href: SETTINGS,
          open: f.ref,
        }
      : undefined;
  return { text, ms: Date.now() - t0, photoPath, link: open };
}
