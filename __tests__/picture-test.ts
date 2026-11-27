import { exchangeToMessages } from '@/features/ask/chat-logic';
import { pictureAllowed } from '@/engine/picture';
import { brushDots, fitRect, toPhoto } from '@/features/erase/erase-logic';
import { ERASE_FILE, PICTURE_FILES, UPSCALE_FILE } from '@/engine/models';
import { editCall, editModel, editReply, upscaleRefusal } from '@/engine/photo-edit-logic';
import { NOT_IN_ROUTINES, validateCall } from '@/engine/tools-logic';
import {
  pictureCheckAllows,
  pictureCheckPrompt,
  pictureOffer,
  pictureUnavailable,
  picturePrompt,
  pictureStatus,
  reportMailto,
} from '@/engine/picture-logic';

test('make_picture needs a description, and never runs in a routine', () => {
  expect(validateCall({ tool: 'make_picture', args: { prompt: 'a fox, watercolour' } })).toEqual({
    ok: true,
    args: { prompt: 'a fox, watercolour' },
  });
  expect(validateCall({ tool: 'make_picture', args: {} }).ok).toBe(false);
  expect(NOT_IN_ROUTINES.has('make_picture')).toBe(true);
});

describe('content rule: the model judges what Google Play requires (no word lists)', () => {
  test('only a clear no allows the picture; yes or an unreadable reply refuses', () => {
    expect(pictureCheckAllows('no')).toBe(true);
    expect(pictureCheckAllows(' No.')).toBe(true);
    expect(pictureCheckAllows('yes')).toBe(false);
    expect(pictureCheckAllows('Yes, it would')).toBe(false);
    expect(pictureCheckAllows('')).toBe(false);
    expect(pictureCheckAllows('maybe')).toBe(false);
    expect(pictureCheckAllows('nothing sexual')).toBe(false);
  });
  test('the check sees the request and the description', () => {
    const p = pictureCheckPrompt('draw her', 'a woman on a beach');
    expect(p).toContain('"draw her"');
    expect(p).toContain('"a woman on a beach"');
    expect(p).toMatch(/under 18/);
  });
});

const mockAsk = jest.fn();
jest.mock('../modules/sidekick-native', () => ({ __esModule: true, default: {} }));
jest.mock('@/engine/llm', () => ({
  askLlm: (...a: unknown[]) => mockAsk(...a),
  unloadLlm: jest.fn(),
}));

describe('pictureAllowed asks the model (mocked)', () => {
  test.each([
    ['no', true],
    ['yes', false],
    ['', false],
  ])('reply %j → allowed %s', async (reply, want) => {
    mockAsk.mockResolvedValueOnce({ text: reply });
    expect(await pictureAllowed('draw a sexy sports car', 'a red sports car')).toBe(want);
    const [prompt, , , opts] = mockAsk.mock.calls.at(-1)!;
    expect(prompt).toContain('a red sports car');
    expect(opts).toMatchObject({ scratch: true });
  });
  test('a failed model call refuses', async () => {
    mockAsk.mockRejectedValueOnce(new Error('busy'));
    expect(await pictureAllowed('draw a fox', 'a fox')).toBe(false);
  });
});

