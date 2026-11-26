/**
 * Light photo edits for a photo sent with a request: the model picks the edit_photo tool and its
 * arguments (decide.ts, photo-edit-logic.ts), PhotoEdit.kt makes a new file, and the chat shows
 * it with Share / Save. The background model (4.6 MB) is downloaded the first time it is needed.
 */
import SidekickNative from '../../modules/sidekick-native';
import { downloadFile, isDownloaded, modelPath } from './downloads';
import { PHOTO_SEG_FILE } from './models';
import {
  EDIT_FOOTER,
  EDIT_NOT_HERE,
  editReply,
  needsSegModel,
  type EditCall,
} from './photo-edit-logic';

export type EditResult = { text: string; path: string | null; ms: number; op?: string };

/** [edit] made on a new copy of [photo]. */
export async function runPhotoEdit(
  edit: EditCall,
  photo: string,
  onStatus: (line: string) => void,
): Promise<EditResult> {
  const t0 = Date.now();
  if (!SidekickNative.photoEdit) return { text: EDIT_NOT_HERE, path: null, ms: Date.now() - t0 };
  let seg: string | null = null;
  if (needsSegModel(edit)) {
    if (!isDownloaded(PHOTO_SEG_FILE)) {
      onStatus('Getting the background tool (5 MB, once)…');
      try {
        await downloadFile(PHOTO_SEG_FILE, () => {});
      } catch {
        return {
          text: "I couldn't download the background tool (5 MB). Check the internet and try again.",
          path: null,
          ms: Date.now() - t0,
        };
      }
    }
    seg = modelPath(PHOTO_SEG_FILE);
  }
  onStatus('Editing the photo…');
  try {
    const r = await SidekickNative.photoEdit(photo, edit.op, edit.args, seg);
    console.log(`[photo-edit] done in ${r.ms} ms (mask ${r.segMs} ms), ${r.width}x${r.height}`);
    return { text: editReply(edit) + EDIT_FOOTER, path: r.path, ms: Date.now() - t0, op: edit.op };
  } catch (e) {
    console.log(`[photo-edit] failed: ${String(e)}`);
    return { text: "Sorry, I couldn't edit that photo.", path: null, ms: Date.now() - t0 };
  }
}
