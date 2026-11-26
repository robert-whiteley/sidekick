import {
  parseFrames,
  planCameraChange,
  type CameraState,
} from '../src/engine/camera-settings-logic';
import { NOT_IN_ROUTINES, relevantTools, validateCall } from '../src/engine/tools-logic';

const OPTIONS = [0.5, 1, 2];
const REC = { fps: 1, imageDetail: 'medium' as const };
const CUR: CameraState = { fps: 1, imageDetail: 'medium', lens: 'back' };
const plan = (c: Parameters<typeof planCameraChange>[2], cur: CameraState = CUR) =>
  planCameraChange(cur, REC, c, OPTIONS);

describe('camera settings by voice', () => {
  it('steps the frame rate and stops at the ends', () => {
    expect(plan({ frames: 'more' })?.patch).toEqual({ fps: 2 });
    expect(plan({ frames: 'fewer' })?.patch).toEqual({ fps: 0.5 });
    const top = plan({ frames: 'more' }, { ...CUR, fps: 2 });
    expect(top?.patch).toEqual({});
    expect(top?.reply).toMatch(/already at the most/i);
  });
  it('snaps a said number to the nearest offered rate and says so', () => {
    const p = plan({ fps: 5 });
    expect(p?.patch).toEqual({ fps: 2 });
    expect(p?.reply).toMatch(/nearest/);
  });
  it('going back to Recommended clears the override', () => {
    expect(plan({ frames: 'normal' }, { ...CUR, fps: 2 })?.patch).toEqual({ fps: null });
    expect(plan({ detail: 'normal' }, { ...CUR, imageDetail: 'high' })?.patch).toEqual({
      imageDetail: null,
    });
  });
  it('flips and picks the lens', () => {
    expect(plan({ lens: 'flip' })?.patch).toEqual({ cameraLens: 'front' });
    expect(plan({ lens: 'flip' }, { ...CUR, lens: 'front' })?.patch).toEqual({
      cameraLens: 'back',
    });
    expect(plan({ lens: 'back' })?.reply).toMatch(/already using the back/i);
  });
  it('changes detail up and down within low..high', () => {
    expect(plan({ detail: 'higher' })?.patch).toEqual({ imageDetail: 'high' });
    expect(plan({ detail: 'lower' }, { ...CUR, imageDetail: 'low' })?.reply).toMatch(/already low/);
    expect(plan({ detail: 'low' })?.patch).toEqual({ imageDetail: 'low' });
  });
  it('combines several changes in one reply; nothing asked is null', () => {
    const p = plan({ lens: 'front', detail: 'high' });
    expect(p?.patch).toEqual({ cameraLens: 'front', imageDetail: 'high' });
    expect(p?.reply).toMatch(/front.*detail high/i);
    expect(plan({})).toBeNull();
  });
});

describe('the camera_setting tool', () => {
  it('is offered for camera-setting wording, any phrasing', () => {
    for (const q of [
      'switch to the selfie camera',
      'make the picture sharper',
      'record more frames',
      'lower the resolution please',
    ])
      expect(relevantTools(q).map((t) => t.name)).toContain('camera_setting');
  });
  it('is never offered to routines (it changes the camera at once)', () => {
    expect(NOT_IN_ROUTINES.has('camera_setting')).toBe(true);
    expect(relevantTools('flip the camera', { routine: true }).map((t) => t.name)).not.toContain(
      'camera_setting',
    );
  });
  it('drops values outside its schema and rejects an out-of-range rate', () => {
    const ok = validateCall({
      tool: 'camera_setting',
      args: { lens: 'Front', detail: 'sideways' },
    });
    expect(ok).toMatchObject({ ok: true, args: { lens: 'front' } });
    expect(ok.ok && 'detail' in ok.args).toBe(false);
  });

  test('one frame-rate argument takes words or numbers (small models mix them up)', () => {
    expect(parseFrames('lower')).toEqual({ frames: 'fewer' });
    expect(parseFrames('more')).toEqual({ frames: 'more' });
    expect(parseFrames('default')).toEqual({ frames: 'normal' });
    expect(parseFrames('2 fps')).toEqual({ fps: 2 });
    expect(parseFrames(0.5)).toEqual({ fps: 0.5 });
    expect(parseFrames('sideways')).toEqual({});
    expect(parseFrames(undefined)).toEqual({});
  });
});
