import { CameraView, useCameraPermissions } from 'expo-camera';
import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  AppState,
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

import SidekickNative from '../../../modules/sidekick-native';
import { answer as answerQuestion, DEFAULT_PHOTO_QUESTION } from '@/engine/assistant';
import { describeOnePhoto, yieldToQuestion } from '@/engine/describe-photos';
import {
  configureListening,
  isListening,
  askMicPermission,
  startListening,
  stopListening,
} from '@/engine/listen';
import { inferFactsIfIdle, stopFactInference } from '@/engine/fact-inference';
import { cancelLlm, ensureLlm } from '@/engine/llm';
import { getSettings, updateSettings } from '@/engine/settings';
import { StreamingSpeaker } from '@/engine/speaker';
import { asksAboutWhatIsInView } from '@/memory/search-logic';
import { capturePhoto, embedPending, ingestJournal, learnOwnerVoice } from '@/memory/store';

type Phase = 'idle' | 'loading' | 'thinking' | 'answering';

/** The main screen: point the camera, ask, hear the answer. */
export function AskScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [useCamera, setUseCamera] = useState(true);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState<Phase>('loading');
  const [speak, setSpeakState] = useState(getSettings().speakAnswers);
  const [listening, setListening] = useState(isListening());
  const [holding, setHolding] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const captureRef = useRef<{
    photo: Promise<string | null>;
    at: number;
    mic: Promise<boolean>;
  } | null>(null);
  const camera = useRef<CameraView>(null);
  const speaker = useRef<StreamingSpeaker | null>(null);
  const busyRef = useRef(true);
  const askRef = useRef<(q: string) => void>(() => {});

  const setSpeak = (v: boolean) => {
    setSpeakState(v);
    updateSettings({ speakAnswers: v });
  };

  // Warm the model up in the background so the first question is quicker.
  useEffect(() => {
    ensureLlm(setStatus)
      .then((r) => setStatus(`Ready · ${r.backend.toUpperCase()}`))
      .catch((e) => setStatus(`Model failed to load: ${String(e)}`))
      .finally(() => {
        busyRef.current = false;
        setPhase('idle');
      });
  }, []);

  // Wake word / background listening events, and moving what was heard into memory.
  useEffect(() => {
    configureListening();
    const subs = [
      SidekickNative.addListener('onWake', () => setStatus('Listening…')),
      SidekickNative.addListener('onQuestion', (e) => askRef.current(e.text)),
      SidekickNative.addListener('onListenError', (e) =>
        setStatus(`Listening stopped: ${e.message}`),
      ),
    ];
    const tick = async () => {
      if (busyRef.current) return;
      try {
        await ingestJournal();
        await embedPending();
        // Idle: read one saved photo's text into memory (only if the model is already loaded).
        void describeOnePhoto(busyRef.current);
        // Uses the model only if it is already loaded; a question cancels it.
        if (!busyRef.current) await inferFactsIfIdle();
      } catch (e) {
        console.log(`[memory] ingest failed: ${String(e)}`);
      }
    };
    const timer = setInterval(tick, 30_000);
    void tick();
    return () => {
      subs.forEach((s) => s.remove());
      clearInterval(timer);
    };
  }, []);

  const cameraOn = useCamera && permission?.granted === true;
  const busy = phase !== 'idle';

  const toggleListening = async () => {
    if (listening) {
      stopListening();
      setListening(false);
      return;
    }
    const err = await startListening();
    if (err) setStatus(err);
    else {
      setListening(true);
      setStatus(`Listening for "${getSettings().wakePhrase}"`);
    }
  };

  const holdStart = async () => {
    if (busyRef.current) return;
    if (!(await askMicPermission())) {
      setStatus('Microphone permission is needed.');
      return;
    }
    speaker.current?.stop();
    SidekickNative.pttStart();
    setHolding(true);
    setStatus('Listening… let go when done');
  };

  const holdEnd = async () => {
    if (!holding) return;
    setHolding(false);
    setStatus('Transcribing…');
    try {
      const { text, voice } = await SidekickNative.pttStop();
      if (voice) void learnOwnerVoice(voice).catch(() => {});
      if (!text) {
        setStatus("I didn't catch that.");
        return;
      }
      setQuestion(text);
      await ask(text);
    } catch (e) {
      setStatus(`Couldn't hear you: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Capture: tap saves a photo; hold to add a voice note (released = saved).
  const captureStart = () => {
    if (!cameraOn || captureRef.current) {
      if (!cameraOn) setStatus('Turn the camera on to capture.');
      return;
    }
    const at = Date.now();
    const photo = (async () => {
      const pic = await camera.current?.takePictureAsync({ quality: 0.8, shutterSound: false });
      return pic?.uri.replace(/^file:\/\//, '') ?? null;
    })();
    // Set synchronously so a quick tap's release always finds it.
    const mic = (async () => {
      if (holding || !(await askMicPermission())) return false;
      SidekickNative.pttStart();
      return true;
    })();
    captureRef.current = { photo, at, mic };
    setCapturing(true);
    setStatus('Captured · keep holding to add a voice note');
  };

  const captureEnd = async () => {
    const c = captureRef.current;
    if (!c) return;
    captureRef.current = null;
    setCapturing(false);
    try {
      let note: string | null = null;
      if (await c.mic) {
        const { text, voice } = await SidekickNative.pttStop();
        // A quick tap records a fraction of a second of nothing: only keep real notes.
        if (Date.now() - c.at > 800 && text) note = text;
        if (note && voice) void learnOwnerVoice(voice).catch(() => {});
      }
      const path = await c.photo;
      if (!path) throw new Error('no photo');
      await capturePhoto(path, note, c.at);
      setStatus(note ? `Saved photo with note: "${note}"` : 'Saved photo');
    } catch (e) {
      setStatus(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const ask = async (spoken?: string) => {
    const q = (spoken ?? question).trim() || (cameraOn ? DEFAULT_PHOTO_QUESTION : '');
    if (!q || busyRef.current) return;
    busyRef.current = true;
    await yieldToQuestion();
    if (spoken) setQuestion(spoken);
    setAnswer('');
    setPhase('thinking');
    speaker.current?.stop();
    const sp = new StreamingSpeaker(speak);
    speaker.current = sp;
    try {
      await stopFactInference();
      let imagePath: string | null = null;
      const visible = AppState.currentState === 'active';
      if (cameraOn && visible && (q === DEFAULT_PHOTO_QUESTION || asksAboutWhatIsInView(q))) {
        const pic = await camera.current?.takePictureAsync({ quality: 0.6, shutterSound: false });
        imagePath = pic?.uri.replace(/^file:\/\//, '') ?? null;
      }
      setStatus(imagePath ? 'Looking…' : 'Thinking…');
      const r = await answerQuestion(q, imagePath, (full) => {
        setPhase('answering');
        setAnswer(full);
        sp.update(full);
      });
      sp.finish(r.text);
      const src = r.sources.length ? ` · ${r.sources.length} memories` : '';
      const seen = r.usedPhoto && !imagePath ? ' · re-read a saved photo' : '';
      setStatus(
        `${(r.ms / 1000).toFixed(1)} s · first word ${(r.ttftMs / 1000).toFixed(1)} s${src}${seen}`,
      );
      console.log(`[ask] ${imagePath ? 'photo' : 'text'} ${r.ms} ms${src}${seen}: ${r.text}`);
      setQuestion('');
    } catch (e) {
      setStatus(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      busyRef.current = false;
      setPhase('idle');
    }
  };
  useEffect(() => {
    askRef.current = (q: string) => void ask(q);
  });

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
          <Toggle
            label={listening ? 'Listening' : 'Listen'}
            value={listening}
            onChange={toggleListening}
          />
          <Pressable
            style={[styles.chip, styles.capture, capturing && styles.micOn]}
            onPressIn={captureStart}
            onPressOut={captureEnd}
            accessibilityRole="button"
            accessibilityLabel="Capture photo, hold to add a voice note"
          >
            <Text style={[styles.chipText, styles.chipTextOn]}>
              {capturing ? '● Note' : 'Capture'}
            </Text>
          </Pressable>
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
            onSubmitEditing={() => ask()}
          />
          <Pressable
            style={[styles.ask, styles.mic, holding && styles.micOn]}
            onPressIn={holdStart}
            onPressOut={holdEnd}
            accessibilityRole="button"
            accessibilityLabel="Hold to talk"
          >
            <Text style={styles.askText}>{holding ? '●' : '🎤'}</Text>
          </Pressable>
          {phase === 'thinking' || phase === 'answering' ? (
            <Pressable style={[styles.ask, styles.stop]} onPress={stop} accessibilityRole="button">
              <Text style={styles.askText}>Stop</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.ask, busy && styles.disabled]}
              onPress={() => ask()}
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
  mic: { paddingHorizontal: 16, backgroundColor: '#444' },
  micOn: { backgroundColor: '#b00020' },
  capture: { backgroundColor: '#444', marginLeft: 'auto' },
  disabled: { opacity: 0.5 },
  askText: { color: 'white', fontSize: 17, fontWeight: '600' },
});
