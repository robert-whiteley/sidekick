import {
  availableModels,
  desiredModel,
  filesToDrop,
  modelFilesFor,
  needsSwitch,
  planUpdate,
  recommendedModel,
  speedNote,
} from '@/engine/model-catalog';
import { llmCandidates } from '@/engine/llm-candidates';
import { MODEL_FILES } from '@/engine/models';

const pixel5 = { soc: 'Qualcomm SM7250', totalRamMb: 7400 };
const pixel10 = { soc: 'Google Tensor G5', totalRamMb: 11200 };
const small = { soc: 'MT6789', totalRamMb: 3700 };

test('Recommended: E2B on 8 GB and smaller phones, E4B from 12 GB', () => {
  expect(recommendedModel(pixel5)).toBe('gemma-4-e2b');
  expect(recommendedModel(small)).toBe('gemma-4-e2b');
  expect(recommendedModel(pixel10)).toBe('gemma-4-e4b');
});

test('E4B is offered on 8 GB phones but not on 4 GB ones', () => {
  expect(availableModels(pixel5).map((m) => m.id)).toEqual(['gemma-4-e2b', 'gemma-4-e4b']);
  expect(availableModels(small).map((m) => m.id)).toEqual(['gemma-4-e2b']);
});

test('a pick this phone cannot run falls back to Recommended', () => {
  expect(desiredModel('gemma-4-e4b', small)).toBe('gemma-4-e2b');
  expect(desiredModel('gemma-4-e4b', pixel5)).toBe('gemma-4-e4b');
  expect(desiredModel('recommended', pixel10)).toBe('gemma-4-e4b');
});

test('Tensor phones get the chip build plus the generic one', () => {
  expect(modelFilesFor('gemma-4-e2b', 'Google Tensor G5').map((f) => f.name)).toEqual([
    MODEL_FILES.gemmaTensorG5.name,
    MODEL_FILES.gemmaGeneric.name,
  ]);
  expect(modelFilesFor('gemma-4-e4b', 'Google Tensor G5')).toEqual([MODEL_FILES.gemmaE4B]);
});

test('a switch is needed for another model or a newer build of the same one', () => {
  const sha = MODEL_FILES.gemmaGeneric.sha256;
  expect(needsSwitch({ id: 'gemma-4-e2b', sha }, 'gemma-4-e2b')).toBe(false);
  expect(needsSwitch({ id: 'gemma-4-e2b', sha: 'old' }, 'gemma-4-e2b')).toBe(true);
  expect(needsSwitch({ id: 'gemma-4-e2b', sha }, 'gemma-4-e4b')).toBe(true);
});

test('update policy: Automatic waits for Wi-Fi and charging; Ask asks; Off never', () => {
  expect(planUpdate('auto', { wifi: true, charging: true }, false)).toBe('download');
  expect(planUpdate('auto', { wifi: true, charging: false }, false)).toBe('wait');
  expect(planUpdate('auto', { wifi: false, charging: true }, false)).toBe('wait');
  expect(planUpdate('ask', { wifi: true, charging: true }, false)).toBe('ask');
  expect(planUpdate('off', { wifi: true, charging: true }, false)).toBe('none');
  expect(planUpdate('off', { wifi: false, charging: false }, true)).toBe('download');
});

test('after a switch only the old model files the new one does not use are dropped', () => {
  expect(filesToDrop('gemma-4-e2b', 'gemma-4-e4b', 'Google Tensor G5').map((f) => f.name)).toEqual([
    MODEL_FILES.gemmaTensorG5.name,
    MODEL_FILES.gemmaGeneric.name,
  ]);
  expect(filesToDrop('gemma-4-e2b', 'gemma-4-e2b', 'x')).toEqual([]);
});

test('right after a switch the previous model is the fallback', () => {
  const c = llmCandidates(
    'QTI SM7250',
    '/m',
    {
      id: 'gemma-4-e4b',
      sha: MODEL_FILES.gemmaE4B.sha256,
      previous: 'gemma-4-e2b',
    },
    false,
  );
  expect(c.map((x) => x.modelPath)).toEqual([
    '/m/gemma-4-E4B-it.litertlm',
    '/m/gemma-4-E4B-it.litertlm',
    '/m/gemma-4-E2B-it.litertlm',
    '/m/gemma-4-E2B-it.litertlm',
  ]);
});

test('speed note from the measured speed', () => {
  expect(speedNote('gemma-4-e2b', null)).toBe('Speed measured after first use');
  expect(speedNote('gemma-4-e2b', 10)).toBe('About 8 words a second on this phone');
  expect(speedNote('gemma-4-e4b', 10)).toBe('About 4 words a second on this phone');
});
