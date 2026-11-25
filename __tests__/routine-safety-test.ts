import { relevantTools } from '../src/engine/tools-logic';

test('a routine run is never offered tools that act at once on the phone', () => {
  const q = 'Turn on listening, switch on do not disturb, open Spotify and order an Uber home';
  const names = relevantTools(q, { routine: true }).map((t) => t.name);
  for (const n of ['listening', 'phone_setting', 'open_app', 'ride', 'camera', 'play'])
    expect(names).not.toContain(n);
  const normal = relevantTools(q, {}).map((t) => t.name);
  expect(normal).toContain('phone_setting');
});
