import { Camera } from 'expo-camera';
import { PermissionsAndroid, Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { downloadFile, isDownloaded, wifiOnlyDownloads } from './downloads';
import { applySpeechModel, speechModelsReady } from './language';
import { MODEL_FILES, OPTIONAL_SPEECH_FILES } from './models';
import { modelsDir } from './paths';
import { askLocationPermission, pushPauseRules } from './places';
import { IPHONE } from './platform-text';
import { SYSTEM_PROMPT } from './prompts';
import { getSettings } from './settings';
import { listenPlan } from './listen-mode';
import { DEFAULT_WAKE_PHRASE, parseSentencepiece, wakeKeywordLines } from './wake-word';

const KWS_DIR = MODEL_FILES.wakeWord.unpackedCheck!.split('/')[0];

export function speechReady(): boolean {
  return speechModelsReady();
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The keyword-spotter lines for the user's wake phrase, with and without its greeting ("Hey
 * Sidekick" and "Sidekick"); falls back to those two.
 */
export function wakeLine(phrase: string): { line: string; phrase: string } {
  const b64 = SidekickNative.readBase64(`${modelsDir()}/${KWS_DIR}/bpe.model`);
  if (b64) {
    const vocab = parseSentencepiece(base64ToBytes(b64));
    const line = wakeKeywordLines(phrase, vocab);
    if (line) return { line, phrase };
  }
  return {
    line: '▁HE Y ▁ SIDE K IC K :2.0 #0.25 @HEY_SIDEKICK\n▁ SIDE K IC K :2.0 #0.25 @SIDEKICK',
    phrase: DEFAULT_WAKE_PHRASE,
  };
}

/**
 * Pushes settings to the native listener. While this JS runtime is alive (app open or in the
 * background) it answers questions, with memory; the service answers alone only if the app was closed.
 */
export function configureListening() {
  const s = getSettings();
  const { line, phrase } = wakeLine(s.wakePhrase);
  // The speech-to-text build first (English, or 25 languages when that setting is on).
  applySpeechModel();
  // The background service answers with the same instructions as the app.
  SidekickNative.kvSet('assistant.system', SYSTEM_PROMPT);
  const plan = listenPlan(s);
  SidekickNative.listenConfigure(line, phrase, plan.recordAmbient, true);
  // Older native builds don't have it; the journal is still off for ambient speech then.
  SidekickNative.listenCommandsOnly?.(plan.commandsOnly);
  pushPauseRules();
  fetchVoiceInBackground();
}

export async function askMicPermission(): Promise<boolean> {
  const mic = await Camera.requestMicrophonePermissionsAsync();
  if (!mic.granted) return false;
  // iPhone: push-to-talk uses Apple's on-device speech recognizer, which has its own permission.
  if (Platform.OS === 'ios') {
    await SidekickNative.speechRequestAccess?.().catch(() => false);
    return true;
  }
  if (Platform.OS === 'android' && Platform.Version >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  // Optional: place names on memories and "pause here". Listening works without it.
  await askLocationPermission().catch(() => false);
  return true;
}

/** Starts background listening. Must be called from a visible screen (Android rule). */
export async function startListening(): Promise<string | null> {
  // iOS doesn't let apps keep the microphone on in the background (ADR 0006).
  if (Platform.OS === 'ios') return IPHONE.listen;
  if (!speechReady()) return 'Speech models are not downloaded yet.';
  if (!(await askMicPermission())) return 'Microphone permission is needed to listen.';
  configureListening();
  SidekickNative.listenStart();
  return null;
}

export function stopListening() {
  SidekickNative.listenStop();
}

export const isListening = () => SidekickNative.listenActive();

/** Turns listening back on when it was on before the app was killed (call from a visible screen). */
export async function resumeListening(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (isListening() || !SidekickNative.listenWanted()) return isListening();
  return (await startListening()) === null;
}

let voiceFetch: Promise<void> | null = null;

/**
 * Fetches the neural voice and Smart Turn once the required speech models are in (Wi-Fi only, in
 * the background, one at a time). Until then, and if it fails, answers use the system voice and
 * turns end on silence alone.
 */
export function fetchVoiceInBackground() {
  if (Platform.OS !== 'android' || voiceFetch || !speechReady()) return;
  const missing = OPTIONAL_SPEECH_FILES.filter((f) => !isDownloaded(f));
  if (!missing.length) return;
  voiceFetch = (async () => {
    for (const f of missing) await downloadFile(f, () => {}, wifiOnlyDownloads());
  })().catch((e) => {
    console.log(`[voice] download failed: ${String(e)}`);
    voiceFetch = null;
  });
}
