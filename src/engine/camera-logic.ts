import type { CameraConfig, CameraEvent } from '../../modules/sidekick-native';
import type { Tuning } from './device-profile';
import type { Notice } from './notices';

/** Video height per image-detail level. */
const HEIGHT = { low: 480, medium: 720, high: 1080 } as const;

/** The live camera's settings from the values in force (Recommended unless changed). */
export function cameraConfigFor(t: Pick<Tuning, 'fps' | 'imageDetail' | 'videoKeepHours'>) {
  return {
    source: 'auto',
    sampleFps: t.fps,
    videoHeight: HEIGHT[t.imageDetail],
    keepVideoHours: t.videoKeepHours,
  } satisfies CameraConfig;
}

const rate = (fps: number) =>
  fps >= 1
    ? `${Math.round(fps * 10) / 10} frame${fps === 1 ? '' : 's'} a second`
    : `1 frame every ${Math.round(1 / fps)} seconds`;

const WHY = {
  heat: 'Phone is hot',
  battery: 'Battery is low',
  memory: 'Phone memory is low',
} as const;

type NoticeDraft = Omit<Notice, 'at'>;

/** A camera event in plain words for the chat; null when there is nothing to say. */
export function cameraNotice(e: CameraEvent): NoticeDraft | null {
  if (e.kind === 'throttle') {
    if (e.reason == null)
      return { key: 'camera-throttle', kind: 'info', text: 'Camera back to normal speed.' };
    const why = WHY[e.reason];
    if (e.paused)
      return {
        key: 'camera-throttle',
        kind: 'info',
        text: `${why}: camera paused for now. It carries on by itself.`,
      };
    const video = e.videoTo === 0 && e.videoFrom > 0 ? ', video recording paused' : '';
    return {
      key: 'camera-throttle',
      kind: 'info',
      text: `${why}: camera slowed to ${rate(e.to)}${video}.`,
    };
  }
  if (e.kind === 'lost') {
    return {
      key: 'camera-lost',
      kind: 'info',
      text:
        e.fallback === 'phone'
          ? 'Camera unplugged: switched to the phone camera.'
          : 'Live camera stopped: the camera is in use by something else or was closed.',
    };
  }
  return null;
}
