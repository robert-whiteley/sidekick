/**
 * "Draw me a fox reading a book": the model routes the request here (make_picture, tools-logic.ts)
 * with its own description, and ImageGen.kt draws it on the phone (SDXS-512, ~40 s on a Pixel 5).
 * Optional download, agreed to in Settings → Assistant → Make pictures (picture-terms.md). One
 * picture at a time; the chat's Stop button stops it. Pictures are kept in the app's own files
 * and the chat history (store.rememberPicture); Save copies one to the phone's gallery.
 */
import { Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { downloadFile, isDownloaded, modelPath, wifiOnlyDownloads } from './downloads';
import { unloadLlm } from './llm';
import { PICTURE_FILES } from './models';
import {
  PICTURE_BLOCKED,
  PICTURE_FAILED,
  PICTURE_GET,
  PICTURE_NO_CPU,
  PICTURE_NOT_HERE,
  PICTURE_STOPPED,
  pictureBlocked,
  pictureOffer,
  picturePrompt,
  pictureReply,
  pictureStatus,
} from './picture-logic';

export type PictureResult = {
  text: string;
  /** The new picture's file, when one was made. */
  path: string | null;
  /** What was drawn (for the Report draft). */
  prompt: string;
  ms: number;
  /** Offer the settings screen where the download is (not downloaded yet). */
  needsDownload?: boolean;
};

function cpuOk(): boolean {
  try {
    return SidekickNative.pictureSupported?.() ?? false;
  } catch {
    return false;
  }
}

/** Shown in Settings: whether this phone gets "Make pictures", and any note. */
export function pictureAvailability() {
  let ramMb = 0;
  try {
    ramMb = SidekickNative.getDeviceInfo().totalRamMb;
  } catch {
    // Unknown: offered.
  }
  return pictureOffer({ platform: Platform.OS, ramMb, cpuOk: cpuOk() });
}

export const pictureFilesReady = () =>
  isDownloaded(PICTURE_FILES.model) && isDownloaded(PICTURE_FILES.decoder);

export type PictureDownload = { text: string; fraction: number; error?: string; busy: boolean };
let dl: PictureDownload = { text: '', fraction: 0, busy: false };
const dlListeners = new Set<(d: PictureDownload) => void>();
const setDl = (d: PictureDownload) => {
  dl = d;
  dlListeners.forEach((l) => l(d));
};

/** The download's state, for the settings screen (it carries on if the screen is left). */
export function pictureDownload(): PictureDownload {
  return dl;
}
export function onPictureDownload(l: (d: PictureDownload) => void): () => void {
  dlListeners.add(l);
  return () => dlListeners.delete(l);
}

/** Downloads the picture model (the user agreed to picture-terms.md first). */
export async function downloadPictureModel(): Promise<void> {
  if (dl.busy) return;
  setDl({ text: 'Starting…', fraction: 0, busy: true });
  try {
    await downloadFile(PICTURE_FILES.decoder, () => {}, wifiOnlyDownloads());
    await downloadFile(
      PICTURE_FILES.model,
      (text, fraction, waiting) =>
        setDl({ text: waiting ? `${text} · waiting for Wi-Fi` : text, fraction, busy: true }),
      wifiOnlyDownloads(),
    );
    setDl({ text: '', fraction: 1, busy: false });
  } catch (e) {
    setDl({
      text: '',
      fraction: 0,
      busy: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Deletes the picture model (pictures already made stay). */
export async function deletePictureModel(): Promise<void> {
  await SidekickNative.pictureUnload?.().catch(() => false);
  for (const f of Object.values(PICTURE_FILES)) SidekickNative.deleteFile(modelPath(f));
}

let running = false;
let stopped = false;

/** The Stop button. */
export function stopPicture() {
  if (!running) return;
  stopped = true;
  try {
    SidekickNative.pictureStop?.();
  } catch {
    // Not running any more.
  }
}

/** Draws what the model described ([described]) for [question]. */
export async function makePicture(
  question: string,
  described: string,
  onStatus: (line: string) => void,
): Promise<PictureResult> {
  const t0 = Date.now();
  const prompt = picturePrompt(described, question);
  const res = (text: string, extra: Partial<PictureResult> = {}): PictureResult => ({
    text,
    path: null,
    prompt,
    ms: Date.now() - t0,
    ...extra,
  });
  if (!SidekickNative.pictureMake) return res(PICTURE_NOT_HERE);
  if (pictureBlocked(question, prompt)) return res(PICTURE_BLOCKED);
  if (!cpuOk()) return res(PICTURE_NO_CPU);
  if (!pictureFilesReady()) return res(PICTURE_GET, { needsDownload: true });
  if (running) return res('Already making a picture; one at a time.');
  running = true;
  stopped = false;
  onStatus('Getting ready to draw…');
  const sub = SidekickNative.addListener('onPicture', (e) =>
    onStatus(pictureStatus(e.stage, e.done, e.total)),
  );
  try {
    // The picture model needs ~1.1 GB while drawing. The memory-search model always makes room;
    // the chat model too on phones under 8 GB (it loads again for the next question).
    await SidekickNative.embedUnload().catch(() => {});
    if (SidekickNative.getDeviceInfo().totalRamMb < 7000) await unloadLlm().catch(() => {});
    const r = await SidekickNative.pictureMake(
      modelPath(PICTURE_FILES.model),
      modelPath(PICTURE_FILES.decoder),
      prompt,
      Math.floor(Math.random() * 2 ** 31),
    );
    console.log(`[picture] ${r.width}x${r.height} in ${r.ms} ms`);
    return res(pictureReply(prompt, r.ms), { path: r.path });
  } catch (e) {
    console.log(`[picture] failed: ${String(e)}`);
    return res(stopped || /cancel/i.test(String(e)) ? PICTURE_STOPPED : PICTURE_FAILED);
  } finally {
    sub.remove();
    running = false;
  }
}
