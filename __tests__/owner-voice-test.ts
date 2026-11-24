import { MODEL_FILES, OPTIONAL_SPEECH_FILES, SPEECH_FILES } from '@/engine/models';
import { ownerCentroid, SAME_VOICE } from '../src/memory/voices';

test('the owner centroid is the owner speaker, or null while unknown', () => {
  const people = [
    { id: 1, centroid: [1, 0], count: 3, isOwner: false },
    { id: 2, centroid: [0, 1], count: 9, isOwner: true },
  ];
  expect(ownerCentroid(people)).toEqual([0, 1]);
  expect(ownerCentroid(people.slice(0, 1))).toBeNull();
  expect(ownerCentroid([])).toBeNull();
});

test('barge-in uses the same same-voice threshold as the memory', () => {
  expect(SAME_VOICE).toBe(0.55); // OwnerBarge.SAME_VOICE in Turns.kt
});

test('Smart Turn is an optional download whose name matches the native code', () => {
  expect(OPTIONAL_SPEECH_FILES).toContain(MODEL_FILES.smartTurn);
  expect(SPEECH_FILES).not.toContain(MODEL_FILES.smartTurn); // listening works without it
  expect(MODEL_FILES.smartTurn.name).toBe('smart-turn-v3.2-gpu.onnx'); // SmartTurn.FILE
  expect(MODEL_FILES.smartTurn.url).toMatch(/\/resolve\/[0-9a-f]{40}\//); // pinned to a commit
});
