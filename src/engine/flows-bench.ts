/**
 * Dev-only check of the flows that failed on the iPhone (TestFlight, 27 Nov), run in the iOS
 * Simulator by .github/workflows/ios-sim.yml (sidekick://bench?run=flows) or on a phone from the
 * speed-test screen. One `[flows] {json}` line per step, read from the log:
 * - db: the encrypted memory database opens (first run, or over an older build's file);
 * - picture: "Make a picture of a lighthouse at sunset" is answered as a picture request (on the
 *   iPhone: plainly "not on iPhone yet"), never a web search;
 * - photo: "What is this?" with a photo, with each status line and when the first words came.
 * Off the record: nothing is kept. Downloads the chat model and the embedder if missing.
 * `only=db,picture` runs just those steps.
 */
import SidekickNative from '../../modules/sidekick-native';
import { answer } from './assistant';
import { downloadFile, isDownloaded } from './downloads';
import { errorDetailsFor } from './error-details';
import { allRequiredFiles } from './llm-candidates';
import { getDb } from '@/memory/db';

type Log = (line: string) => void;

const line = (log: Log, step: string, data: Record<string, unknown>) =>
  log(`[flows] ${JSON.stringify({ step, ...data })}`);

async function timedAnswer(question: string, photo: string | null) {
  const t0 = Date.now();
  const statuses: { at: number; line: string }[] = [];
  let firstTextMs = 0;
  const r = await answer(
    question,
    photo,
    () => {
      if (!firstTextMs) firstTextMs = Date.now() - t0;
    },
    {
      offTheRecord: true,
      onStatus: (s) => statuses.push({ at: Date.now() - t0, line: s }),
    },
  );
  return {
    ms: Date.now() - t0,
    firstTextMs,
    statuses,
    text: r.text.slice(0, 300),
    web: (r.web ?? []).length,
    webQuery: r.webQuery ?? null,
    webLink: !!r.webLink,
    picture: !!r.picture,
    link: r.link?.href ?? null,
  };
}

export async function runFlowsBench(log: Log, photo: string | null, only?: string): Promise<void> {
  const want = (step: string) => !only || only.split(',').includes(step);
  if (want('db')) {
    try {
      const db = await getDb();
      const r = await db.execute('SELECT count(*) AS n FROM moments');
      line(log, 'db', { ok: true, moments: r.rows[0]?.n ?? 0 });
    } catch (e) {
      line(log, 'db', { ok: false, details: errorDetailsFor('flows db', e) });
    }
  }
  if (!want('picture') && !want('photo')) return;

  const { soc } = SidekickNative.getDeviceInfo();
  for (const f of allRequiredFiles(soc).filter((x) => !isDownloaded(x))) {
    const t0 = Date.now();
    try {
      await downloadFile(f, () => {});
      line(log, 'download', { ok: true, file: f.name, ms: Date.now() - t0 });
    } catch (e) {
      line(log, 'download', { ok: false, file: f.name, details: errorDetailsFor('flows', e) });
    }
  }

  for (const [step, q, p] of [
    ['picture', 'Make a picture of a lighthouse at sunset', null],
    ['photo', 'What is this?', photo],
  ] as const) {
    if (!want(step)) continue;
    if (step === 'photo' && !p) {
      line(log, step, { ok: false, details: 'no test photo' });
      continue;
    }
    try {
      line(log, step, { ok: true, ...(await timedAnswer(q, p)) });
    } catch (e) {
      line(log, step, { ok: false, details: errorDetailsFor(`flows ${step}`, e) });
    }
  }
}
