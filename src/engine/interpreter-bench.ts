/**
 * Dev-only interpreter bench, run by deep link (sidekick://bench?run=interpreter) on a phone set
 * up for testing. Reads what bench/interpreter put in the app's external files folder:
 * `bench-interpreter/cases.jsonl` (the app's own prompts, from prompts.ts) and
 * `bench-interpreter/audio/<lang>/<name>.wav` (made-up speech). One JSON line per case on
 * logcat: `[interp-mt] {...}` (translation / control check) and `[interp-stt] {...}`.
 * Nothing is saved; the folder is deleted by the bench script afterwards.
 */
import { Directory, File } from 'expo-file-system';

import SidekickNative from '../../modules/sidekick-native';
import { interpretLanguage, sttEngine, TURN_MAX_TOKENS } from './interpreter-logic';
import { askLlm } from './llm';

type Log = (line: string) => void;

const root = () => {
  const d = SidekickNative.getDeviceInfo();
  return `${d.externalFilesDir ?? d.filesDir}/bench-interpreter`;
};

export async function runInterpreterBench(log: Log, only?: string) {
  const dir = root();
  if (only !== 'mt') await sttCases(dir, log);
  if (only !== 'stt') await mtCases(dir, log);
}

async function mtCases(dir: string, log: Log) {
  const f = new File(`file://${dir}/cases.jsonl`);
  if (!f.exists) return log('[interp-mt] no cases.jsonl');
  const lines = (await f.text()).split('\n').filter(Boolean);
  for (const line of lines) {
    const c = JSON.parse(line) as Record<string, unknown> & {
      system: string;
      prompt: string;
      maxTokens?: number;
    };
    const t0 = Date.now();
    let first = 0;
    const r = await askLlm(
      c.prompt,
      null,
      () => {
        if (!first) first = Date.now() - t0;
      },
      {
        system: c.system,
        scratch: true,
        maxTokens: c.maxTokens ?? TURN_MAX_TOKENS,
      },
    );
    const { system: _s, prompt: _p, maxTokens: _m, ...rest } = c;
    log(
      `[interp-mt] ${JSON.stringify({ ...rest, reply: r.text, ms: Date.now() - t0, firstMs: first })}`,
    );
  }
}

async function sttCases(dir: string, log: Log) {
  const audio = new Directory(`file://${dir}/audio`);
  if (!audio.exists) return log('[interp-stt] no audio');
  for (const l of audio.list()) {
    if (!(l instanceof Directory)) continue;
    const lang = interpretLanguage(l.name);
    if (!lang) continue;
    const { kind, dir: modelDir } = sttEngine(lang);
    for (const w of l.list()) {
      if (!(w instanceof File) || !w.name.endsWith('.wav')) continue;
      const path = decodeURI(w.uri.replace(/^file:\/\//, ''));
      try {
        const r = await SidekickNative.interpretHeardWav!(path, kind, modelDir, lang.code);
        log(`[interp-stt] ${JSON.stringify({ lang: lang.code, key: w.name, ...r })}`);
      } catch (e) {
        log(`[interp-stt] ${JSON.stringify({ lang: lang.code, key: w.name, error: String(e) })}`);
      }
    }
  }
  await SidekickNative.interpretUnload?.();
}
