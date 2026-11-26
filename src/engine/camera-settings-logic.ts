/**
 * Camera settings changed by voice or typed request ("more frames", "use the front camera",
 * "sharper picture"): the tool router picks the change, this works out the new settings and the
 * reply. Pure; tested in __tests__/camera-settings-test.ts.
 */
import type { ImageDetail } from './settings';

export type CameraLens = 'back' | 'front';

/** What was asked; any mix of the three. */
export type CameraChange = {
  /** A step up or down, or back to Recommended. */
  frames?: 'more' | 'fewer' | 'normal';
  /** An exact rate asked for (snapped to the nearest choice offered in Settings). */
  fps?: number;
  lens?: CameraLens | 'flip';
  detail?: ImageDetail | 'higher' | 'lower' | 'normal';
};

export type CameraState = { fps: number; imageDetail: ImageDetail; lens: CameraLens };

/** Settings to save: null = follow the Recommended value again. */
export type CameraPatch = {
  fps?: number | null;
  imageDetail?: ImageDetail | null;
  cameraLens?: CameraLens;
};

/**
 * The router's one frame-rate argument as a change: a number ("5", 0.5, "2 fps") is an exact
 * rate; words give a direction ("lower", "less", "faster", "default"). Anything else: no change.
 */
export function parseFrames(v: unknown): Pick<CameraChange, 'frames' | 'fps'> {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? { fps: v } : {};
  if (typeof v !== 'string') return {};
  const t = v.trim().toLowerCase();
  const n = parseFloat(t);
  if (Number.isFinite(n) && n > 0) return { fps: n };
  if (/\b(more|higher|up|faster|increase|raise|smoother)\b/.test(t)) return { frames: 'more' };
  if (/\b(fewer|less|lower|down|slower|decrease|reduce)\b/.test(t)) return { frames: 'fewer' };
  if (/\b(normal|default|reset|recommended|usual|standard)\b/.test(t)) return { frames: 'normal' };
  return {};
}

const DETAILS: ImageDetail[] = ['low', 'medium', 'high'];

const rateWords = (fps: number) =>
  fps >= 1
    ? `${fps} frame${fps === 1 ? '' : 's'} a second`
    : `1 frame every ${Math.round(1 / fps)} seconds`;

function nearest(options: number[], v: number): number {
  return options.reduce((best, o) => (Math.abs(o - v) < Math.abs(best - v) ? o : best), options[0]);
}

/** The new settings and what to say, or null when nothing usable was asked. */
export function planCameraChange(
  cur: CameraState,
  rec: { fps: number; imageDetail: ImageDetail },
  c: CameraChange,
  /** The frame rates Settings offers (FPS_OPTIONS). */
  fpsOptions: number[],
): { patch: CameraPatch; reply: string } | null {
  const patch: CameraPatch = {};
  const said: string[] = [];

  if (c.fps !== undefined || c.frames) {
    const options = [...fpsOptions].sort((a, b) => a - b);
    let next = cur.fps;
    if (c.fps !== undefined && Number.isFinite(c.fps) && c.fps > 0) next = nearest(options, c.fps);
    else if (c.frames === 'normal') next = rec.fps;
    else if (c.frames === 'more') next = options.find((o) => o > cur.fps) ?? cur.fps;
    else if (c.frames === 'fewer')
      next = [...options].reverse().find((o) => o < cur.fps) ?? cur.fps;
    if (next === cur.fps && c.frames && c.frames !== 'normal') {
      said.push(
        c.frames === 'more'
          ? `Already at the most frames, ${rateWords(cur.fps)}.`
          : `Already at the fewest frames, ${rateWords(cur.fps)}.`,
      );
    } else {
      patch.fps = next === rec.fps ? null : next;
      const asked = c.fps !== undefined && next !== c.fps ? ` (the nearest this phone offers)` : '';
      said.push(`Camera at ${rateWords(next)}${asked}.`);
    }
  }

  if (c.lens) {
    const lens: CameraLens = c.lens === 'flip' ? (cur.lens === 'back' ? 'front' : 'back') : c.lens;
    patch.cameraLens = lens;
    said.push(
      lens === cur.lens ? `Already using the ${lens} camera.` : `Using the ${lens} camera.`,
    );
  }

  if (c.detail) {
    const i = DETAILS.indexOf(cur.imageDetail);
    const next: ImageDetail =
      c.detail === 'normal'
        ? rec.imageDetail
        : c.detail === 'higher'
          ? DETAILS[Math.min(DETAILS.length - 1, i + 1)]
          : c.detail === 'lower'
            ? DETAILS[Math.max(0, i - 1)]
            : c.detail;
    if (next === cur.imageDetail && (c.detail === 'higher' || c.detail === 'lower')) {
      said.push(`Image detail is already ${next}.`);
    } else {
      patch.imageDetail = next === rec.imageDetail ? null : next;
      const why =
        next === 'high'
          ? ' Reads small text better, answers a bit slower.'
          : next === 'low'
            ? ' Faster answers, less detail.'
            : '';
      said.push(`Image detail ${next}.${why}`);
    }
  }

  if (!said.length) return null;
  return { patch, reply: said.join(' ') };
}
