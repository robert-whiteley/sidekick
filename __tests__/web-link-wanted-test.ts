import { webLinkWanted } from '@/web/lookup-logic';

describe('webLinkWanted (browser link with online lookup off)', () => {
  it.each([
    'search the web for cheap flights to Rome',
    'google the opening hours of the museum',
    "what's the latest news about the election",
    'who won the match today',
    'current price of a PS6',
  ])('shows the link for %s', (q) => expect(webLinkWanted(q)).toBe(true));

  it.each([
    'give me a quick recipe for pancakes',
    'tell me a joke',
    'what is photosynthesis',
    'where did I park',
    'what did I do today',
    "what's the weather today",
    'remind me to call Sam',
    '',
  ])('no link for %s', (q) => expect(webLinkWanted(q)).toBe(false));
});
