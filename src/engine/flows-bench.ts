/**
 * Dev-only check of the flows that failed on the iPhone (TestFlight, 27 Nov), run in the iOS
 * Simulator by .github/workflows/ios-sim.yml (launch argument -benchRun run=flows) or on a phone from the
 * speed-test screen. One `[flows] {json}` line per step, read from the log:
 * - db: the encrypted memory database opens (first run, or over an older build's file);
 * - picture: "Make a picture of a lighthouse at sunset" is answered as a picture request (on the
 *   iPhone: plainly "not on iPhone yet"), never a web search;
 * - photo: "What is this?" with a photo, with each status line and when the first words came;
 * - models: chat-model loads, unloads and memory vectors all at once (each change waits its turn
 *   natively, so this must finish without errors).
 * Off the record: nothing is kept. Downloads the chat model and the embedder if missing.
 * `only=db,picture` runs just those steps.
 *
 * Only when asked for by name (`only=heard`, scripts/android-emu.sh): a made-up heard line with a
 * recording (`sk-test/sk-test-heard.wav` in the app's external files folder, put there by adb),
 * so the chat can be asked about it and must show that recording's play button. Bench data:
 * `run=recall-clear` removes it and its recording.
 */
import SidekickNative from '../../modules/sidekick-native';
import { answer } from './assistant';
import { downloadFile, isDownloaded, modelPath } from './downloads';
import { errorDetailsFor } from './error-details';
import { allRequiredFiles } from './llm-candidates';
import { ensureLlm } from './llm';
import { EMBEDDER_FILE } from './models';
import { dataDir } from './paths';
import { addBenchRows } from '@/memory/bench-data';
import { EMBED_DIMS, getDb } from '@/memory/db';

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

/** Loads, unloads and vectors at once; each call's outcome, and what is loaded afterwards. */
async function modelsAtOnce() {
  const t0 = Date.now();
  const vec = () =>
    SidekickNative.embed(modelPath(EMBEDDER_FILE), ['where did I leave my keys'], EMBED_DIMS);
  const calls: [string, () => Promise<unknown>][] = [
    ['llm', () => ensureLlm()],
    ['vec', vec],
    ['vec', vec],
    ['llm-unload', () => SidekickNative.llmUnload()],
    ['embed-unload', () => SidekickNative.embedUnload()],
    ['llm', () => ensureLlm()],
    ['vec', vec],
  ];
  const settled = await Promise.allSettled(calls.map(([, run]) => run()));
  return {
    ms: Date.now() - t0,
    failed: settled.flatMap((r, i) =>
      r.status === 'rejected' ? [`${calls[i][0]}: ${String(r.reason).slice(0, 120)}`] : [],
    ),
    alone: SidekickNative.modelsMustBeAlone?.() ?? null,
    llmLoaded: SidekickNative.llmIsLoaded(),
  };
}

/** The made-up heard line with its recording (bench data, removed by recall-clear). */
async function addHeardLine() {
  const d = SidekickNative.getDeviceInfo();
  const src = `${d.externalFilesDir ?? d.filesDir}/sk-test/sk-test-heard.wav`;
  if (!SidekickNative.fileExists(src)) throw new Error('no sk-test-heard.wav');
  const audioPath = `${dataDir()}/bench-heard-${Date.now()}.wav`;
  if (!SidekickNative.copyFile(src, audioPath)) throw new Error('could not copy the recording');
  const text = 'Tom said the plumber is coming on Tuesday at nine to fix the boiler.';
  await addBenchRows([
    { key: 'heard-plumber', kind: 'speech', at: Date.now() - 60 * 60_000, text, audioPath },
  ]);
  return { audioPath, text };
}

export async function runFlowsBench(log: Log, photo: string | null, only?: string): Promise<void> {
  const want = (step: string) => !only || only.split(',').includes(step);
  if (only?.split(',').includes('heard')) {
    try {
      line(log, 'heard', { ok: true, ...(await addHeardLine()) });
    } catch (e) {
      line(log, 'heard', { ok: false, details: errorDetailsFor('flows heard', e) });
    }
  }
  if (want('db')) {
    try {
      const db = await getDb();
      const r = await db.execute('SELECT count(*) AS n FROM moments');
      line(log, 'db', { ok: true, moments: r.rows[0]?.n ?? 0 });
    } catch (e) {
      line(log, 'db', { ok: false, details: errorDetailsFor('flows db', e) });
    }
  }
  if (!want('picture') && !want('photo') && !want('models')) return;

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

  if (want('models')) {
    try {
      const r = await modelsAtOnce();
      line(log, 'models', { ok: r.failed.length === 0, ...r });
    } catch (e) {
      line(log, 'models', { ok: false, details: errorDetailsFor('flows models', e) });
    }
  }
}
