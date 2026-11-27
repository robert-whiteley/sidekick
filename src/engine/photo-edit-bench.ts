/**
 * Dev-only photo-edit bench (sidekick://bench?run=photo-edit): a made-up photo pushed by adb to
 * the app's external files folder as `bench-photo.jpg`, edited for each request below (the
 * app's path: the sorter with the photo, then the edit's arguments). The upscale requests use
 * `bench-photo-small.jpg` (up to 1024 px) when it is there. Logs the edit the model picked, the time and the new file (`[photo-edit-bench] {...}`). The bench deletes
 * the new files at the end; the pushed photo is deleted by adb.
 */
import SidekickNative from '../../modules/sidekick-native';
import { decideRequest } from './decide';
import { runPhotoEdit } from './photo-edit';
import { editCall } from './photo-edit-logic';
import { fillTool } from './tools';

/** Request → the edit it should give (null: a question, answered normally). */
export const PHOTO_EDIT_CASES: [string, string | null][] = [
  ['make the background white', 'background'],
  ['remove the background', 'background'],
  ['blur the background', 'background'],
  ['make the background blue', 'background'],
  ['turn it the right way up', 'rotate'],
  ['rotate it to the left', 'rotate'],
  ['crop it square', 'crop'],
  ['make it black and white', 'grayscale'],
  ['can you brighten this up', 'enhance'],
  ['mirror it', 'flip'],
  ['remove the cup from the photo', 'erase'],
  ['get rid of the person on the left', 'erase'],
  ['upscale this', 'upscale'],
  ['make it bigger and sharper', 'upscale'],
  ['what is in the background?', null],
  ['is this photo blurry?', null],
];

type Log = (line: string) => void;

export async function runPhotoEditBench(log: Log, dir: string): Promise<void> {
  const photo = `${dir}/bench-photo.jpg`;
  const small = `${dir}/bench-photo-small.jpg`;
  if (!SidekickNative.fileExists(photo)) {
    log(`[photo-edit-bench] no ${photo}`);
    return;
  }
  let right = 0;
  const made: string[] = [];
  for (const [q, want] of PHOTO_EDIT_CASES) {
    const t0 = Date.now();
    const d = await decideRequest(q, { photo: true }).catch(() => null);
    const fill =
      d?.decision.kind === 'do' && d.decision.tool === 'edit_photo'
        ? await fillTool(q, 'edit_photo').catch(() => null)
        : null;
    const edit = fill && !fill.error && fill.tool === 'edit_photo' ? editCall(fill.args) : null;
    // Upscaling is for pictures up to 1024 px: those cases use a small copy when one is pushed.
    const src = want === 'upscale' && SidekickNative.fileExists(small) ? small : photo;
    const r = edit ? await runPhotoEdit(edit, src, () => {}).catch(() => null) : null;
    // Erase answers with the brush-screen button rather than a file.
    const ok = want === null ? !r : (!!r?.path || !!r?.link) && r?.op === want;
    if (ok) right++;
    if (r?.path) made.push(r.path);
    log(
      `[photo-edit-bench] ${JSON.stringify({ q, want, got: r?.op ?? null, ok, ms: Date.now() - t0, decided: d?.reply ?? null, fill: fill ? { tool: fill.tool, error: fill.error, args: fill.args, reply: fill.reply } : null, reply: r?.text ?? null, path: r?.path ?? null })}`,
    );
  }
  log(`[photo-edit-bench] summary ${JSON.stringify({ cases: PHOTO_EDIT_CASES.length, right })}`);
  // Copies for a look on the laptop, then the app's own copies go.
  for (const [i, p] of made.entries()) {
    const ext = p.endsWith('.png') ? 'png' : 'jpg';
    try {
      SidekickNative.copyFile(p, `${dir}/bench-edit-${i}.${ext}`);
    } catch {}
    try {
      SidekickNative.deleteFile(p);
    } catch {}
  }
}
