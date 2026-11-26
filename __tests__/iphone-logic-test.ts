import { mayDownloadOn } from '@/engine/downloads';
import { allRequiredFiles, llmCandidates } from '@/engine/llm-candidates';
import { EMBEDDER_FILE, MODEL_FILES } from '@/engine/models';
import { stepsSentence, stepWindow } from '@/integrations/extras-logic';

jest.mock('../modules/sidekick-native', () => ({ __esModule: true, default: {} }));

const chat = { id: 'gemma-4-e2b' as const, sha: MODEL_FILES.gemmaGeneric.sha256 };

describe('iPhone model files', () => {
  test('only the chat model and memory search are downloaded (speech and photo text are built in)', () => {
    expect(allRequiredFiles('Apple A15', chat, true)).toEqual([
      MODEL_FILES.gemmaGeneric,
      EMBEDDER_FILE,
    ]);
  });

  test('Android still downloads speech and photo text', () => {
    expect(allRequiredFiles('Qualcomm SM7250', chat, false).length).toBeGreaterThan(2);
  });

  test('the chat model runs on the CPU', () => {
    expect(llmCandidates('Apple A15', '/m/', chat, true)).toEqual([
      { modelPath: '/m/gemma-4-E2B-it.litertlm', backend: 'cpu' },
    ]);
  });
});

describe('iPhone downloads', () => {
  test('Wi-Fi only waits off Wi-Fi; nothing runs offline', () => {
    expect(mayDownloadOn({ wifi: true, online: true }, true)).toBe(true);
    expect(mayDownloadOn({ wifi: false, online: true }, true)).toBe(false);
    expect(mayDownloadOn({ wifi: false, online: true }, false)).toBe(true);
    expect(mayDownloadOn({ wifi: true, online: false }, false)).toBe(false);
  });
});

describe('iPhone steps', () => {
  const now = new Date(2026, 10, 26, 15, 30).getTime();

  test('today is midnight to now', () => {
    const w = stepWindow('today', now);
    expect(w.start).toEqual(new Date(2026, 10, 26));
    expect(w.end.getTime()).toBe(now);
  });

  test('yesterday is the whole of yesterday', () => {
    const w = stepWindow('yesterday', now);
    expect(w.start).toEqual(new Date(2026, 10, 25));
    expect(w.end).toEqual(new Date(2026, 10, 26));
  });

  test('sentences', () => {
    expect(stepsSentence(1, 'today')).toBe('1 step today.');
    expect(stepsSentence(4321.4, 'yesterday')).toBe(`${(4321).toLocaleString()} steps yesterday.`);
  });
});
