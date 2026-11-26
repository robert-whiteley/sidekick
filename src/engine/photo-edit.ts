/**
 * Light photo edits for a photo sent with a request: the model reads the request and picks the
 * edit (photo-edit-logic.ts), PhotoEdit.kt makes a new file, and the chat shows it with Share /
 * Save. The background model (4.6 MB) is downloaded the first time it is needed.
 */
import SidekickNative from '../../modules/sidekick-native';
import { downloadFile, isDownloaded, modelPath } from './downloads';
import { askLlm } from './llm';
import { PHOTO_SEG_FILE } from './models';
import {
  EDIT_FOOTER,
  EDIT_NOT_HERE,
  editPrompt,
  editReply,
  mightBeEdit,
  needsSegModel,
  parseEditReply,
} from './photo-edit-logic';
import { ROUTER_SYSTEM } from './tools-logic';

export type EditResult = { text: string; path: string | null; ms: number; op?: string };

/**
 * The edit asked for with [photo], done; null when the request isn't an edit (then the normal
 * photo answer runs).
 */
export async function maybeEditPhoto(
  question: string,
  photo: string,
  onStatus: (line: string) => void,
): Promise<EditResult | null> {
  if (!mightBeEdit(question)) return null;
  const t0 = Date.now();
  const reply = await askLlm(editPrompt(question, new Date()), null, () => {}, {
    system: ROUTER_SYSTEM,
    maxTokens: 80,
    scratch: true,
  })
    .then((r) => r.text)
    .catch(() => '');
  const edit = parseEditReply(reply);
  console.log(
    `[photo-edit] ${edit ? `${edit.op} ${JSON.stringify(edit.args)}` : 'no edit'} (${Date.now() - t0} ms)`,
  );
  if (!edit) return null;
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
