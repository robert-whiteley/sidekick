import { Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { postCodeCards, scanCodes } from './codes';
import { describeCode } from './codes-logic';
import { addWatch, currentWatches, removeWatches } from './focus-watch';
import { listWatches, looksLikeName, matchWatches } from './focus-logic';
import { isListening, startListening, stopListening } from './listen';
import { liveCameraOn, pauseLiveCamera, startLiveCamera, stopLiveCamera } from './live-camera';
import { locationMemoryOn } from './location-track';
import { getSettings, updateSettings } from './settings';
import {
  helpText,
  nextRate,
  parseVoiceCommand,
  rateReply,
  type VoiceCommand,
} from './voice-commands-logic';
import { latestFramePaths } from '@/memory/frames';
import { isOn } from '@/integrations/prefs';

/**
 * Runs the short commands of voice-commands-logic.ts (no model): speech speed, repeat, help,
 * listening and camera on/off, camera watches and "scan this". The reply is
 * shown and, when the question was spoken, said like any answer.
 */

let lastAnswer = '';
const listeningListeners = new Set<(on: boolean) => void>();

/** Wraps an answer's onText so "repeat that" has the last answer. */
export function trackAnswer(onText: (full: string) => void): (full: string) => void {
  return (full) => {
    if (full.trim()) lastAnswer = full;
    onText(full);
  };
}

/** Listening turned on or off by voice (the Ask screen follows it). */
export function onListeningByVoice(l: (on: boolean) => void): () => void {
  listeningListeners.add(l);
  return () => listeningListeners.delete(l);
}

/** Hands the saved speech speed to the native voice (call at start-up and on change). */
export function applySpeechRate() {
  if (Platform.OS !== 'android') return;
  try {
    SidekickNative.voiceSetRate?.(getSettings().speechRate ?? 1);
  } catch {
    // Older native module: normal speed.
  }
}

/**
 * The reply for a command in [question], or null when it isn't one. [photoNow]: the photo taken
 * with the question (used by "scan this").
 */
export async function runVoiceCommand(
  question: string,
  photoNow: string | null,
): Promise<string | null> {
  const cmd = parseVoiceCommand(question);
  if (!cmd) return null;
  return execute(cmd, question, photoNow);
}

/** Runs an already-parsed command (the tool router picks these too). */
export const runParsedCommand = (cmd: VoiceCommand, question: string, photoNow: string | null) =>
  execute(cmd, question, photoNow);

async function execute(
  cmd: VoiceCommand,
  question: string,
  photoNow: string | null,
): Promise<string | null> {
  switch (cmd.type) {
    case 'speed': {
      const rate = nextRate(getSettings().speechRate ?? 1, cmd.rate);
      updateSettings({ speechRate: rate === 1 ? null : rate });
      applySpeechRate();
      return rateReply(rate);
    }
    case 'repeat':
      return lastAnswer || "I haven't said anything yet.";
    case 'help':
      return helpText({
        camera: Platform.OS === 'android',
        listening: Platform.OS === 'android' && isListening(),
        memory: true,
        calendar: isOn('calendar', 'read'),
        messages: isOn('messages', 'read'),
        email: isOn('email', 'send'),
        online: getSettings().webLookup,
        location: safe(locationMemoryOn),
      });
    case 'listening': {
      if (Platform.OS !== 'android') return 'Listening in the background needs Android.';
      if (!cmd.on) {
        if (!isListening()) return "I'm not listening.";
        stopListening();
        listeningListeners.forEach((l) => l(false));
        return 'OK, I\'ve stopped listening. Say "start listening" or tap Listen to turn it back on.';
      }
      if (isListening()) return "I'm already listening.";
      const err = await startListening();
      if (err) return err;
      listeningListeners.forEach((l) => l(true));
      return `Listening for "${getSettings().wakePhrase}".`;
    }
    case 'camera': {
      if (Platform.OS !== 'android') return 'The live camera needs Android.';
      // Pause / resume keep the service, so they also work with the phone locked.
      if (cmd.pause && liveCameraOn()) {
        pauseLiveCamera(!cmd.on);
        return cmd.on ? 'Camera on again.' : 'Camera paused. Say "resume the camera" to carry on.';
      }
      if (!cmd.on) {
        if (!liveCameraOn()) return 'The camera is already off.';
        stopLiveCamera();
        return 'Camera off.';
      }
      if (liveCameraOn()) {
        pauseLiveCamera(false); // in case it was paused
        return 'The camera is on.';
      }
      return startLiveCamera() ? 'Camera on.' : 'Tap the camera button to turn it on.';
    }
    case 'watch': {
      const original = originalWords(question, cmd.what);
      if (looksLikeName(original))
        return `I can't recognise people by their face, so I can't watch for ${original}. I can watch for things like "a red car" or "the number 12 bus".`;
      const reply = await addWatch(cmd.what, cmd.every);
      return Platform.OS === 'android' && !liveCameraOn()
        ? `${reply} Turn the camera on so I can see.`
        : reply;
    }
    case 'unwatch': {
      const found = matchWatches(currentWatches(), cmd.what);
      if (!found.length)
        return cmd.what ? `I wasn't watching for ${cmd.what}.` : "I'm not watching for anything.";
      removeWatches(found.map((w) => w.id));
      return `OK, stopped watching for ${found.map((w) => w.what).join(' and ')}.`;
    }
    case 'watchList':
      return listWatches(currentWatches());
    case 'scan': {
      const path = photoNow ?? latestFramePaths(1)[0] ?? null;
      if (!path) return 'Point the camera at the code, then say "scan this".';
      const codes = await scanCodes(path);
      if (!codes.length) return "I can't find a QR code or barcode. Hold it closer and steadier.";
      postCodeCards(codes);
      return codes.map((c) => describeCode(c).text).join(' ');
    }
  }
}

function safe(f: () => boolean): boolean {
  try {
    return f();
  } catch {
    return false;
  }
}

/** The watched words with their original capitals ("Sam", not "sam"). */
function originalWords(question: string, what: string): string {
  const i = question.toLowerCase().lastIndexOf(what);
  return i >= 0 ? question.slice(i, i + what.length) : what;
}
