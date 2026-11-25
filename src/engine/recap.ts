/**
 * Recaps when asked, over any range or topic: "recap the last 2 hours", "what did we talk about
 * last Tuesday", "summarise yesterday afternoon", "recap what we've been working on" (the stretch
 * of related activity ending now, found by meaning and time gaps). Replaces the fixed evening
 * "Your day" line: a user who wants one every evening asks for it as a routine.
 */
import SidekickNative from '../../modules/sidekick-native';
import { isDownloaded, modelPath } from './downloads';
import { askLlm } from './llm';
import { EMBEDDER_FILE } from './models';
import { SYSTEM_PROMPT } from './prompts';
import { NOTE_KIND } from '@/memory/conversation-notes';
import { EMBED_DIMS, getDb, vecParam } from '@/memory/db';
import { listFollowups } from '@/memory/followups';
import {
  distinctPlaces,
  findStretch,
  type RecapLine,
  recapPrompt,
  type RecapRequest,
  recapRequest,
  relatedIds,
  spanLabel,
  STRETCH_GAP_MS,
  STRETCH_MAX_MS,
  TOPIC_GAP_MS,
  TOPIC_MAX_MS,
} from '@/memory/recap-logic';
import { embedQuery } from '@/memory/search-logic';

const DAY = 86_400_000;
/** Rows read for one recap at most (spread evenly over the range). */
const MAX_ROWS = 600;
const RECAP_KINDS = `'speech', 'question', 'answer', 'note', 'photo', 'frame', '${NOTE_KIND}'`;

type Row = { id: number; at: number; kind: string; text: string; who: string };

/** Moments in [from, to), at most [MAX_ROWS], spread evenly over the range, oldest first. */
async function rowsBetween(from: number, to: number): Promise<Row[]> {
  const db = await getDb();
  const n =
    ((
      await db.execute(
        `SELECT COUNT(*) AS n FROM moments WHERE at >= ? AND at < ? AND kind IN (${RECAP_KINDS}) AND length(text) > 0`,
        [from, to],
      )
    ).rows[0]?.n as number | undefined) ?? 0;
  const step = Math.max(1, Math.ceil(n / MAX_ROWS));
  const r = await db.execute(
    `SELECT * FROM (
       SELECT m.id, m.at, m.kind, m.text, s.is_owner,
              COALESCE(s.name, s.description, 'Person ' || s.label_no) AS name,
              ROW_NUMBER() OVER (ORDER BY m.at) AS rn
       FROM moments m LEFT JOIN speakers s ON s.id = m.speaker_id
       WHERE m.at >= ? AND m.at < ? AND m.kind IN (${RECAP_KINDS}) AND length(m.text) > 0
     ) WHERE kind = '${NOTE_KIND}' OR (rn - 1) % ? = 0 ORDER BY at`,
    [from, to, step],
  );
  return r.rows.map((x) => ({
    id: x.id as number,
    at: x.at as number,
    kind: x.kind as string,
    text: x.text as string,
    who:
      x.kind === 'speech'
        ? x.is_owner === 1
          ? 'Me'
          : ((x.name as string | null) ?? 'Someone')
        : x.kind === 'question' || x.kind === 'answer'
          ? 'Q/A'
          : (x.kind as string),
  }));
}

/** Cosine distances of the nearest memories to [text] (empty if the embedder isn't there). */
async function nearest(text: string, k = 300): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!text.trim() || !isDownloaded(EMBEDDER_FILE)) return out;
  try {
    const [qv] = await SidekickNative.embed(
      modelPath(EMBEDDER_FILE),
      [embedQuery(text.slice(0, 600))],
      EMBED_DIMS,
    );
    const db = await getDb();
    const r = await db.execute(
      'SELECT id, distance FROM moments_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance',
      [vecParam(qv), k],
    );
    for (const x of r.rows) out.set(x.id as number, x.distance as number);
  } catch (e) {
    console.log(`[recap] vector search failed: ${String(e)}`);
  }
  return out;
}

/** Words of the topic in a moment (when there are no vectors). */
const mentions = (text: string, topic: string) => {
  const words = topic
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2);
  const t = text.toLowerCase();
  return words.length > 0 && words.some((w) => t.includes(w));
};

/** When the owner's day started: the first thing kept today after 04:00. */
async function wakeAt(now: number): Promise<number | null> {
  const d = new Date(now);
  d.setHours(4, 0, 0, 0);
  const db = await getDb();
  const r = await db.execute('SELECT MIN(at) AS at FROM moments WHERE at >= ? AND at <= ?', [
    d.getTime(),
    now,
  ]);
  return (r.rows[0]?.at as number | null) ?? null;
}

type Span = { from: number; to: number; label: string; related: Set<number> | null };