describe('which phones get it', () => {
  test('Android with a capable CPU and 6 GB+: offered', () =>
    expect(pictureOffer({ platform: 'android', ramMb: 7600, cpuOk: true })).toEqual({
      offer: true,
    }));
  test('4-6 GB: offered with a slow note', () => {
    const o = pictureOffer({ platform: 'android', ramMb: 3800, cpuOk: true });
    expect(o.offer).toBe(true);
    expect(o.note).toMatch(/slow/i);
  });
  test('under 4 GB, old CPU, iPhone: not offered', () => {
    expect(pictureOffer({ platform: 'android', ramMb: 2900, cpuOk: true }).offer).toBe(false);
    expect(pictureOffer({ platform: 'android', ramMb: 8000, cpuOk: false }).offer).toBe(false);
    expect(pictureOffer({ platform: 'ios', ramMb: 8000, cpuOk: true }).note).toMatch(/iPhone/);
  });
  test('a phone that can never draw gets a plain answer, not the download offer', () => {
    const reply = (platform: string, ramMb: number, cpuOk: boolean) =>
      pictureUnavailable(pictureOffer({ platform, ramMb, cpuOk }));
    expect(reply('ios', 4096, true)).toMatch(/can't make pictures on iPhone/);
    expect(reply('android', 2900, true)).toMatch(/4 GB/);
    expect(reply('android', 8000, false)).toMatch(/processor/);
    expect(reply('android', 8000, true)).toBeNull();
  });
});

test('picturePrompt drops the request wrapper and keeps the description', () => {
  expect(picturePrompt('', 'Can you draw me a picture of a fox in the snow?')).toBe(
    'a fox in the snow',
  );
  expect(picturePrompt('a watercolour fox in the snow\n', 'draw a fox')).toBe(
    'a watercolour fox in the snow',
  );
  expect(picturePrompt('x'.repeat(500), '').length).toBe(300);
});

test('pictureStatus turns stages into plain words', () => {
  expect(pictureStatus('loading model', 0, 0)).toMatch(/Loading/);
  expect(pictureStatus('sampling', 1, 1)).toBe('Drawing…');
  expect(pictureStatus('sampling', 2, 4)).toBe('Drawing… (2/4)');
  expect(pictureStatus('vae decode', 0, 1)).toMatch(/Finishing/);
});

test('the report is an email draft with the reason and the request, nothing attached', () => {
  const url = reportMailto('help@example.org', {
    reason: 'Violent or hateful',
    prompt: 'a fox',
    version: '2.1.0',
  });
  expect(url.startsWith('mailto:help%40example.org?subject=')).toBe(true);
  const body = decodeURIComponent(url.split('body=')[1]);
  expect(body).toContain('Reason: Violent or hateful');
  expect(body).toContain('What was asked for: a fox');
  expect(body).toContain('Sidekick 2.1.0');
});

test('model files are pinned to a commit with sha256 and size', () => {
  for (const f of [...Object.values(PICTURE_FILES), ERASE_FILE, UPSCALE_FILE]) {
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(f.bytes).toBeGreaterThan(0);
    expect(f.url).toMatch(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\//);
  }
});

describe('erase and upscale edits', () => {
  test('checked edit_photo ops, with the model file each needs', () => {
    const e = editCall({ op: 'erase' });
    expect(e).toEqual({ op: 'erase', args: {} });
    expect(editModel(e!)).toBe('erase');
    const u = editCall({ op: 'upscale' });
    expect(editModel(u!)).toBe('upscale');
    expect(editReply(u!)).toMatch(/bigger/);
    expect(editModel({ op: 'rotate', args: {} })).toBeNull();
  });
  test('a big photo is not upscaled, with the reason', () => {
    expect(upscaleRefusal('Error: too big 4032x3024')).toMatch(/already 4032 × 3024/);
    expect(upscaleRefusal('Error: out of memory')).toBeNull();
  });
});

describe('erase screen geometry', () => {
  test('fits the photo in the box, centred', () => {
    expect(fitRect({ w: 2000, h: 1000 }, { w: 400, h: 400 })).toEqual({
      x: 0,
      y: 100,
      w: 400,
      h: 200,
    });
  });
  test('touches map to 0..1 of the photo; outside is ignored', () => {
    const r = { x: 0, y: 100, w: 400, h: 200 };
    expect(toPhoto(200, 200, r)).toEqual({ x: 0.5, y: 0.5 });
    expect(toPhoto(200, 20, r)).toBeNull();
  });
  test('brush dots fill the gaps of a fast swipe', () => {
    const r = { x: 0, y: 0, w: 100, h: 100 };
    const dots = brushDots([[0, 0, 1, 0]], r, 5);
    expect(dots.length).toBeGreaterThan(10);
    expect(dots[0]).toEqual({ x: 0, y: 0, r: 5 });
    expect(dots[dots.length - 1]).toEqual({ x: 100, y: 0, r: 5 });
  });
});

test('a saved picture comes back under its answer, with Report, and no camera frames', () => {
  const [q, a] = exchangeToMessages({
    id: 3,
    at: 1000,
    kind: 'picture',
    text: 'Q: draw a fox\nA: Here it is.',
    photoPath: '/data/pictures/1000.png',
  });
  expect(q.media).toBeUndefined();
  expect(a.media).toEqual([{ momentAt: 0, kind: 'photo', path: '/data/pictures/1000.png' }]);
  expect(a.picture).toEqual({ prompt: 'draw a fox' });
  expect([q.momentId, a.momentId]).toEqual([3, 3]); // Edit / Try again can take it back
});
