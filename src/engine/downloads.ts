import { getNetworkStateAsync, NetworkStateType } from 'expo-network';

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
