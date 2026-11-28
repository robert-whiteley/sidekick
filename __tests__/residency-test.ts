/**
 * Which models can be in memory together, and when a question's memory search may load the
 * memory-search model (residency-logic.ts).
 */
import { embedderEvictsChat, mustBeAlone, searchByMeaning } from '@/engine/residency-logic';

describe('the native rule decides', () => {
  it('follows the native answer when the build has one', () => {
    // The native side is what unloads, so JS follows it even where the RAM rule says otherwise.
    expect(mustBeAlone({ nativeAlone: false, totalRamMb: 3_800 })).toBe(false);
    // An 8 GB phone with little memory left right now.
    expect(mustBeAlone({ nativeAlone: true, totalRamMb: 8_000 })).toBe(true);
  });
  it('falls back to the RAM rule on older builds', () => {
    expect(mustBeAlone({ totalRamMb: 3_800 })).toBe(true);
    expect(mustBeAlone({ totalRamMb: 8_000 })).toBe(false);
  });
  it('the embedder evicts the chat model only when that model is loaded', () => {
    expect(embedderEvictsChat({ nativeAlone: true, totalRamMb: 3_800, llmLoaded: true })).toBe(
      true,
    );
    expect(embedderEvictsChat({ nativeAlone: true, totalRamMb: 3_800, llmLoaded: false })).toBe(
      false,
    );
    expect(embedderEvictsChat({ nativeAlone: false, totalRamMb: 16_000, llmLoaded: true })).toBe(
      false,
    );
  });
});

describe('searching memory by meaning', () => {
  it('always, when it costs no model swap', () => {
    for (const photo of [false, true])
      for (const memory of [undefined, false, true])
        expect(searchByMeaning({ evictsChat: false, photo, memory })).toBe(true);
  });
  it('on a small phone: only when the model said the answer is in memory', () => {
    expect(searchByMeaning({ evictsChat: true, photo: false, memory: true })).toBe(true);
    // "Explain photosynthesis": exact words only, the chat model stays loaded.
    expect(searchByMeaning({ evictsChat: true, photo: false, memory: false })).toBe(false);
  });
  it('on a small phone: no sorter ran, so as before (by meaning)', () => {
    expect(searchByMeaning({ evictsChat: true, photo: false, memory: undefined })).toBe(true);
  });
  it('on a small phone: a photo question reads the picture next, so words only', () => {
    expect(searchByMeaning({ evictsChat: true, photo: true, memory: true })).toBe(false);
  });
});
