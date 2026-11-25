import { memoryStatus } from '@/engine/progress';

test('progress says what was found', () => {
  expect(memoryStatus(0, 2, 5)).toBe('Looking at 2 frames from the camera…');
  expect(memoryStatus(3, 0, 1)).toBe('Found 1 moment, thinking…');
  expect(memoryStatus(1, 0, 0)).toBe('Found 1 memory, thinking…');
  expect(memoryStatus(0, 0, 0)).toBe('Thinking…');
});
