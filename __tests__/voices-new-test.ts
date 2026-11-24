import { canStartNewVoice, NEW_VOICE_MIN_MS, ownerClaimHolds } from '../src/memory/voices';

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

describe('ownerClaimHolds', () => {
  const owner = { id: 1, centroid: [1, 0, 0], count: 5, isOwner: true };
  it('trusts the first owner clip when no owner voice is known yet', () => {
    expect(ownerClaimHolds([0, 1, 0], null)).toBe(true);
  });
  it('accepts a clip that sounds like the owner', () => {
    expect(ownerClaimHolds([0.9, 0.1, 0], owner)).toBe(true);
  });
  it('rejects someone else saying the wake word', () => {
    expect(ownerClaimHolds([0, 1, 0], owner)).toBe(false);
  });
});
