// ui-exception-file: developer speed-test screen (Advanced › Speed test), not part of the product UI
import { runFactsBench } from '@/engine/facts-bench';
import { Asset } from 'expo-asset';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';

import SidekickNative, {
  type LlmBackend,
  type LlmStats,
  type LlmTuning,
} from '../../modules/sidekick-native';
import { GEMMA_GENERIC } from '@/engine/llm-candidates';
import {
  ensureLlm,
  holdBackground,
  releaseBackground,
  resetBackendChoice,
  setLlmTuning,
  unloadLlm,
} from '@/engine/llm';
import { dataDir, modelsDir as modelsDirFn } from '@/engine/paths';
import { downloadFile, modelPath } from '@/engine/downloads';
import { EMBEDDER_FILE, MODEL_FILES, type ModelFile } from '@/engine/models';
import { callIfExists, speedLine, wavSeconds, type SpeedResult } from '@/engine/bench-logic';
import {
  clearRecallData,
  loadRecallData,
  runAnswersBench,
  runRecallBench,
  runRecallSearchOnly,
} from '@/engine/answers-bench';
import { runInterpreterBench } from '@/engine/interpreter-bench';
import { runPhotoEditBench } from '@/engine/photo-edit-bench';
import { runPictureBench } from '@/engine/picture-bench';
import { runResearchBench } from '@/engine/research-bench';
import { EMBED_DIMS } from '@/memory/db';
import { cosine } from '@/memory/voices';
import { runBackgroundBench, runDecideBench, runThinkingBench } from '@/engine/decide-bench';

