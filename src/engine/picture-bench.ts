/**
 * Dev-only bench for pictures and erase (sidekick://bench?run=picture): does the model pick
 * make_picture for drawing requests (and not for others; the app's path: the sorter with the
 * picture model downloaded, then the tool's arguments), then draws each picked one with timings; erases a fixed brushed area of `bench-photo.jpg` (pushed by adb, made up; upscale is
 * in the photo-edit bench). Copies of the results go next to it as `bench-pic-N.png`; the app’s own
 * copies are deleted. Delete the pushed photo and the copies by adb afterwards.
 */
import SidekickNative from '../../modules/sidekick-native';
import { erasePhoto } from './photo-edit';
import { makePicture, pictureFilesReady } from './picture';
import { decideRequest } from './decide';
import { fillTool } from './tools';

/** Request → should the router pick the picture tool? */
export const PICTURE_CASES: [string, boolean][] = [
  ['draw a fox reading a book, children’s illustration', true],
  ['make me a picture of a lighthouse at night in a storm', true],
  ['can you create an image of a red bicycle against a brick wall', true],
  ['paint a mountain lake at sunrise', true],
  ['a cartoon of a cat as a pirate please, draw it', true],
  ['generate a birthday card picture with balloons', true],
  ['what did I see in the picture I took yesterday', false],
  ['how do I draw a straight line in Word', false],
];

type Log = (line: string) => void;

export async function runPictureBench(log: Log, dir: string): Promise<void> {
  const keep = (p: string, i: number) => {
    try {
      SidekickNative.copyFile(p, `${dir}/bench-pic-${i}.png`);
      SidekickNative.deleteFile(p);
    } catch {}
  };
  let right = 0;
  let n = 0;
  for (const [q, want] of PICTURE_CASES) {
    const t0 = Date.now();
    const d = await decideRequest(q, { pictures: true }).catch(() => null);
    const fill =
      d?.decision.kind === 'do' && d.decision.tool === 'make_picture'
        ? await fillTool(q, 'make_picture').catch(() => null)
        : null;
    const routeMs = Date.now() - t0;
    const prompt =
      fill && !fill.error && fill.tool === 'make_picture' ? String(fill.args.prompt) : null;
    const picked = prompt !== null;
    if (picked === want) right++;
    let made: { ms: number; text: string } | null = null;
    if (prompt !== null && pictureFilesReady()) {
      const r = await makePicture(q, prompt, () => {});
      made = { ms: r.ms, text: r.text };
      if (r.path) keep(r.path, n++);
    }
    log(
      `[picture-bench] ${JSON.stringify({ q, want, picked, ok: picked === want, routeMs, prompt, made })}`,
    );
  }
  log(`[picture-bench] route ${JSON.stringify({ cases: PICTURE_CASES.length, right })}`);

  const photo = `${dir}/bench-photo.jpg`;
  if (!SidekickNative.fileExists(photo) || !SidekickNative.photoEdit) return;
  // A brushed blob in the middle (the made-up photo has its object there).
  const blob = [0.42, 0.42, 0.58, 0.42, 0.58, 0.58, 0.42, 0.58, 0.5, 0.5];
  for (let i = 0; i < 2; i++) {
    try {
      const r = await erasePhoto(photo, [blob], 0.06, () => {});
      log(`[picture-bench] erase ${JSON.stringify({ run: i, ms: r.ms })}`);
      keep(r.path, 100 + i);
    } catch (e) {
      log(`[picture-bench] erase failed ${String(e)}`);
    }
  }
}
