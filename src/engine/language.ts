import { Directory } from 'expo-file-system';
import { Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { downloadFile, isDownloaded, wifiOnlyDownloads } from './downloads';
import { setRequiredSpeechFiles } from './llm-candidates';
import { interpretLanguage } from './interpreter-logic';
import { type SpeechModelId, speechModelFor, speechModelNotice } from './language-logic';
import { MODEL_FILES, type ModelFile, SPEECH_FILES, speechToTextFile } from './models';
import { notices } from './notices';
import { modelsDir } from './paths';
import { getSettings } from './settings';

/**
 * The speech-to-text build: Parakeet v2 (English) normally; v3 (25 European languages) while
 * "Understand other languages around me" is on — downloaded on Wi-Fi, switched to once it is in,
 * and the unused build deleted. Sidekick itself stays English (language-logic.ts).
 */

export function wantedSpeechModel(): SpeechModelId {
  return speechModelFor(getSettings().understandOtherLanguages ?? false);
}

const dirOf = (f: ModelFile) => f.unpackedCheck!.split('/')[0];

/** Speech-to-text builds on the phone now. */
function downloadedStt(): SpeechModelId[] {
  return (['parakeet-v2', 'parakeet-v3'] as const).filter((m) => isDownloaded(speechToTextFile(m)));
}

/**
 * The required speech files: only one speech-to-text build. First run fetches v2; after the
 * setting changes, the build already on the phone counts until the other one has arrived in the
 * background (so the app never goes back to the download screen).
 */
export function requiredSpeechFiles(): ModelFile[] {
  const want = wantedSpeechModel();
  const have = downloadedStt();
  const stt = speechToTextFile(have.includes(want) || !have.length ? want : have[0]);
  return SPEECH_FILES.map((f) => (f === MODEL_FILES.speechToText ? stt : f));
}

setRequiredSpeechFiles(requiredSpeechFiles);

/** Listening can start: the small models plus either speech-to-text build (native falls back). */
export function speechModelsReady(): boolean {
  const base = SPEECH_FILES.filter((f) => f !== MODEL_FILES.speechToText);
  return base.every(isDownloaded) && downloadedStt().length > 0;
}

/** The speech build the last notice was about (kv, kept across restarts). */
const NOTICED_KEY = 'language.speechNoticed';

let applied: string | null = null;
let fetching: Promise<void> | null = null;
let voiceSet = false;

/** Call at start and whenever the setting changes. Safe to call often. */
export function applySpeechModel() {
  if (Platform.OS !== 'android') return;
  if (!voiceSet) {
    voiceSet = true;
    // Answers are English: the phone's voice speaks English even on a phone set to German
    // (also clears a language saved by an earlier build).
    SidekickNative.voiceSetLanguage?.('en');
  }
  const model = wantedSpeechModel();
  if (model === applied) return;
  applied = model;
  void switchSpeechModel(model);
}

async function switchSpeechModel(model: SpeechModelId) {
  const file = speechToTextFile(model);
  if (!isDownloaded(file)) {
    if (fetching) return;
    fetching = downloadFile(file, () => {}, wifiOnlyDownloads())
      .catch((e) => console.log(`[language] speech model download failed: ${String(e)}`))
      .finally(() => {
        fetching = null;
      });
    await fetching;
    if (!isDownloaded(file)) {
      applied = null; // try again on the next call (e.g. back on Wi-Fi)
      return;
    }
    if (wantedSpeechModel() !== model) return;
  }
  const ok = await SidekickNative.speechSetAsrModel?.(dirOf(file)).catch(() => false);
  if (!ok) return;
  // Free ~0.5 GB: the other build is no longer used.
  const other = speechToTextFile(model === 'parakeet-v2' ? 'parakeet-v3' : 'parakeet-v2');
  // The interpreter hears European languages with v3: kept while it has one of them.
  const interpreterNeedsV3 = (getSettings().interpreterLanguages ?? []).some(
    (c) => interpretLanguage(c)?.stt === 'parakeet-v3',
  );
  try {
    const d = new Directory(`file://${modelsDir()}/${dirOf(other)}`);
    if (d.exists && !(other === MODEL_FILES.speechToTextMulti && interpreterNeedsV3)) d.delete();
  } catch (e) {
    console.log(`[language] couldn't delete the unused speech model: ${String(e)}`);
  }
  const text = speechModelNotice(model, SidekickNative.kvGet(NOTICED_KEY) ?? null);
  SidekickNative.kvSet(NOTICED_KEY, model);
  if (text)
    notices.post({ key: 'language.speech', kind: 'info', text, href: '/settings/assistant' });
}
