import { Camera } from 'expo-camera';
import { AppState, PermissionsAndroid, Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { isDownloaded } from './downloads';
import { MODEL_FILES, SPEECH_FILES } from './models';
import { modelsDir } from './paths';
import { getSettings } from './settings';
import { DEFAULT_WAKE_PHRASE, parseSentencepiece, wakeKeywordLine } from './wake-word';

const KWS_DIR = MODEL_FILES.wakeWord.unpackedCheck!.split('/')[0];

export function speechReady(): boolean {
  return SPEECH_FILES.every(isDownloaded);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The keyword-spotter line for the user's wake phrase (falls back to "Hey Sidekick"). */
export function wakeLine(phrase: string): { line: string; phrase: string } {
  const b64 = SidekickNative.readBase64(`${modelsDir()}/${KWS_DIR}/bpe.model`);
  if (b64) {
    const vocab = parseSentencepiece(base64ToBytes(b64));
    const line = wakeKeywordLine(phrase, vocab);
    if (line) return { line, phrase };
  }
  return { line: '▁HE Y ▁ SIDE K IC K :2.0 #0.25 @HEY_SIDEKICK', phrase: DEFAULT_WAKE_PHRASE };
}

/** Pushes settings to the native listener. JS answers questions only while the app is on screen. */
export function configureListening() {
  const s = getSettings();
  const { line, phrase } = wakeLine(s.wakePhrase);
  SidekickNative.listenConfigure(
    line,
    phrase,
    s.recordConversations,
    AppState.currentState === 'active',
  );
}

let appStateSub: { remove(): void } | null = null;
export function trackForeground() {
  appStateSub?.remove();
  appStateSub = AppState.addEventListener('change', () => configureListening());
}

export async function askMicPermission(): Promise<boolean> {
  const mic = await Camera.requestMicrophonePermissionsAsync();
  if (!mic.granted) return false;
  if (Platform.OS === 'android' && Platform.Version >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  return true;
}

/** Starts background listening. Must be called from a visible screen (Android rule). */
export async function startListening(): Promise<string | null> {
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