/** Which stretch of time (and which moments in it) the recap covers. */
async function resolveSpan(req: RecapRequest, now: number): Promise<Span | null> {
  if (req.range) {
    const span = { from: req.range.from, to: Math.min(req.range.to, now), label: req.range.label };
    if (!req.topic) return { ...span, related: null };
    const near = await nearest(req.topic);
    const rows = await rowsBetween(span.from, span.to);
    const ids = new Set(rows.map((r) => r.id));
    const rel = near.size
      ? relatedIds(new Map([...near].filter(([id]) => ids.has(id))))
      : new Set(rows.filter((r) => mentions(r.text, req.topic!)).map((r) => r.id));
    return { ...span, related: rel };
  }
  if (!req.stretch) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: now, label: 'today', related: null };
  }
  const maxMs = req.topic ? TOPIC_MAX_MS : STRETCH_MAX_MS;
  const rows = await rowsBetween(now - maxMs, now + 1);
  if (!rows.length) return null;
  // No topic: "what we've been working on" is whatever the latest activity is about.
  const query =
    req.topic ??
    rows
      .filter((r) => r.kind !== NOTE_KIND)
      .slice(-8)
      .map((r) => r.text)
      .join(' ');
  const near = await nearest(query);
  const latest = rows[rows.length - 1].at;
  const ids = new Set(rows.map((r) => r.id));
  const rel = near.size ? relatedIds(new Map([...near].filter(([id]) => ids.has(id)))) : null;
  const items = rows.map((r) => ({
    at: r.at,
    related: rel
      ? rel.has(r.id) || (!req.topic && latest - r.at < 10 * 60_000)
      : req.topic
        ? mentions(r.text, req.topic)
        : true,
  }));
  const found = findStretch(items, {
    gapMs: req.topic ? TOPIC_GAP_MS : STRETCH_GAP_MS,
    maxMs,
  });
  if (!found) return null;
  return {
    from: found.from,
    // A topic's stretch ends at its last related moment; "what we've been doing" runs to now.
    to: req.topic ? found.to + 1 : now + 1,
    label: spanLabel(found.from, found.to, now),
    related: req.topic ? new Set(rows.filter((_, i) => items[i].related).map((r) => r.id)) : null,
  };
}

export type RecapAnswer = { text: string; ms: number; local: boolean };

/**
 * Answers a recap question, or returns null if [question] isn't one. The answer starts with the
 * span covered ("Since 14:10: …") so the user knows where it started.
 */
export async function answerRecap(
  question: string,
  onText: (full: string) => void,
  now = Date.now(),
): Promise<RecapAnswer | null> {
  const wake = /\b(got up|woke)\b/i.test(question) ? await wakeAt(now) : null;
  const req = recapRequest(question, new Date(now), { wakeAt: wake });
  if (!req) return null;
  const span = await resolveSpan(req, now);
  const about = req.topic ? ` about ${req.topic}` : '';
  if (!span) {
    const text = `I couldn't find anything${about} to recap.`;
    onText(text);
    return { text, ms: 0, local: true };
  }
  const rows = await rowsBetween(span.from, span.to);
  const keep = (r: Row, i: number) => {
    if (!span.related) return true;
    // A related moment and its neighbours (the question before an answer, the reply after).
    return [rows[i - 1], r, rows[i + 1]].some((x) => x && span.related!.has(x.id));
  };
  const kept = rows.filter(keep);
  const notes = kept.filter((r) => r.kind === NOTE_KIND).map((r) => ({ at: r.at, text: r.text }));
  const lines: RecapLine[] = kept
    .filter((r) => ['speech', 'question', 'answer', 'note'].includes(r.kind))
    .map((r) => ({ at: r.at, who: r.who, text: r.text }));
  const seen: string[] = [];
  for (const r of kept.filter((x) => x.kind === 'photo' || x.kind === 'frame').reverse()) {
    const t = r.text.replace(/^Q:[\s\S]*?\nA:\s*/, '').slice(0, 160);
    if (t && !seen.includes(t)) seen.push(t);
    if (seen.length >= 5) break;
  }
  const db = await getDb();
  const places = distinctPlaces(
    (
      await db.execute(
        'SELECT place FROM moments WHERE at >= ? AND at < ? AND place IS NOT NULL ORDER BY at LIMIT 500',
        [span.from, span.to],
      )
    ).rows.map((r) => r.place as string),
  );
  const todos = req.topic ? [] : await listFollowups().catch(() => []);
  const inSpan = (t: number | null) => t != null && t >= span.from && t < span.to;
  const done = todos.filter((f) => f.status === 'done' && inSpan(f.dueAt)).map((f) => f.title);
  const due =
    span.to >= now - 60_000
      ? todos
          .filter((f) => f.status === 'approved' && f.dueAt != null && f.dueAt < now + DAY)
          .map((f) => f.title)
      : [];
  const prompt = recapPrompt(span.label, req.topic, span, notes, lines, {
    places,
    seen,
    done: done.slice(0, 10),
    due: due.slice(0, 10),
  });
  if (!prompt) {
    const text = `I don't have anything${about} from ${span.label}.`;
    onText(text);
    return { text, ms: 0, local: true };
  }
  // Say the span found when it wasn't named ("Since 14:10: …").
  const head = !req.stretch
    ? ''
    : `${span.label.charAt(0).toUpperCase()}${span.label.slice(1)}${about}: `;
  onText(head);
  const t0 = Date.now();
  const { text } = await askLlm(prompt, null, (t) => onText(head + t), {
    system: SYSTEM_PROMPT,
    maxTokens: 400,
    scratch: true,
  });
  return { text: head + text, ms: Date.now() - t0, local: false };
}
