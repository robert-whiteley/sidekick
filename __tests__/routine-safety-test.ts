import { relevantTools, validateCall } from '../src/engine/tools-logic';

test('a routine run is never offered tools that act at once on the phone', () => {
  const q = 'Turn on listening, switch on do not disturb, open Spotify and order an Uber home';
  const names = relevantTools(q, { routine: true }).map((t) => t.name);
  for (const n of ['listening', 'phone_setting', 'open_app', 'ride', 'camera', 'play'])
    expect(names).not.toContain(n);
  const normal = relevantTools(q, {}).map((t) => t.name);
  expect(normal).toContain('phone_setting');
});

test('"tell me …" with a time goes to routines, never to messaging; a message to me is refused', () => {
  const names = relevantTools('in one minute, tell me a fun fact').map((t) => t.name);
  expect(names).toContain('routine');
  expect(names).not.toContain('message');
  expect(relevantTools('tell Sam I am running late').map((t) => t.name)).toContain('message');
  expect(validateCall({ tool: 'message', args: { to: 'me', text: 'a fun fact' } })).toMatchObject({
    ok: false,
  });
  expect(
    validateCall({ tool: 'message', args: { to: 'Sam', text: 'running late' } }),
  ).toMatchObject({ ok: true });
});
