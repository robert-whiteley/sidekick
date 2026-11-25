import { Directory, File } from 'expo-file-system';
import * as Updates from 'expo-updates';

import SidekickNative from '../../modules/sidekick-native';
import { deleteEverything, exportEverything } from '@/memory/store';
import { forgetConversation } from './assistant';
import { dataDir, modelsDir } from './paths';
import { mediaDirs } from './storage-monitor';

/**
 * Export everything to a folder the user picks, and Delete all data (docs/PLAN-v2.md "Quality
 * of life", "Uninstall").
 *
 * Where things live (all removed by Android on uninstall, with allowBackup off): memories,
 * photos, audio, video and the journal in internal app storage (filesDir/data), the database in
 * the app's databases folder, settings in its shared preferences, and the re-downloadable
 * models in the app-specific external folder (Android/data/<app>/files/models). Only what the
 * user exported or saved to shared folders stays.
 */

export function exportFolderName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Sidekick export ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}${p(now.getMinutes())}`;
}

export type ExportResult = { folder: string; files: number } | null;

/**
 * Asks for a folder (the system picker), then writes into a new "Sidekick export <date>" folder
 * there: memory.zip (all text, people, facts, follow-ups as JSON plus the photos) and the video,
 * stills and audio files. Null if the user closed the picker.
 */
export async function exportAllData(): Promise<ExportResult> {
  let target: Directory;
  try {
    target = await Directory.pickDirectoryAsync();
  } catch {
    return null;
  }
  const zipPath = await exportEverything();
  const name = exportFolderName();
  const out = target.createDirectory(name);
  let files = 0;
  const zip = new File(`file://${zipPath}`);
  try {
    await zip.copy(out);
    files++;
  } finally {
    SidekickNative.deleteFile(zipPath);
  }
  for (const [kind, dir] of Object.entries(mediaDirs())) {
    const src = new Directory(`file://${dir}`);
    if (!src.exists) continue;
    const dst = out.createDirectory(kind);
    const copyAll = async (d: Directory, to: Directory) => {
      for (const e of d.list()) {
        if (e instanceof Directory) await copyAll(e, to.createDirectory(e.name));
        else {
          await e.copy(to);
          files++;
        }
      }
    };
    await copyAll(src, dst);
  }
  return { folder: name, files };
}

/**
 * Deletes everything Sidekick keeps: memories, people, media, settings and the downloaded
 * models, as an uninstall would. On Android the system does it (and closes the app; opening it
 * again starts the first run). Elsewhere the files and database are cleared and the app restarts.
 */
export async function deleteAllData(): Promise<void> {
  try {
    SidekickNative.listenStop();
  } catch {
    // Not listening.
  }
  forgetConversation();
  await SidekickNative.llmUnload().catch(() => {});
  await SidekickNative.embedUnload().catch(() => {});
  if (SidekickNative.wipeAllData?.()) return;
  await deleteEverything();
  SidekickNative.deleteFile(dataDir());
  SidekickNative.deleteFile(modelsDir());
  SidekickNative.deleteFile(`${SidekickNative.getDeviceInfo().filesDir}/exports`);
  await Updates.reloadAsync().catch(() => {});
}
