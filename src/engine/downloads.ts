import { Directory, File } from 'expo-file-system';
import { getNetworkStateAsync, NetworkStateType } from 'expo-network';
import { Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { batteryState } from './battery';
import { formatProgress, type ModelFile } from './models';
import { modelsDir } from './paths';
import { getSettings } from './settings';

/** Wi-Fi (or cable) vs mobile data, online at all, and charging. Safe defaults on error. */
export async function connection(): Promise<{ wifi: boolean; online: boolean; charging: boolean }> {
  const [net, bat] = await Promise.all([getNetworkStateAsync().catch(() => null), batteryState()]);
  const wifi = net?.type === NetworkStateType.WIFI || net?.type === NetworkStateType.ETHERNET;
  return { wifi, online: !!net?.isConnected, charging: bat.charging };
}

let mobileDataOk = false;

/** The user said "Download now" on mobile data (this app session only). */
export function allowMobileDataOnce() {
  mobileDataOk = true;
}

/** Big downloads wait for Wi-Fi unless the user allowed mobile data (setting or just now). */
export function wifiOnlyDownloads(): boolean {
  if (mobileDataOk) return false;
  return (getSettings().mobileDataDownloads ?? 'ask') !== 'auto';
}

/** Thrown when a download was stopped on purpose (e.g. to restart it on mobile data). */
export class DownloadCancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

export function modelPath(f: ModelFile): string {
  return `${modelsDir()}/${f.name}`;
}

export function isDownloaded(f: ModelFile): boolean {
  if (f.unpackedCheck) return SidekickNative.fileExists(`${modelsDir()}/${f.unpackedCheck}`);
  return SidekickNative.fileExists(modelPath(f));
}

/** What to do after the system download stops: resume it ourselves a few times, then give up. */
export function afterSystemDownload(
  status: 'done' | 'failed',
  resumeAttempts: number,
  maxAttempts = 3,
): 'verify' | 'resume' | 'fail' {
  if (status === 'done') return 'verify';
  return resumeAttempts < maxAttempts ? 'resume' : 'fail';
}

/**
 * Downloads [f] with the system download manager (survives the app closing; reopening the app
 * picks the same job back up). If it gives up, the partial file is continued with HTTP Range
 * requests. The SHA-256 is always checked before the file is used.
 */
export async function downloadFile(
  f: ModelFile,
  onProgress: (text: string, fraction: number, waiting?: boolean) => void,
  wifiOnly = false,
  cancelled: () => boolean = () => false,
): Promise<void> {
  if (isDownloaded(f)) return;
  if (Platform.OS === 'ios') return downloadFileIos(f, onProgress, wifiOnly, cancelled);
  const dest = modelPath(f);
  const id = SidekickNative.downloadStart(f.url, dest, `Sidekick: ${f.name}`, wifiOnly);
  let status: 'done' | 'failed';
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    if (cancelled()) {
      SidekickNative.downloadCancel(id);
      throw new DownloadCancelled();
    }
    const st = SidekickNative.downloadStatus(id);
    const total = st.total > 0 ? st.total : f.bytes;
    // Paused/pending = the system is waiting for a network it may use (e.g. Wi-Fi).
    const waiting = st.status === 'paused' || st.status === 'pending';
    onProgress(formatProgress(st.bytes, total), Math.min(1, st.bytes / total), waiting);
    if (st.status === 'failed' || st.status === 'done') {
      status = st.status;
      if (st.status === 'failed')
        console.log(`[download] ${f.name}: system download failed (${st.reason})`);
      break;
    }
  }
  for (let attempt = 0; ; attempt++) {
    const step = afterSystemDownload(status, attempt);
    if (step === 'verify') break;
    if (step === 'fail') throw new Error(`${f.name} could not be downloaded; please try again`);
    const timer = setInterval(() => {
      const got = SidekickNative.downloadPartBytes(dest);
      onProgress(formatProgress(got, f.bytes), Math.min(1, got / f.bytes));
    }, 1000);
    try {
      await SidekickNative.downloadResume(f.url, dest);
      status = 'done';
    } catch (e) {
      console.log(`[download] ${f.name}: resume failed: ${String(e)}`);
      await new Promise((r) => setTimeout(r, 3000));
    } finally {
      clearInterval(timer);
    }
  }
  onProgress('Checking file…', 1);
  if (!(await SidekickNative.downloadFinish(dest, f.sha256))) {
    throw new Error(`${f.name} was corrupt and has been deleted; please try again`);
  }
  if (f.unpackedCheck) {
    onProgress('Unpacking…', 1);
    await SidekickNative.extractTarBz2(dest, modelsDir());
  }
}

/** iPhone: may the transfer run on this network right now? (Wi-Fi-only waits for Wi-Fi.) */
export function mayDownloadOn(net: { wifi: boolean; online: boolean }, wifiOnly: boolean): boolean {
  return net.online && (!wifiOnly || net.wifi);
}

function fileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

const sleep = (ms: number) => new Promise<'tick'>((r) => setTimeout(() => r('tick'), ms));

