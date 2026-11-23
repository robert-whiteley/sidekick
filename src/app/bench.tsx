import { useEffect, useRef, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';

import SidekickNative, { type LlmBackend, type LlmStats } from '../../modules/sidekick-native';
import { GEMMA_GENERIC } from '@/engine/llm-candidates';
import { ensureLlm, resetBackendChoice, unloadLlm } from '@/engine/llm';
import { dataDir, modelsDir as modelsDirFn } from '@/engine/paths';
import { downloadFile } from '@/engine/downloads';
import { MODEL_FILES, type ModelFile } from '@/engine/models';
import { cosine } from '@/memory/voices';

const MOONSHINE_WAVS = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/test_wavs';
const KWS_WAVS = 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01/test_wavs';

const TEXT_PROMPT = 'In three sentences, explain why the sky is blue.';
const PHOTO_PROMPT = 'What is in this photo? Answer in two sentences.';

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
        kind === 'photo' ? `${modelsDir}/test.jpg` : null,
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
          onPress={() => download([MODEL_FILES.gemmaGeneric, MODEL_FILES.benchPhoto])}
        />
      </View>
      {progress !== '' && <Text>{progress}</Text>}
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
