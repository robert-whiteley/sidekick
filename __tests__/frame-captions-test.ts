import {
  BOTH_MODELS_RAM_MB,
  FRAME_CAPTION_QUIET_MS,
  FRAME_CAPTIONS_PER_CHARGE,
  CAPTION_MIN_BATTERY,
  captionMode,
  frameCaptionPlan,
  parseDescription,
} from '@/memory/photo-text';

const base = {
  mode: 'charging' as const,
  charging: true,
  batteryLevel: 0.8,
  lowPowerMode: false,
  busy: false,
  sinceActiveMs: FRAME_CAPTION_QUIET_MS,
  doneThisCharge: 0,
  llmLoaded: true,
  ramMb: 8000,
  lowMemory: false,
  thermalStatus: 0,
};

test('captions only on the charger, idle, cool and under the cap', () => {
  expect(frameCaptionPlan(base)).toBe('loaded');
  expect(frameCaptionPlan({ ...base, mode: 'off' })).toBe('skip');
  expect(frameCaptionPlan({ ...base, charging: false })).toBe('skip');
  expect(frameCaptionPlan({ ...base, lowPowerMode: true })).toBe('skip');
  expect(frameCaptionPlan({ ...base, busy: true })).toBe('skip');
  expect(frameCaptionPlan({ ...base, sinceActiveMs: FRAME_CAPTION_QUIET_MS - 1 })).toBe('skip');
  expect(frameCaptionPlan({ ...base, doneThisCharge: FRAME_CAPTIONS_PER_CHARGE })).toBe('skip');
  expect(frameCaptionPlan({ ...base, thermalStatus: 2 })).toBe('skip');
});

test('loads the model only on phones that hold both models and are not short of memory', () => {
  const unloaded = { ...base, llmLoaded: false };
  expect(frameCaptionPlan(unloaded)).toBe('load');
  expect(frameCaptionPlan({ ...unloaded, ramMb: BOTH_MODELS_RAM_MB - 1 })).toBe('skip');
  expect(frameCaptionPlan({ ...unloaded, lowMemory: true })).toBe('skip');
  // A 4 GB phone still uses the model when it is already loaded for a question.
  expect(frameCaptionPlan({ ...base, ramMb: 3800 })).toBe('loaded');
});

test('a rich frame caption keeps counts and text', () => {
  expect(
    parseDescription(
      'Text: BUS STOP 42\nScene: Three people wait at a bus stop. A red bus pulls in from the left.',
    ),
  ).toBe(
    'Text: "BUS STOP 42" · Scene: Three people wait at a bus stop. A red bus pulls in from the left.',
  );
});

describe('captionOneFrame', () => {
  const native = {
    llmIsLoaded: jest.fn(() => true),
    fileExists: jest.fn(() => true),
    deviceState: jest.fn(() => ({ lowMemory: false, thermalStatus: 0 })),
    getDeviceInfo: jest.fn(() => ({ totalRamMb: 8000 })),
  };
  const battery = { charging: true, batteryLevel: 0.9, lowPowerMode: false };
  const save = jest.fn(async () => {});
  const ask = jest.fn(async () => ({ text: 'Text: none\nScene: Two cups on a desk.', stats: {} }));
  const ensure = jest.fn(async () => ({}));
  let frame: { id: number; photoPath: string } | null = { id: 7, photoPath: '/f/7.jpg' };

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers({ now: 1_000_000 });
    jest.clearAllMocks();
    frame = { id: 7, photoPath: '/f/7.jpg' };
    jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
    jest.doMock('../modules/sidekick-native', () => ({ __esModule: true, default: native }));
    jest.doMock('@/engine/battery', () => ({
      batteryState: async () => battery,
      chargerFallingBehind: () => false,
    }));
    jest.doMock('@/engine/llm', () => ({
      askLlmInBackground: ask,
      cancelLlm: jest.fn(),
      ensureLlm: ensure,
    }));
    jest.doMock('@/engine/settings', () => ({ getSettings: () => ({ captionFrames: true }) }));
    jest.doMock('@/memory/store', () => ({
      nextUncaptionedFrame: async () => frame,
      nextUndescribedPhoto: async () => null,
      savePhotoDescription: save,
    }));
  });
  afterEach(() => jest.useRealTimers());

  const load = () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/engine/describe-photos') as typeof import('@/engine/describe-photos');

  test('waits after the app was opened, then captions and saves the frame', async () => {
    const m = load();
    expect(await m.captionOneFrame(false)).toBe(false); // just started: counts as active
    jest.setSystemTime(1_000_000 + FRAME_CAPTION_QUIET_MS);
    expect(await m.captionOneFrame(false)).toBe(true);
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('camera frame'), '/f/7.jpg', {
      maxTokens: 160,
    });
    expect(save).toHaveBeenCalledWith(7, 'Scene: Two cups on a desk.');
    expect(ensure).not.toHaveBeenCalled();
  });

  test('a question resets the quiet time', async () => {
    const m = load();
    jest.setSystemTime(1_000_000 + FRAME_CAPTION_QUIET_MS);
    await m.yieldToQuestion();
    expect(await m.captionOneFrame(false)).toBe(false);
  });

  test('loads the model when allowed, and marks a missing file done', async () => {
    native.llmIsLoaded.mockReturnValue(false);
    const m = load();
    jest.setSystemTime(1_000_000 + FRAME_CAPTION_QUIET_MS);
    expect(await m.captionOneFrame(false)).toBe(true);
    expect(ensure).toHaveBeenCalled();
    native.fileExists.mockReturnValueOnce(false);
    frame = { id: 8, photoPath: '/f/8.jpg' };
    expect(await m.captionOneFrame(false)).toBe(false);
    expect(save).toHaveBeenLastCalledWith(8, null);
    native.llmIsLoaded.mockReturnValue(true);
  });

  test('nothing when there is no uncaptioned frame', async () => {
    frame = null;
    const m = load();
    jest.setSystemTime(1_000_000 + FRAME_CAPTION_QUIET_MS);
    expect(await m.captionOneFrame(false)).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });
});

