import { useEffect, useRef, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';

import SidekickNative, { type LlmBackend, type LlmStats } from '../../modules/sidekick-native';
import { GEMMA_GENERIC } from '@/engine/llm-candidates';
import { ensureLlm, resetBackendChoice, unloadLlm } from '@/engine/llm';
import { modelsDir as modelsDirFn } from '@/engine/paths';
import { downloadFile } from '@/engine/downloads';
import { MODEL_FILES, type ModelFile } from '@/engine/models';

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
