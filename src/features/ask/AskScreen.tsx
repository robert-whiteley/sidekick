import { CameraView, useCameraPermissions } from 'expo-camera';
import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEFAULT_PHOTO_QUESTION, SYSTEM_PROMPT } from '@/engine/assistant';
import { askLlm, cancelLlm, ensureLlm } from '@/engine/llm';
import { StreamingSpeaker } from '@/engine/speaker';

type Phase = 'idle' | 'loading' | 'thinking' | 'answering';

/** The main screen: point the camera, ask, hear the answer. */
export function AskScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [useCamera, setUseCamera] = useState(true);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState<Phase>('loading');
  const [speak, setSpeak] = useState(true);
  const camera = useRef<CameraView>(null);
  const speaker = useRef<StreamingSpeaker | null>(null);

  // Warm the model up in the background so the first question is quicker.
  useEffect(() => {
    ensureLlm(setStatus)
      .then((r) => setStatus(`Ready · ${r.backend.toUpperCase()}`))
      .catch((e) => setStatus(`Model failed to load: ${String(e)}`))
      .finally(() => setPhase('idle'));
  }, []);

  const cameraOn = useCamera && permission?.granted === true;
  const busy = phase !== 'idle';

  const ask = async () => {
    const q = question.trim() || (cameraOn ? DEFAULT_PHOTO_QUESTION : '');
    if (!q || busy) return;
    setAnswer('');
    setPhase('thinking');
    speaker.current?.stop();
    const sp = new StreamingSpeaker(speak);
    speaker.current = sp;
    try {
      let imagePath: string | null = null;
      if (cameraOn) {
        const pic = await camera.current?.takePictureAsync({ quality: 0.6, shutterSound: false });
        imagePath = pic?.uri.replace(/^file:\/\//, '') ?? null;
      }
      setStatus(imagePath ? 'Looking…' : 'Thinking…');
      const { text, stats } = await askLlm(
        q,
        imagePath,
        (full) => {
          setPhase('answering');
          setAnswer(full);
          sp.update(full);
        },
        { system: SYSTEM_PROMPT },
      );
      sp.finish(text);
      setStatus(
        `${(stats.totalMs / 1000).toFixed(1)} s · first word ${(stats.ttftMs / 1000).toFixed(1)} s`,
      );
      console.log(`[ask] ${imagePath ? 'photo' : 'text'} ${stats.totalMs} ms: ${text}`);
    } catch (e) {
      setStatus(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPhase('idle');
    }
  };

  const stop = () => {
    cancelLlm();
    speaker.current?.stop();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Sidekick</Text>
          <Link href="/settings" style={styles.link}>
            Settings
          </Link>
        </View>

        <View style={styles.cameraBox}>
          {cameraOn ? (
            <CameraView ref={camera} style={styles.flex} facing="back" />
          ) : (
            <Pressable
              style={styles.cameraOff}
              onPress={() => (permission?.granted ? setUseCamera(true) : requestPermission())}
            >
              <Text style={styles.cameraOffText}>
                {permission?.granted ? 'Camera off — tap to turn on' : 'Tap to allow the camera'}
              </Text>
            </Pressable>
          )}
        </View>

        <View style={styles.toggles}>
          <Toggle label="Camera" value={useCamera} onChange={setUseCamera} />
          <Toggle label="Speak answers" value={speak} onChange={setSpeak} />
        </View>

        <ScrollView style={styles.answerBox} contentContainerStyle={styles.answerContent}>
          <Text style={styles.answer} selectable>
            {answer || (phase === 'thinking' ? '…' : '')}
          </Text>
          <Text style={styles.status}>{status}</Text>
        </ScrollView>

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={question}
            onChangeText={setQuestion}
            placeholder={cameraOn ? DEFAULT_PHOTO_QUESTION : 'Ask anything'}
            returnKeyType="send"
            onSubmitEditing={ask}
          />
          {phase === 'thinking' || phase === 'answering' ? (
            <Pressable style={[styles.ask, styles.stop]} onPress={stop} accessibilityRole="button">
              <Text style={styles.askText}>Stop</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.ask, busy && styles.disabled]}
              onPress={ask}
              disabled={busy}
              accessibilityRole="button"
            >
              <Text style={styles.askText}>Ask</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      onPress={() => props.onChange(!props.value)}
      style={[styles.chip, props.value && styles.chipOn]}
      accessibilityRole="switch"
      accessibilityState={{ checked: props.value }}
    >
      <Text style={[styles.chipText, props.value && styles.chipTextOn]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'white' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  title: { fontSize: 24, fontWeight: '700' },
  link: { fontSize: 16, color: '#2f6fed' },
  cameraBox: { height: '38%', marginHorizontal: 16, borderRadius: 16, overflow: 'hidden' },
  cameraOff: { flex: 1, backgroundColor: '#eee', alignItems: 'center', justifyContent: 'center' },
  cameraOffText: { fontSize: 16, color: '#555' },
  toggles: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 10 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#eee' },
  chipOn: { backgroundColor: '#2f6fed' },
  chipText: { fontSize: 14, color: '#333' },
  chipTextOn: { color: 'white' },
  answerBox: { flex: 1, marginHorizontal: 16, marginTop: 10 },
  answerContent: { paddingBottom: 12, gap: 8 },
  answer: { fontSize: 19, lineHeight: 27 },
  status: { fontSize: 13, color: '#777' },
  inputRow: { flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderColor: '#eee' },
  input: {
    flex: 1,
    fontSize: 17,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: '#f2f2f5',
  },
  ask: {
    backgroundColor: '#2f6fed',
    borderRadius: 24,
    paddingHorizontal: 22,
    justifyContent: 'center',
  },
  stop: { backgroundColor: '#b00020' },
  disabled: { opacity: 0.5 },
  askText: { color: 'white', fontSize: 17, fontWeight: '600' },
});