test('on battery only when the owner chose it, and above the battery floor', () => {
  const onBattery = { ...base, charging: false, mode: 'always' as const };
  expect(frameCaptionPlan(onBattery)).toBe('loaded');
  expect(frameCaptionPlan({ ...onBattery, batteryLevel: CAPTION_MIN_BATTERY - 0.01 })).toBe('skip');
  expect(frameCaptionPlan({ ...onBattery, batteryLevel: -1 })).toBe('skip');
  expect(frameCaptionPlan({ ...onBattery, lowPowerMode: true })).toBe('skip');
});

test('older boolean setting reads as a mode', () => {
  expect(captionMode(true)).toBe('charging');
  expect(captionMode(undefined)).toBe('charging');
  expect(captionMode(false)).toBe('off');
  expect(captionMode('always')).toBe('always');
});

test('slow photo work runs on the charger, on battery only when chosen, never when hot', () => {
  const { photoWorkAllowed } = jest.requireActual('@/memory/embed-policy');
  const b = {
    mode: 'charging',
    charging: true,
    batteryLevel: 0.5,
    lowPowerMode: false,
    thermalStatus: 0,
  };
  expect(photoWorkAllowed(b)).toBe(true);
  expect(photoWorkAllowed({ ...b, thermalStatus: 2 })).toBe(false);
  expect(photoWorkAllowed({ ...b, charging: false })).toBe(false);
  expect(photoWorkAllowed({ ...b, charging: false, mode: 'always' })).toBe(true);
  expect(photoWorkAllowed({ ...b, charging: false, mode: 'always', batteryLevel: 0.2 })).toBe(
    false,
  );
  expect(photoWorkAllowed({ ...b, mode: 'off' })).toBe(true);
});

test('a charger that cannot keep up pauses slow photo work', () => {
  const { drainingOnCharger, photoWorkAllowed } = jest.requireActual('@/memory/embed-policy');
  const t = 1_000_000;
  const falling = [
    { at: t, level: 0.13, charging: true },
    { at: t + 5 * 60_000, level: 0.1, charging: true },
  ];
  expect(drainingOnCharger(falling, t + 5 * 60_000)).toBe(true);
  const rising = [
    { at: t, level: 0.3, charging: true },
    { at: t + 5 * 60_000, level: 0.32, charging: true },
  ];
  expect(drainingOnCharger(rising, t + 5 * 60_000)).toBe(false);
  expect(drainingOnCharger(falling.slice(0, 1), t)).toBe(false);
  // Seen on the Pixel 5 on a 450 mA USB port: 33 → 32 → 31 → back to 32 while falling overall.
  const bouncing = [32, 33, 32, 31, 32].map((l, i) => ({
    at: t + i * 2 * 60_000,
    level: l / 100,
    charging: true,
  }));
  expect(drainingOnCharger(bouncing, t + 8 * 60_000)).toBe(true);
  const steady = [33, 32, 33, 33].map((l, i) => ({
    at: t + i * 60_000,
    level: l / 100,
    charging: true,
  }));
  expect(drainingOnCharger(steady, t + 3 * 60_000)).toBe(false);
  const b = {
    mode: 'charging',
    charging: true,
    batteryLevel: 0.1,
    lowPowerMode: false,
    thermalStatus: 0,
  };
  expect(photoWorkAllowed({ ...b, drainingOnCharger: true })).toBe(false);
  expect(frameCaptionPlan({ ...base, drainingOnCharger: true })).toBe('skip');
});
