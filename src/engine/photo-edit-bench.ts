/**
 * Dev-only photo-edit bench (sidekick://bench?run=photo-edit): a made-up photo pushed by adb to
 * the app's external files folder as `bench-photo.jpg`, edited for each request below. Logs the
 * edit the model picked, the time and the new file (`[photo-edit-bench] {...}`). The bench deletes
 * the new files at the end; the pushed photo is deleted by adb.
 */
import SidekickNative from '../../modules/sidekick-native';
import { maybeEditPhoto } from './photo-edit';

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
  ['what is in the background?', null],
  ['is this photo blurry?', null],
];

type Log = (line: string) => void;

export async function runPhotoEditBench(log: Log, dir: string): Promise<void> {
  const photo = `${dir}/bench-photo.jpg`;
  if (!SidekickNative.fileExists(photo)) {
    log(`[photo-edit-bench] no ${photo}`);
    return;
  }
  let right = 0;
  const made: string[] = [];
  for (const [q, want] of PHOTO_EDIT_CASES) {
    const t0 = Date.now();
    const r = await maybeEditPhoto(q, photo, () => {}).catch(() => null);
    const ok = want === null ? !r : !!r?.path && r.op === want;
    if (ok) right++;
    if (r?.path) made.push(r.path);
    log(
      `[photo-edit-bench] ${JSON.stringify({ q, want, got: r?.op ?? null, ok, ms: Date.now() - t0, reply: r?.text ?? null, path: r?.path ?? null })}`,
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
