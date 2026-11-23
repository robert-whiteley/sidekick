import SidekickNative from '../../modules/sidekick-native';
import { formatProgress, type ModelFile } from './models';
import { modelsDir } from './paths';

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
  onProgress: (text: string, fraction: number) => void,
  wifiOnly = false,
): Promise<void> {
  if (isDownloaded(f)) return;
  const dest = modelPath(f);
  const id = SidekickNative.downloadStart(f.url, dest, `Sidekick: ${f.name}`, wifiOnly);
  let status: 'done' | 'failed';
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = SidekickNative.downloadStatus(id);
    const total = st.total > 0 ? st.total : f.bytes;
    onProgress(formatProgress(st.bytes, total), Math.min(1, st.bytes / total));
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
