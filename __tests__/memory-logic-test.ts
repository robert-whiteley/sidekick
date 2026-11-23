import { isAgreement, isConsentQuestion, keepOtherSpeech } from '../src/memory/consent';
import { addToCentroid, cosine, matchSpeaker } from '../src/memory/voices';

import { consentNeeded, lawRequiresConsent } from '@/memory/consent-region';

test('voices match by cosine similarity', () => {
  const owner = { id: 1, centroid: [1, 0, 0], count: 5, isOwner: true };
  const sam = { id: 2, centroid: [0, 1, 0], count: 2, isOwner: false };
  expect(matchSpeaker([0.9, 0.1, 0], [owner, sam])?.id).toBe(1);
  expect(matchSpeaker([0, 0, 1], [owner, sam])).toBeNull();
  expect(cosine([1, 1], [1, 1])).toBeCloseTo(1);
  expect(addToCentroid({ id: 3, centroid: [0, 0], count: 1, isOwner: false }, [2, 2])).toEqual([
    1, 1,
  ]);
});

test('consent phrases', () => {
  expect(isConsentQuestion('Is it OK if I take notes?')).toBe(true);
  expect(isConsentQuestion('Can I record this?')).toBe(true);
  expect(isConsentQuestion('The train is at four')).toBe(false);
  expect(isAgreement('Yeah, go ahead.')).toBe(true);
  expect(isAgreement("No, I'd rather you didn't")).toBe(false);
  expect(keepOtherSpeech({ consentMode: true, speakerConsented: false })).toBe(false);
  expect(keepOtherSpeech({ consentMode: false, speakerConsented: false })).toBe(true);
});

test('automatic consent follows where the phone is', () => {
  expect(lawRequiresConsent({ country: 'GB', admin1: null })).toBe(false);
  expect(lawRequiresConsent({ country: 'DE', admin1: null })).toBe(true);
  expect(lawRequiresConsent({ country: 'US', admin1: 'CA' })).toBe(true);
  expect(lawRequiresConsent({ country: 'US', admin1: 'NY' })).toBe(false);
  expect(lawRequiresConsent({ country: 'US', admin1: null })).toBe(true);
  expect(lawRequiresConsent({ country: null, admin1: null })).toBe(true);
  expect(consentNeeded('off', { country: 'DE', admin1: null })).toBe(false);
  expect(consentNeeded('on', { country: 'GB', admin1: null })).toBe(true);
});