/** The speed-test photo, bundled with the app (no download). */
async function benchPhoto(): Promise<string | null> {
  const a = await Asset.fromModule(require('../../assets/bench/test.jpg')).downloadAsync();
  return a.localUri?.replace(/^file:\/\//, '') ?? null;
}

const MOONSHINE_WAVS = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/test_wavs';
const KWS_WAVS = 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01/test_wavs';

const TEXT_PROMPT = 'In three sentences, explain why the sky is blue.';
const PHOTO_PROMPT = 'What is in this photo? Answer in two sentences.';

// Native setters other code may add; the speed run uses whichever exists at run time.
// Chat-model settings the speed run compares (library defaults first).
const LLM_TUNINGS: [string, LlmTuning][] = [
  ['default', {}],
  ['t2', { threads: 2 }],
  ['t4', { threads: 4 }],
  ['t6', { threads: 6 }],
  ['vis140', { visualTokenBudget: 140 }],
  ['vis70', { visualTokenBudget: 70 }],
  ['spec', { speculative: 'adaptive' }],
];
const STT_THREAD_SETTERS = ['speechSetAsrThreads'];

const hasAny = (names: string[]) =>
  names.some(
    (n) => typeof (SidekickNative as unknown as Record<string, unknown>)[n] === 'function',
  );

const EMBED_SAMPLES = [
  'My locker code at the gym is 4471.',
  'Anna said the train to Leeds leaves at half past four.',
  'The spare house key is under the blue flower pot.',
  'Dentist appointment on Thursday at 10 in the morning.',
  'Tom prefers his coffee black with no sugar.',
  'The Wi-Fi password at the cottage is written on the fridge.',
  'We parked on level 3, near the lifts, bay 42.',
  'Mum is allergic to penicillin.',
  'The plumber is coming next Tuesday between 8 and 12.',
  'I lent my ladder to the neighbour at number 12.',
  'The meeting with Priya moved to Friday afternoon.',
  'The car needs its MOT before the end of March.',
  'Sam recommended the Thai place on Market Street.',
  'Bin day is Wednesday; recycling every other week.',
  'My passport expires in June next year.',
  'The boiler reset button is on the left underneath.',
  'Grandma’s birthday is the 14th of August.',
  'The kids’ school finishes at 3:15 on Fridays.',
  'I put the warranty for the washing machine in the blue folder.',
  'Remember to water the tomatoes every second day.',
];

/** Developer screen: loads Gemma on each backend and reports real speeds on this phone. */
export default function BenchScreen() {
  const device = SidekickNative.getDeviceInfo();
  const modelsDir = modelsDirFn();
  const [log, setLog] = useState<string[]>([]);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const reqId = useRef('');
  const answerRef = useRef('');

  const add = (line: string) => {
    console.log(`[bench] ${line}`);
    setLog((l) => [...l, line]);
  };

  useEffect(() => {
    const sub = SidekickNative.addListener('onLlmText', (e) => {
      if (e.requestId !== reqId.current) return;
      answerRef.current += e.text;
      setAnswer(answerRef.current);
    });
    return () => sub.remove();
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      add(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Answers, routing and recall bench (src/engine/answers-bench.ts): JSON lines on logcat.
  // Started by deep link too: sidekick://bench?run=answers|recall-load|recall|recall-search|
  // recall-clear|facts|research|photo-edit|decide|thinking|background [&only=<id prefixes>]
  // [&size=<rows>] [&variant=<decide variant or thinking budget>] (src/engine/decide-bench.ts).
  const quiet = (line: string) => {
    console.log(line);
    setLog((l) => [...l.slice(-40), line.slice(0, 200)]);
  };
  const bench = (what: string, only?: string, size?: number, variant?: string) =>
    run(what, async () => {
      if (what === 'answers') await runAnswersBench(quiet, only);
      else if (what === 'decide') await runDecideBench(quiet, variant ?? 'fused', only);
      else if (what === 'thinking') await runThinkingBench(quiet, variant ?? 'default', only);
      else if (what === 'background')
        await runBackgroundBench(
          quiet,
          variant ?? 'default',
          `${device.externalFilesDir ?? device.filesDir}/bench-photos`,
          only,
        );
      else if (what === 'recall-load') await loadRecallData(size ?? 100, quiet);
      else if (what === 'recall') await runRecallBench(quiet, only);
      else if (what === 'recall-search') await runRecallSearchOnly(quiet);
      else if (what === 'recall-clear') await clearRecallData(quiet);
      else if (what === 'research') await runResearchBench(quiet, only);
      else if (what === 'picture')
        await runPictureBench(quiet, device.externalFilesDir ?? device.filesDir);
      else if (what === 'photo-edit')
        await runPhotoEditBench(quiet, device.externalFilesDir ?? device.filesDir);
      else if (what === 'facts') await runFactsBench(quiet);
      else if (what === 'interpreter') await runInterpreterBench(quiet, only);
      quiet(`[bench] ${what} done`);
    });
  const params = useLocalSearchParams<{
    run?: string;
    only?: string;
    size?: string;
    t?: string;
    variant?: string;
  }>();
  useEffect(() => {
    // Links run only on a phone set up for testing: a `bench-links` file in the app's external
    // files folder, which only adb or the app itself can write (any app can open a link).
    const flag = `${device.externalFilesDir ?? device.filesDir}/bench-links`;
    if (!params.run || !SidekickNative.fileExists(flag)) return;
    const what = params.run;
    const t = setTimeout(
      () =>
        void bench(
          what,
          params.only,
          params.size ? Number(params.size) : undefined,
          params.variant,
        ),
      500,
    );
    return () => clearTimeout(t);
    // A new `t` re-runs the same request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.run, params.only, params.size, params.t, params.variant]);

  const download = (files: ModelFile[]) =>
    run('download', async () => {
      for (const f of files) {
        await downloadFile(f, (t) => setProgress(`${f.name}: ${t}`));
        setProgress('');
        add(`${f.name}: downloaded and verified`);
      }
    });

  // Speech checks: transcribe the models' own sample recordings, then play one out of the speaker
  // while holding the mic open (tests the real microphone path).
  const speechTest = () =>
    run('speech', async () => {
      for (const dir of [MOONSHINE_WAVS, KWS_WAVS]) {
        for (const n of [0, 1, 2]) {
          const wav = `${modelsDir}/${dir}/${n}.wav`;
          if (!SidekickNative.fileExists(wav)) continue;
          const t0 = Date.now();
          const r = await SidekickNative.debugTranscribe(wav);
          add(`${dir.split('-')[2]} ${n}.wav (${Date.now() - t0} ms, wake ${r.wake}): ${r.text}`);
        }
      }
    });

  // Makes a "Hey Sidekick …" recording with the phone's voice, checks it offline, then (Play)
  // sends it out of the speaker so the live listener hears it like a person.
  const wakeWav = () => `${dataDir()}/wake-test.wav`;
  const wakeTest = () =>
    run('wake', async () => {
      await SidekickNative.debugSay('Hey Sidekick, what is my locker code?', wakeWav());
      const r = await SidekickNative.debugTranscribe(wakeWav());
      add(`wake test (wake ${r.wake}): ${r.text}`);
    });
  const playWake = () =>
    run('play', async () => {
      await SidekickNative.debugPlay(wakeWav());
      add('played wake phrase');
    });

  // Plays the wake phrase after 10 s, so there is time to leave the app (background answer test).
  const playWakeLater = () => {
    SidekickNative.debugPlay(wakeWav(), 10_000).then(
      () => console.log('[bench] played wake phrase (delayed)'),
      (e) => console.log(`[bench] delayed play failed: ${String(e)}`),
    );
    add('wake phrase plays in 10 s');
  };

  // A short conversation with different phone voices: the owner asks for consent, a second voice
  // agrees and says something; a third voice never agreed, so consent mode must drop it.
  const conversationTest = () =>
    run('conversation', async () => {
      const lines: [string, number | null][] = [
        ['Is it okay if I record this conversation?', null],
        ['Sure, that is fine.', 3],
        ['My train to Leeds leaves at half past four.', 3],
        ['The secret password for the shed is banana.', 7],
      ];
      for (let i = 0; i < lines.length; i++) {
        const [text, voice] = lines[i];
        const wav = `${dataDir()}/talk-${i}.wav`;
        await SidekickNative.debugSay(text, wav, voice);
        await SidekickNative.debugPlay(wav);
        await new Promise((r) => setTimeout(r, 2500));
      }
      add('conversation played');
    });

  // How far apart the phone's voices are to the voiceprint model, on clean audio: same voice
  // short vs long line, and long lines across voices.
  const voiceTest = () =>
    run('voices', async () => {
      const names = await SidekickNative.debugVoices();
      add(`${names.length} voices: ${names.slice(0, 10).join(', ')}`);
      const picks = [null, 3, 7, 1];
      const prints: { v: string; kind: string; p: number[] }[] = [];
      for (const v of picks) {
        for (const [kind, text] of [
          ['short', 'Sure, that is fine.'],
          ['long', 'My train to Leeds leaves at half past four tomorrow afternoon.'],
        ]) {
          const wav = `${dataDir()}/voice-${v}-${kind}.wav`;
          await SidekickNative.debugSay(text, wav, v);
          const p = await SidekickNative.debugVoiceprint(wav);
          if (p) prints.push({ v: String(v), kind, p });
        }
      }
      for (let i = 0; i < prints.length; i++) {
        const row = prints.map((b) => cosine(prints[i].p, b.p).toFixed(2)).join(' ');
        add(`${prints[i].v}/${prints[i].kind}: ${row}`);
      }
    });

  const micTest = () =>
    run('mic', async () => {
      const wav = `${modelsDir}/${MOONSHINE_WAVS}/0.wav`;
      SidekickNative.pttStart();
      await SidekickNative.debugPlay(wav);
      await new Promise((r) => setTimeout(r, 1500));
      const r = await SidekickNative.pttStop();
      add(`mic heard: ${r.text}`);
    });

  // One back-to-back run of everything that matters for speed, one `[speed] {json}` line each.
  // The chat model and the embedder are never loaded at the same time.
  // The speed run calls the model directly, outside the app's queue: background passes (photo
  // captions, facts) are held off so they don't cancel its questions mid-answer.
  const speedRun = () =>
    run('speed', async () => {
      holdBackground();
      try {
        await speedRunInner();
      } finally {
        releaseBackground();
      }
    });
  const speedRunInner = () =>
    (async () => {
      const emit = (r: SpeedResult) => {
        const line = speedLine(r);
        console.log(line);
        setLog((l) => [...l, line]);
      };
      const fail = (test: string, variant: string, e: unknown) =>
        emit({ test, variant, ms: 0, ok: false, text: e instanceof Error ? e.message : String(e) });
      const ask = async (test: string, variant: string, image: string | null) => {
        reqId.current = `speed-${Date.now()}`;
        answerRef.current = '';
        const t0 = Date.now();
        try {
          const s = await SidekickNative.llmGenerate(
            reqId.current,
            image ? PHOTO_PROMPT : TEXT_PROMPT,
            image,
          );
          emit({
            test,
            variant,
            ms: Date.now() - t0,
            firstTokenMs: s.ttftMs,
            decodeTokens: s.decodeTokens,
            decodeTokPerSec: Number(s.decodeTokensPerSec.toFixed(2)),
            ok: true,
            text: answerRef.current,
          });
        } catch (e) {
          fail(test, variant, e);
        }
      };

      // 1. Chat model: text and photo questions under each tuning.
      await SidekickNative.embedUnload();
      const photo = await benchPhoto();
      const hasPhoto = !!photo && SidekickNative.fileExists(photo);
      if (!hasPhoto) fail('photo', '', 'test.jpg missing');
      for (const [name, tuning] of LLM_TUNINGS) {
        await unloadLlm();
        setLlmTuning(tuning);
        const l0 = Date.now();
        try {
          const r = await ensureLlm();
          emit({
            test: 'llm_load',
            variant: `${name} ${r.backend}`,
            ms: Date.now() - l0,
            ok: true,
            text: '',
          });
        } catch (e) {
          fail('llm_load', name, e);
          continue;
        }
        for (let i = 0; i < 2; i++) await ask('text', `${name} q${i + 1}`, null);
        if (hasPhoto) for (let i = 0; i < 2; i++) await ask('photo', `${name} q${i + 1}`, photo);
      }
      setLlmTuning({});
      await unloadLlm();

      // 2. Speech to text on the Parakeet sample recordings, per thread count.
      const wavs = [0, 1, 2, 3, 4]
        .map((n) => `${modelsDir}/${MOONSHINE_WAVS}/${n}.wav`)
        .filter((w) => SidekickNative.fileExists(w));
      const secs = wavs.map((w) => {
        const b = SidekickNative.readBase64(w);
        return b ? wavSeconds(b) : null;
      });
      const sttThreads = hasAny(STT_THREAD_SETTERS) ? [2, 3, 4] : [null];
      for (const t of sttThreads) {
        if (t !== null) await callIfExists(SidekickNative, STT_THREAD_SETTERS, t);
        const tl = t === null ? 'default' : `t${t}`;
        for (let i = 0; i < wavs.length; i++) {
          const t0 = Date.now();
          try {
            const r = await SidekickNative.debugTranscribe(wavs[i]);
            // The first file per setting includes loading the model.
            emit({
              test: i === 0 ? 'stt_first' : 'stt',
              variant: `${tl} ${i}.wav`,
              ms: Date.now() - t0,
              audioSec: secs[i] ?? undefined,
              ok: true,
              text: r.text,
            });
          } catch (e) {
            fail('stt', `${tl} ${i}.wav`, e);
          }
        }
      }

      // 3. Voiceprint of one recording.
      if (wavs.length) {
        const t0 = Date.now();
        try {
          const p = await SidekickNative.debugVoiceprint(wavs[0]);
          emit({
            test: 'voiceprint',
            variant: '0.wav',
            ms: Date.now() - t0,
            audioSec: secs[0] ?? undefined,
            ok: !!p,
            text: p ? `${p.length} dims` : 'no voiceprint',
          });
        } catch (e) {
          fail('voiceprint', '0.wav', e);
        }
      }

      // 4. Embedder (chat model already unloaded): load with one item, then 20 sentences.
      const emb = modelPath(EMBEDDER_FILE);
      if (!SidekickNative.fileExists(emb)) fail('embed', '', 'embedder not downloaded');
      else
        try {
          let t0 = Date.now();
          await SidekickNative.embed(emb, [EMBED_SAMPLES[0]], EMBED_DIMS);
          emit({ test: 'embed_load', variant: '1 item', ms: Date.now() - t0, ok: true, text: '' });
          t0 = Date.now();
          const v = await SidekickNative.embed(emb, EMBED_SAMPLES, EMBED_DIMS);
          const ms = Date.now() - t0;
          emit({
            test: 'embed',
            variant: `${EMBED_SAMPLES.length} items`,
            ms: Math.round(ms / EMBED_SAMPLES.length),
            ok: v.length === EMBED_SAMPLES.length,
            text: `ms per item; total ${ms} ms`,
          });
        } catch (e) {
          fail('embed', '', e);
        }
      await SidekickNative.embedUnload();
      console.log('[speed] done');
      setLog((l) => [...l, '[speed] done']);
    })();

  const load = (backend: LlmBackend | 'auto') =>
    run('load', async () => {
      await unloadLlm();
      let r;
      if (backend === 'auto') {
        resetBackendChoice();
        r = await ensureLlm(add);
      } else {
        r = await SidekickNative.llmLoad([{ modelPath: `${modelsDir}/${GEMMA_GENERIC}`, backend }]);
      }
      add(
        `loaded ${r.backend} in ${r.initMs} ms${r.failures.length ? ` (skipped: ${r.failures.join('; ')})` : ''}`,
      );
    });

  const generate = (kind: 'text' | 'photo') =>
    run(kind, async () => {
      setAnswer('');
      answerRef.current = '';
      reqId.current = `${Date.now()}`;
      const s: LlmStats = await SidekickNative.llmGenerate(
        reqId.current,
        kind === 'text' ? TEXT_PROMPT : PHOTO_PROMPT,
        kind === 'photo' ? await benchPhoto() : null,
      );
      add(
        `${kind}: total ${(s.totalMs / 1000).toFixed(1)} s · first word ${(s.ttftMs / 1000).toFixed(1)} s · ` +
          `read ${s.prefillTokens} tok @ ${s.prefillTokensPerSec.toFixed(0)}/s · ` +
          `wrote ${s.decodeTokens} tok @ ${s.decodeTokensPerSec.toFixed(1)}/s`,
      );
      console.log(`[bench] answer: ${answerRef.current}`);
    });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Engine benchmark</Text>
      <Text>
        {device.manufacturer} {device.model} · {device.soc} · {Math.round(device.totalRamMb / 1024)}{' '}
        GB
      </Text>
      <Text selectable style={styles.mono}>
        Models: {modelsDir}
      </Text>
      <View style={styles.row}>
        <Button
          title="Download model + photo"
          disabled={busy}
          onPress={() => download([MODEL_FILES.gemmaGeneric])}
        />
      </View>
      {progress !== '' && <Text>{progress}</Text>}
      <View style={styles.row}>
        <Button title="Speed run" disabled={busy} onPress={speedRun} />
      </View>
      <View style={styles.row}>
        <Button title="Measure + pick fastest" disabled={busy} onPress={() => load('auto')} />
        <Button title="GPU" disabled={busy} onPress={() => load('gpu')} />
        <Button title="CPU" disabled={busy} onPress={() => load('cpu')} />
      </View>
      <View style={styles.row}>
        <Button title="Text test" disabled={busy} onPress={() => generate('text')} />
        <Button title="Photo test" disabled={busy} onPress={() => generate('photo')} />
        <Button title="Unload" disabled={busy} onPress={() => run('unload', unloadLlm)} />
      </View>
      <View style={styles.row}>
        <Button title="Speech test" disabled={busy} onPress={speechTest} />
        <Button title="Mic test" disabled={busy} onPress={micTest} />
      </View>
      <View style={styles.row}>
        <Button title="Wake test" disabled={busy} onPress={wakeTest} />
        <Button title="Play wake" disabled={busy} onPress={playWake} />
        <Button title="Wake in 10 s" disabled={busy} onPress={playWakeLater} />
      </View>
      <View style={styles.row}>
        <Button title="Answers bench" disabled={busy} onPress={() => bench('answers')} />
        <Button
          title="Recall: load 100"
          disabled={busy}
          onPress={() => bench('recall-load', undefined, 100)}
        />
        <Button title="Recall: ask" disabled={busy} onPress={() => bench('recall')} />
        <Button title="Recall: remove" disabled={busy} onPress={() => bench('recall-clear')} />
        <Button title="Research bench" disabled={busy} onPress={() => bench('research')} />
      </View>
      <View style={styles.row}>
        <Button title="Conversation test" disabled={busy} onPress={conversationTest} />
        <Button title="Voice test" disabled={busy} onPress={voiceTest} />
      </View>
      {busy && <Text>Working…</Text>}
      <Text style={styles.answer}>{answer}</Text>
      {log.map((l, i) => (
        <Text key={i} selectable style={styles.mono}>
          {l}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingTop: 56, gap: 12 },
  title: { fontSize: 22, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  answer: { fontSize: 16 },
  mono: { fontFamily: 'monospace', fontSize: 12 },
});
