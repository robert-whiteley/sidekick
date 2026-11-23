import { canStartNewVoice, NEW_VOICE_MIN_MS } from '../src/memory/voices';

describe('canStartNewVoice', () => {
  it('lets a long clip start a new person', () => {
    expect(canStartNewVoice(NEW_VOICE_MIN_MS)).toBe(true);
    expect(canStartNewVoice(6000)).toBe(true);
  });
  it('keeps short or unknown-length clips unattributed', () => {
    expect(canStartNewVoice(1500)).toBe(false);
    expect(canStartNewVoice(undefined)).toBe(false);
  });
});
