import { router } from 'expo-router';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { connection, downloadFile, isDownloaded, wifiOnlyDownloads } from './downloads';
import {
  androidSpeech,
  type InterpretLanguage,
  interpretLanguage,
  interpretSystem,
  languageFromName,
  parseControlReply,
  type InterpretSide,
  type InterpretTurn,
  parseTurnReply,
  partialTranslation,
  TURN_MAX_TOKENS,
  turnPrompt,
} from './interpreter-logic';
import { askLlm, cancelLlm, ensureLlm } from './llm';
import { askMicPermission } from './listen';
import { MODEL_FILES, type ModelFile } from './models';
import { getSettings, updateSettings } from './settings';

/**
 * The interpreter session ("help me talk to this taxi driver in Spanish"; ADR 0006 "Interpreter").
 * One conversation at a time, kept in memory only (nothing is saved). Each side taps its own mic:
 * the owner speaks English, the other person their language. What was heard is translated by
 * the chat model and shown on the other side, then spoken there in the phone's own offline voice
 * for that language. The model also decides, on the owner's turns, when the owner is talking to
 * Sidekick instead (stop, change language). The screen is src/features/interpreter.
 *
 * Speech-to-text, Android: the owner's English uses the usual model; the other person's language
 * uses Parakeet v3 (25 European languages) or Whisper small (the others), each downloaded the
 * first time it is needed. iPhone: Apple's on-device speech in that language.
 */

/** Whisper small (MIT), the int8 files of the sherpa-onnx export, pinned to a commit. */
const WHISPER =
  'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/8f3c18b358db4d1f2fc1eae49d75cd20989e4309';
export const WHISPER_DIR = 'sherpa-onnx-whisper-small';
export const WHISPER_FILES: ModelFile[] = [
  {
    name: `${WHISPER_DIR}/small-encoder.int8.onnx`,
    url: `${WHISPER}/small-encoder.int8.onnx`,
    sha256: '4cbe7b22fa9026b843b60a68640c747de05bafb1a11b57edc0e66c232d9f33a9',
    bytes: 112442483,
  },
  {
    name: `${WHISPER_DIR}/small-decoder.int8.onnx`,
    url: `${WHISPER}/small-decoder.int8.onnx`,
    sha256: 'acad50b5c782696e91b55914cc5ab4f756f1532f76e22aa6fc615f39fb69a8ee',
    bytes: 262226114,
  },
  {
    name: `${WHISPER_DIR}/small-tokens.txt`,
    url: `${WHISPER}/small-tokens.txt`,
    sha256: 'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126',
    bytes: 816730,
  },
];

const PARAKEET_V3_DIR = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8';

/** Files the other person's language needs on this phone (none on iPhone). */
export function sttFilesFor(l: InterpretLanguage): ModelFile[] {
  if (Platform.OS !== 'android' || l.code === 'en') return [];
  return l.stt === 'whisper' ? WHISPER_FILES : [MODEL_FILES.speechToTextMulti];
}

export const sttBytes = (l: InterpretLanguage) => sttFilesFor(l).reduce((n, f) => n + f.bytes, 0);

export type VoiceState = 'ready' | 'download' | 'missing' | 'unknown';

export type InterpretState = {
  active: boolean;
  mine: InterpretLanguage;
  theirs: InterpretLanguage;
  turns: InterpretTurn[];
  /** The side whose mic is open. */
  listening: InterpretSide | null;
  /** What is happening now (shown on the speaker's side). */
  busy: 'hearing' | 'translating' | null;
  /** The translation as it streams in (for the side it is for). */
  live: string | null;
  /** Speech-to-text for the other language: ready, needs a download, downloading, or can't. */
  stt: 'ready' | 'download' | 'downloading' | 'unavailable';
  sttProgress: string | null;
  sttFraction: number;
  /** The phone's offline voices for both languages. */
  voices: Record<InterpretSide, VoiceState>;
  /** A plain message for the owner ("Spanish voice isn't installed…"), or null. */
  notice: string | null;
  /** Set when the model ended the session (STOP): the screen closes. */
  ended: boolean;
};

const english = interpretLanguage('en')!;

let state: InterpretState = {
  active: false,
  mine: english,
  theirs: interpretLanguage('es')!,
  turns: [],
  listening: null,
  busy: null,
  live: null,
  stt: 'ready',
  sttProgress: null,
  sttFraction: 0,
  voices: { me: 'unknown', them: 'unknown' },
  notice: null,
  ended: false,
};

