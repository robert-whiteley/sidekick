import { llmCandidates, requiredModelFiles, tensorGeneration } from '@/engine/llm-candidates';

describe('tensorGeneration', () => {
  test.each([
    ['Google Tensor G6', 'G6'],
    ['Google Tensor G5', 'G5'],
    ['Qualcomm SM8850', null],
    ['', null],
  ])('%s -> %s', (soc, gen) => expect(tensorGeneration(soc)).toBe(gen));
});

describe('llmCandidates', () => {
  test('Tensor G6 tries the Tensor build first, then GPU, then CPU', () => {
    expect(llmCandidates('Google Tensor G6', '/m/')).toEqual([
      { modelPath: '/m/gemma-4-E2B-it_Google_Tensor_G6.litertlm', backend: 'tensor' },
      { modelPath: '/m/gemma-4-E2B-it.litertlm', backend: 'gpu' },
      { modelPath: '/m/gemma-4-E2B-it.litertlm', backend: 'cpu' },
    ]);
  });

  test('other chips go GPU then CPU', () => {
    expect(llmCandidates('QTI SM7250', '/m').map((c) => c.backend)).toEqual(['gpu', 'cpu']);
  });

  test('older Tensor without a published build skips the Tensor path', () => {
    expect(llmCandidates('Google Tensor G4', '/m').map((c) => c.backend)).toEqual(['gpu', 'cpu']);
  });
});

test('required model files', () => {
  expect(requiredModelFiles('Qualcomm SM7250').map((f) => f.name)).toEqual([
    'gemma-4-E2B-it.litertlm',
  ]);
  expect(requiredModelFiles('Google Tensor G5')).toHaveLength(2);
});
