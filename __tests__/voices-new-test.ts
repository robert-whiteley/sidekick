import {
  canStartNewVoice,
  claimPending,
  matchShortClip,
  NEW_VOICE_MIN_MS,
  ownerClaimHolds,
  PENDING_CLIP_MS,
} from '../src/memory/voices';

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

describe('matchShortClip', () => {
  const owner = { id: 1, centroid: [1, 0, 0], count: 5, isOwner: true };
  const sam = { id: 2, centroid: [0, 1, 0], count: 5, isOwner: false };
  const ann = { id: 3, centroid: [0, 0, 1], count: 5, isOwner: false };
  it('joins a clearly closest other voice', () => {
    expect(matchShortClip([0.2, 0.6, 0.1], [owner, sam, ann])?.id).toBe(2);
  });
  it('stays unattributed when two voices are close', () => {
    expect(matchShortClip([0, 0.6, 0.55], [owner, sam, ann])).toBeNull();
  });
  it('never matches the owner loosely', () => {
    expect(matchShortClip([0.6, 0.1, 0], [owner, sam])).toBeNull();
  });
  it('needs a minimum similarity', () => {
    expect(matchShortClip([0.6, 0.3, 0.75], [sam])).toBeNull();
  });
});

describe('claimPending', () => {
  const sam = { id: 2, centroid: [0, 1, 0], count: 1, isOwner: false };
  const ann = { id: 3, centroid: [0, 0, 1], count: 1, isOwner: false };
  it('gives waiting clips to the new voice and drops stale ones', () => {
    const now = 100_000;
    const r = claimPending(
      [
        { at: now - 1000, voice: [0.1, 0.9, 0], momentId: 7 },
        { at: now - 1000, voice: [0, 0.1, 0.9], momentId: 8 },
        { at: now - PENDING_CLIP_MS - 1, voice: [0, 1, 0], momentId: 9 },
      ],
      sam,
      [sam, ann],
      now,
    );
    expect(r.claimed.map((c) => c.momentId)).toEqual([7]);
    expect(r.waiting.map((c) => c.momentId)).toEqual([8]);
  });
});