const listeners = new Set<(s: InterpretState) => void>();
function set(patch: Partial<InterpretState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

export const interpreter = {
  get: () => state,
  subscribe(l: (s: InterpretState) => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Starts (or switches) a session with [theirs]; returns false for a language we don't offer. */
export function startInterpreter(theirsCode: string): boolean {
  const theirs = interpretLanguage(theirsCode);
  if (!theirs || theirs.code === 'en') return false;
  set({
    active: true,
    ended: false,
    mine: english,
    theirs,
    turns: state.active && state.theirs.code === theirs.code ? state.turns : [],
    listening: null,
    busy: null,
    live: null,
    notice: null,
  });
  void prepare();
  return true;
}

/**
 * The translate tool with `talk` (tools.ts): the model named the other person's language. Opens the interpreter
 * screen and returns what Sidekick says.
 */
export function openInterpreter(languageName: string): string {
  const l = languageFromName(languageName);
  if (!l) return `I can't interpret ${languageName || 'that language'} offline yet.`;
  if (l.code === 'en') return 'Which language does the other person speak?';
  startInterpreter(l.code);
  router.push('/interpret');
  return `Interpreting English and ${l.name}. Tap your mic to speak, and theirs for them.`;
}

/** Ends the session: frees the speech model, stops any voice. Nothing is kept. */
export function stopInterpreter() {
  Speech.stop().catch(() => {});
  if (state.listening) void SidekickNative.interpretHeard?.('main', '', '').catch(() => {});
  void SidekickNative.interpretUnload?.().catch(() => {});
  set({ active: false, turns: [], listening: null, busy: null, live: null, notice: null });
}

/** Checks the speech model and voices for this pair, and loads the chat model in the meantime. */
async function prepare() {
  const theirs = state.theirs;
  voiceList = null;
  void ensureLlm().catch(() => {});
  if (Platform.OS === 'ios') {
    const can = SidekickNative.interpretCanHear?.(theirs.tag) ?? false;
    set({ stt: can ? 'ready' : 'unavailable' });
  } else {
    const missing = sttFilesFor(theirs).filter((f) => !isDownloaded(f));
    set({ stt: missing.length ? 'download' : 'ready', sttProgress: null });
    if (!missing.length) keep(theirs);
    if (missing.length) {
      const net = await connection().catch(() => ({ wifi: false, online: false }));
      // On Wi-Fi it just starts; on mobile data or offline the screen says what's needed.
      if (net.wifi) void downloadStt();
    }
  }
  const [me, them] = await Promise.all([voiceState(english), voiceState(theirs)]);
  if (state.theirs.code !== theirs.code) return;
  set({ voices: { me, them } });
}

/** Remembers that [l]'s speech model belongs to the interpreter, so it isn't deleted. */
function keep(l: InterpretLanguage) {
  const kept = getSettings().interpreterLanguages ?? [];
  if (!kept.includes(l.code)) updateSettings({ interpreterLanguages: [...kept, l.code] });
}

/** Downloads the other language's speech model (Wi-Fi only unless the owner allows data). */
export async function downloadStt(allowMobile = false) {
  const theirs = state.theirs;
  const files = sttFilesFor(theirs).filter((f) => !isDownloaded(f));
  if (!files.length || state.stt === 'downloading') return;
  set({ stt: 'downloading', sttProgress: null });
  try {
    for (const f of files)
      await downloadFile(
        f,
        (text, fraction) => set({ sttProgress: text, sttFraction: fraction }),
        allowMobile ? false : wifiOnlyDownloads(),
      );
    keep(theirs);
    if (state.theirs.code === theirs.code) set({ stt: 'ready', sttProgress: null });
  } catch (e) {
    set({ stt: 'download', sttProgress: null, notice: `Download stopped: ${String(e)}` });
  }
}

/** The phone's offline voice for [l]. */
async function voiceState(l: InterpretLanguage): Promise<VoiceState> {
  try {
    if (Platform.OS === 'android') {
      const s = await SidekickNative.ttsVoiceStatus?.(l.tag);
      return s === 'ready' || s === 'download' || s === 'missing' ? s : 'unknown';
    }
    const voices = await Speech.getAvailableVoicesAsync();
    return voices.some((v) => v.language.toLowerCase().startsWith(l.code)) ? 'ready' : 'missing';
  } catch {
    return 'unknown';
  }
}

/** Opens the phone's voice downloads (Android); false where that isn't possible. */
export function openVoiceDownloads(): boolean {
  return SidekickNative.ttsInstallVoices?.() ?? false;
}

/** Re-checks the voices (after the owner came back from installing one). */
export async function recheckVoices() {
  voiceList = null;
  const [me, them] = await Promise.all([voiceState(state.mine), voiceState(state.theirs)]);
  set({ voices: { me, them } });
}

const langOf = (side: InterpretSide) => (side === 'me' ? state.mine : state.theirs);

/** Opens [side]'s mic. Tapping it again (or the other side's) ends the turn. */
export async function listen(side: InterpretSide) {
  if (!state.active || state.busy) return;
  if (state.listening) return finishTurn();
  if (side === 'them' && state.stt !== 'ready') return;
  if (!(await askMicPermission())) {
    set({ notice: 'Sidekick needs the microphone to hear you.' });
    return;
  }
  Speech.stop().catch(() => {});
  SidekickNative.interpretListen?.(langOf(side).tag);
  set({ listening: side, notice: null });
}

/** Ends the open turn: transcribe, translate, show and speak on the other side. */
export async function finishTurn() {
  const side = state.listening;
  if (!side) return;
  set({ listening: null, busy: 'hearing', live: null });
  const heardAt = Date.now();
  const from = langOf(side);
  let heard = '';
  try {
    const kind =
      Platform.OS !== 'android' || from.code === 'en'
        ? 'main'
        : from.stt === 'whisper'
          ? 'whisper'
          : 'parakeet';
    const dir = kind === 'whisper' ? WHISPER_DIR : kind === 'parakeet' ? PARAKEET_V3_DIR : '';
    heard = ((await SidekickNative.interpretHeard?.(kind, dir, from.code)) ?? '').trim();
  } catch (e) {
    set({
      busy: null,
      notice: `Couldn't hear that: ${e instanceof Error ? e.message : String(e)}`,
    });
    return;
  }
  if (!heard) {
    set({ busy: null, notice: "Didn't catch that. Tap the mic and try again." });
    return;
  }
  const turn: InterpretTurn = { side, heard, said: null, at: Date.now() };
  const recent = state.turns;
  set({ turns: [...recent, turn], busy: 'translating' });
  await translateTurn(turn, recent, Date.now() - heardAt);
}

/** Times of the last turn (logged; the Speed test reads them). */
export type TurnTiming = { hearMs: number; translateMs: number };

async function translateTurn(turn: InterpretTurn, recent: InterpretTurn[], hearMs: number) {
  const { mine, theirs } = state;
  const system = interpretSystem(mine, theirs);
  const t0 = Date.now();
  try {
    const reply = (
      await askLlm(
        turnPrompt(mine, theirs, turn.side, turn.heard, recent),
        null,
        (full) => {
          const live = partialTranslation(full);
          if (live && live !== state.live) set({ live });
        },
        { system, maxTokens: TURN_MAX_TOKENS, scratch: true },
      )
    ).text;
    if (!state.active) return;
    // The owner may have been talking to Sidekick ("that's enough, thanks"): the same reply says.
    const c = turn.side === 'me' ? parseControlReply(reply) : null;
    if (c) {
      const others = state.turns.filter((t) => t !== turn);
      if (c.kind === 'stop') {
        set({ turns: others, busy: null, live: null, ended: true });
        stopInterpreter();
        return;
      }
      const next = languageFromName(c.language);
      set({ turns: others, busy: null, live: null });
      if (next && next.code !== 'en' && next.code !== theirs.code) startInterpreter(next.code);
      else if (!next) set({ notice: `I can't interpret ${c.language} offline yet.` });
      return;
    }
    const said = parseTurnReply(reply, turn.heard);
    const timing: TurnTiming = { hearMs, translateMs: Date.now() - t0 };
    lastTiming = timing;
    console.log(`[interpret] ${JSON.stringify({ side: turn.side, lang: theirs.code, ...timing })}`);
    const others = state.turns.filter((t) => t !== turn);
    if (!said) {
      set({ turns: others, busy: null, live: null, notice: "Couldn't translate that. Try again." });
      return;
    }
    set({ turns: [...others, { ...turn, said }], busy: null, live: null });
    speak(said, turn.side === 'me' ? 'them' : 'me');
  } catch (e) {
    set({ busy: null, live: null, notice: `Couldn't translate: ${String(e)}` });
  }
}

let lastTiming: TurnTiming | null = null;
export const lastTurnTiming = () => lastTiming;

/** Speaks [text] for [side] in its language with the phone's own offline voice. */
function speak(text: string, side: InterpretSide) {
  if (state.voices[side] === 'missing') return;
  const l = langOf(side);
  const rate = getSettings().speechRate ?? 1.0;
  if (Platform.OS !== 'android') {
    Speech.speak(text, { language: l.tag, rate });
    return;
  }
  void phoneVoices().then((voices) => Speech.speak(text, { ...androidSpeech(l, voices), rate }));
}

let voiceList: Promise<Speech.Voice[]> | null = null;
/** The phone's voices, asked once per session (installing one means coming back to the screen). */
function phoneVoices(): Promise<Speech.Voice[]> {
  voiceList ??= Speech.getAvailableVoicesAsync().catch(() => []);
  return voiceList;
}

/** Says a turn again (tap on a translation). */
export function repeat(turn: InterpretTurn) {
  if (!turn.said) return;
  speak(turn.said, turn.side === 'me' ? 'them' : 'me');
}

/** Clears the notice line. */
export function dismissNotice() {
  set({ notice: null });
}

/** For the Done button and leaving the screen. */
export function cancelTurn() {
  if (state.busy === 'translating') cancelLlm();
}
