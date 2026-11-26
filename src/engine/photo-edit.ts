/**
 * Light photo edits for a photo sent with a request: the model picks the edit_photo tool and its
 * arguments (decide.ts, photo-edit-logic.ts), PhotoEdit.kt makes a new file, and the chat shows
 * it with Share / Save. The small models (background 5 MB, erase 28 MB, upscale 5 MB) are
 * downloaded the first time each is needed. Erasing needs the user to point at the object: the
 * chat answers with a button to the brush screen (src/app/erase.tsx), which calls [erasePhoto].
 */
import SidekickNative from '../../modules/sidekick-native';
import { downloadFile, isDownloaded, modelPath } from './downloads';
import { ERASE_FILE, type ModelFile, PHOTO_SEG_FILE, UPSCALE_FILE } from './models';
import {
  EDIT_FOOTER,
  EDIT_NOT_HERE,
  ERASE_ASK,
  ERASE_BUTTON,
  editModel,
  editReply,
  upscaleRefusal,
  type EditCall,
} from './photo-edit-logic';

export type EditResult = {
  text: string;
  path: string | null;
  ms: number;
  op?: string;
  /** A button under the answer (the erase brush screen). */
  link?: { label: string; href: string };
};

const TOOL_FILES: Record<'background' | 'erase' | 'upscale', { file: ModelFile; label: string }> = {
  background: { file: PHOTO_SEG_FILE, label: 'the background tool (5 MB, once)' },
  erase: { file: ERASE_FILE, label: 'the erase tool (28 MB, once)' },
  upscale: { file: UPSCALE_FILE, label: 'the upscale tool (5 MB, once)' },
};

/** The tool's model file, downloaded if needed; null when it can't be. */
async function toolFile(
  which: keyof typeof TOOL_FILES,
  onStatus: (line: string) => void,
): Promise<string | null> {
  const t = TOOL_FILES[which];
  if (!isDownloaded(t.file)) {
    onStatus(`Getting ${t.label}…`);
    try {
      await downloadFile(t.file, () => {});
    } catch {
      return null;
    }
  }
  return modelPath(t.file);
}

/** [edit] made on a new copy of [photo]; erase answers with the brush-screen button. */
export async function runPhotoEdit(
  edit: EditCall,
  photo: string,
  onStatus: (line: string) => void,
): Promise<EditResult> {
  const t0 = Date.now();
  if (!SidekickNative.photoEdit) return { text: EDIT_NOT_HERE, path: null, ms: Date.now() - t0 };
  if (edit.op === 'erase')
    return {
      text: ERASE_ASK,
      path: null,
      ms: Date.now() - t0,
      op: 'erase',
      link: { label: ERASE_BUTTON, href: `/erase?photo=${encodeURIComponent(photo)}` },
    };
  const which = editModel(edit);
  let model: string | null = null;
  if (which) {
    model = await toolFile(which, onStatus);
    if (!model)
      return {
        text: `I couldn't download ${TOOL_FILES[which].label.replace(/ \(.*/, '')}. Check the internet and try again.`,
        path: null,
        ms: Date.now() - t0,
      };
  }
  onStatus(edit.op === 'upscale' ? 'Making it bigger…' : 'Editing the photo…');
  try {
    const r = await SidekickNative.photoEdit(photo, edit.op, edit.args, model);
    console.log(`[photo-edit] done in ${r.ms} ms (model ${r.segMs} ms), ${r.width}x${r.height}`);
    return { text: editReply(edit) + EDIT_FOOTER, path: r.path, ms: Date.now() - t0, op: edit.op };
  } catch (e) {
    console.log(`[photo-edit] failed: ${String(e)}`);
    return {
      text: upscaleRefusal(String(e)) ?? "Sorry, I couldn't edit that photo.",
      path: null,
      ms: Date.now() - t0,
    };
  }
}

/**
 * The brush screen's erase: [strokes] are flat x,y lists in 0..1 of the photo, [radius] the brush
 * radius as a fraction of the shorter edge. Resolves with the new file.
 */
export async function erasePhoto(
  photo: string,
  strokes: number[][],
  radius: number,
  onStatus: (line: string) => void,
): Promise<{ path: string; ms: number }> {
  if (!SidekickNative.photoEdit) throw new Error(EDIT_NOT_HERE);
  const model = await toolFile('erase', onStatus);
  if (!model)
    throw new Error("Couldn't download the erase tool. Check the internet and try again.");
  onStatus('Filling it in…');
  const r = await SidekickNative.photoEdit(photo, 'erase', { strokes, radius }, model);
  console.log(`[photo-edit] erase ${r.width}x${r.height} in ${r.ms} ms (model ${r.segMs} ms)`);
  return { path: r.path, ms: r.ms };
}
