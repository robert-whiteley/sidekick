/** Lookup off: the browser link only under an answer the model says needed the web. */
import { WEB_OFFER_SYSTEM, wantsWebOffer, webOfferPrompt } from '@/web/lookup-logic';

test('the check sees the question and the answer, clipped', () => {
  const p = webOfferPrompt('When did the bridge open?', "I don't know.");
  expect(p).toContain('Question: When did the bridge open?');
  expect(p).toContain("Answer: I don't know.");
  expect(webOfferPrompt('q', 'a'.repeat(2000)).length).toBeLessThan(700);
});

test("the model's one word decides; anything else is no link", () => {
  expect(wantsWebOffer('WEB')).toBe(true);
  expect(wantsWebOffer(' web.')).toBe(true);
  expect(wantsWebOffer('NO')).toBe(false);
  expect(wantsWebOffer('')).toBe(false);
  expect(wantsWebOffer('website')).toBe(false);
});

test("the user's own life, notes or phone never get the link", () => {
  expect(WEB_OFFER_SYSTEM).toMatch(/own life, notes or phone/);
});