/**
 * iPhone: downloads [f] with iOS's background transfer (expo-file-system), so it carries on while
 * Sidekick is in the background. Wi-Fi-only pauses it off Wi-Fi and resumes on Wi-Fi. The file
 * lands as "<name>.part" and is only moved into place once its SHA-256 matches (downloadFinish).
 */
async function downloadFileIos(
  f: ModelFile,
  onProgress: (text: string, fraction: number, waiting?: boolean) => void,
  wifiOnly: boolean,
  cancelled: () => boolean,
): Promise<void> {
  const dest = modelPath(f);
  new Directory(fileUri(modelsDir())).create({ intermediates: true, idempotent: true });
  const part = new File(fileUri(`${dest}.part`));
  for (let attempt = 0; ; attempt++) {
    if (part.exists) part.delete();
    let bytes = 0;
    let total = f.bytes;
    const report = (waiting: boolean) =>
      onProgress(formatProgress(bytes, total), Math.min(1, bytes / total), waiting);
    const task = File.createDownloadTask(f.url, part, {
      sessionType: 'background',
      onProgress: (p) => {
        bytes = p.bytesWritten;
        if (p.totalBytes > 0) total = p.totalBytes;
        report(false);
      },
    });
    let started = false;
    let paused = false;
    let result: Promise<File | null> | null = null;
    try {
      for (;;) {
        if (cancelled()) {
          task.cancel();
          throw new DownloadCancelled();
        }
        if (!mayDownloadOn(await connection(), wifiOnly)) {
          if (started && !paused) {
            await task.pauseAsync();
            paused = true;
            result = null;
          }
          report(true);
          await sleep(2000);
          continue;
        }
        if (!started) {
          started = true;
          result = task.downloadAsync();
        } else if (paused || !result) {
          paused = false;
          result = task.resumeAsync();
        }
        const r = await Promise.race([result, sleep(2000)]);
        if (r === 'tick') continue;
        if (r) break;
        // Null: the transfer paused itself; resume it on the next pass.
        paused = true;
        result = null;
      }
      break;
    } catch (e) {
      if (e instanceof DownloadCancelled) throw e;
      console.log(`[download] ${f.name}: attempt ${attempt + 1} failed: ${String(e)}`);
      if (afterSystemDownload('failed', attempt) === 'fail')
        throw new Error(`${f.name} could not be downloaded; please try again`);
      await sleep(3000);
    }
  }
  onProgress('Checking file…', 1);
  if (!(await SidekickNative.downloadFinish(dest, f.sha256))) {
    throw new Error(`${f.name} was corrupt and has been deleted; please try again`);
  }
}

export type Progress = {
  bytes: number;
  total: number;
  /** Seconds left at the recent speed, or null while unknown. */
  secondsLeft: number | null;
  waiting: boolean;
  text: string;
};

/** Smooths the download speed so "time left" doesn't jump about. */
export class Eta {
  private rate = 0;
  private last: { at: number; bytes: number } | null = null;

  update(bytes: number, total: number, now: number): number | null {
    if (this.last && now > this.last.at) {
      const r = ((bytes - this.last.bytes) * 1000) / (now - this.last.at);
      if (r >= 0) this.rate = this.rate > 0 ? this.rate * 0.85 + r * 0.15 : r;
    }
    this.last = { at: now, bytes };
    if (this.rate <= 0) return null;
    return Math.max(0, (total - bytes) / this.rate);
  }
}

/** "About 12 minutes left" */
export function formatTimeLeft(s: number | null): string {
  if (s == null) return 'Working out time left…';
  if (s < 60) return 'Less than a minute left';
  const m = Math.round(s / 60);
  if (m < 60) return `About ${m} minute${m === 1 ? '' : 's'} left`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `About ${h} h ${rest} min left`;
}

/**
 * Downloads several files at once (the system queue runs them in parallel) with one combined
 * progress and time left.
 */
export async function downloadAll(
  files: ModelFile[],
  onProgress: (p: Progress) => void,
  wifiOnly: boolean,
  cancelled: () => boolean = () => false,
): Promise<void> {
  const total = files.reduce((n, f) => n + f.bytes, 0);
  const got = new Map<string, number>();
  const waiting = new Map<string, boolean>();
  const eta = new Eta();
  let text = '';
  const emit = () => {
    const bytes = [...got.values()].reduce((a, b) => a + b, 0);
    onProgress({
      bytes,
      total,
      secondsLeft: eta.update(bytes, total, Date.now()),
      waiting: [...waiting.values()].some(Boolean) && bytes < total,
      text,
    });
  };
  await Promise.all(
    files.map((f) =>
      downloadFile(
        f,
        (t, fraction, w) => {
          got.set(f.name, fraction * f.bytes);
          waiting.set(f.name, !!w && fraction < 1);
          if (t === 'Checking file…' || t === 'Unpacking…') text = t;
          emit();
        },
        wifiOnly,
        cancelled,
      ).then(() => {
        got.set(f.name, f.bytes);
        waiting.set(f.name, false);
        emit();
      }),
    ),
  );
}
