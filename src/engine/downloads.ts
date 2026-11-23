import SidekickNative from '../../modules/sidekick-native';
import { formatProgress, type ModelFile } from './models';
import { modelsDir } from './paths';

export function modelPath(f: ModelFile): string {
  return `${modelsDir()}/${f.name}`;
}

export function isDownloaded(f: ModelFile): boolean {
  return SidekickNative.fileExists(modelPath(f));
}

/**
 * Downloads [f] with the system download manager (survives the app closing), then checks its
 * SHA-256 before it is ever used.
 */
export async function downloadFile(
  f: ModelFile,
  onProgress: (text: string, fraction: number) => void,
  wifiOnly = false,
): Promise<void> {
  const dest = modelPath(f);
  if (SidekickNative.fileExists(dest)) return;
  const id = SidekickNative.downloadStart(f.url, dest, `Sidekick: ${f.name}`, wifiOnly);
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = SidekickNative.downloadStatus(id);
    const total = st.total > 0 ? st.total : f.bytes;
    onProgress(formatProgress(st.bytes, total), Math.min(1, st.bytes / total));
    if (st.status === 'failed') throw new Error(`Download failed (reason ${st.reason})`);
    if (st.status === 'done') break;
  }
  onProgress('Checking file…', 1);
  if (!(await SidekickNative.downloadFinish(dest, f.sha256))) {
    throw new Error(`${f.name} was corrupt and has been deleted; please try again`);
  }
}
