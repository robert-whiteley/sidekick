import { Directory } from 'expo-file-system';
import { Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { downloadFile, isDownloaded, wifiOnlyDownloads } from './downloads';
import { setRequiredSpeechFiles } from './llm-candidates';
import {
  baseLanguage,
  type LanguagePlan,
  languageName,
  languagePlan,
  type SpeechModelId,
  voiceLocale,
} from './language-logic';
import { MODEL_FILES, type ModelFile, SPEECH_FILES, speechToTextFile } from './models';
import { notices } from './notices';
import { modelsDir } from './paths';
import { setAnswerLanguage } from './prompts';
import { getSettings } from './settings';

/**
 * Applies the language setting: the model's answer language, the voice's language, and the
 * speech-to-text build (downloading Parakeet v3 on Wi-Fi when another language needs it, then
 * switching and deleting the unused build). See language-logic.ts for the rules.
 */

/** The phone's language as a BCP-47 tag ("de-AT"); "en" if unknown. */
export function phoneLocale(): string {
  try {
    const native = SidekickNative.phoneLocale?.();
    if (native) return native;
  } catch {
    // Older native build.
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en';
  } catch {
    return 'en';
  }
}

export function currentLanguagePlan(): LanguagePlan {
  return languagePlan(getSettings().speechLanguage ?? 'auto', phoneLocale());
}

const dirOf = (f: ModelFile) => f.unpackedCheck!.split('/')[0];

/** Speech-to-text builds on the phone now. */
function downloadedStt(): SpeechModelId[] {
  return (['parakeet-v2', 'parakeet-v3'] as const).filter((m) => isDownloaded(speechToTextFile(m)));
}

/**
 * The required speech files: only one speech-to-text build. First run fetches the one this
 * language needs; after a language change the build already on the phone counts until the new
 * one has arrived in the background (so the app never goes back to the download screen).
 */
export function requiredSpeechFiles(): ModelFile[] {
  const want = currentLanguagePlan().model;
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

let applied: string | null = null;
let fetching: Promise<void> | null = null;

/** Call at start and whenever the language setting changes. Safe to call often. */
export function applyLanguage() {
  const plan = currentLanguagePlan();
  setAnswerLanguage(plan.answer);
  if (Platform.OS !== 'android') return;
  const locale = phoneLocale();
  const key = `${plan.answer}|${plan.model}|${locale}`;
  if (key === applied) return;
  applied = key;
  // "" keeps the phone's own voice language when it already is that language.
  const tag = baseLanguage(locale) === plan.answer ? '' : voiceLocale(plan.answer, locale);
  SidekickNative.voiceSetLanguage?.(tag);
  void switchSpeechModel(plan.model);
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
    if (!isDownloaded(file) || currentLanguagePlan().model !== model) return;
  }
  const ok = await SidekickNative.speechSetAsrModel?.(dirOf(file)).catch(() => false);
  if (!ok) return;
  // Free ~0.6 GB: the other build is no longer used.
  const other = speechToTextFile(model === 'parakeet-v2' ? 'parakeet-v3' : 'parakeet-v2');
  try {
    const d = new Directory(`file://${modelsDir()}/${dirOf(other)}`);
    if (d.exists) d.delete();
  } catch (e) {
    console.log(`[language] couldn't delete the unused speech model: ${String(e)}`);
  }
  if (model === 'parakeet-v3')
    notices.post({
      key: 'language.speech',
      kind: 'info',
      text: `Sidekick now understands ${languageName(currentLanguagePlan().language)} (speech model for 25 languages)`,
      href: '/settings/assistant',
    });
}
