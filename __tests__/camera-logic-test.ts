import { cameraConfigFor, cameraNotice, cameraStartTook } from '@/engine/camera-logic';

test('settings become the camera config', () => {
  expect(cameraConfigFor({ fps: 2, imageDetail: 'medium', videoKeepHours: 48 })).toEqual({
    source: 'auto',
    sampleFps: 2,
    videoHeight: 720,
    keepVideoHours: 48,
    whileLocked: true,
  });
  expect(cameraConfigFor({ fps: 1, imageDetail: 'low', videoKeepHours: 24 }).videoHeight).toBe(480);
});

test('throttle and lost events in plain words', () => {
  const base = { kind: 'throttle', from: 2, videoFrom: 10, videoTo: 10, paused: false } as const;
  expect(cameraNotice({ ...base, to: 1, reason: 'heat', tempC: 44, batteryPct: 80 })?.text).toBe(
    'Phone is hot: camera slowed to 1 frame a second.',
  );
  expect(
    cameraNotice({ ...base, to: 0.5, videoTo: 0, reason: 'battery', tempC: null, batteryPct: 15 })
      ?.text,
  ).toBe('Battery is low: camera slowed to 1 frame every 2 seconds, video recording paused.');
  expect(
    cameraNotice({ ...base, to: 0, paused: true, reason: 'heat', tempC: 48, batteryPct: 80 })?.text,
  ).toMatch(/paused/);
  expect(cameraNotice({ ...base, to: 2, reason: null, tempC: null, batteryPct: 80 })?.text).toBe(
    'Camera back to normal speed.',
  );
  expect(cameraNotice({ kind: 'lost', reason: 'usb', fallback: 'phone' })?.text).toMatch(
    /unplugged/,
  );
  expect(cameraNotice({ kind: 'status', running: true })).toBeNull();
});

test('the camera keeps filming while locked unless turned off', () => {
  expect(cameraConfigFor({ fps: 2, imageDetail: 'medium', videoKeepHours: 48 }).whileLocked).toBe(
    true,
  );
  expect(
    cameraConfigFor({ fps: 2, imageDetail: 'medium', videoKeepHours: 48 }, false).whileLocked,
  ).toBe(false);
});

test('a start asked for in the background only counts if the camera really runs', () => {
  expect(cameraStartTook(true, false, true)).toBe(true); // visible: the service starts a moment later
  expect(cameraStartTook(true, true, false)).toBe(true);
  expect(cameraStartTook(true, false, false)).toBe(false); // refused by Android while locked
  expect(cameraStartTook(false, true, true)).toBe(false);
});
