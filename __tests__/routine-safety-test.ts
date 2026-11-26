import { NOT_IN_ROUTINES, validateCall } from '../src/engine/tools-logic';

test('a routine run never uses tools that act at once on the phone', () => {
  for (const n of ['listening', 'phone_setting', 'open_app', 'ride', 'camera', 'play'])
    expect([n, NOT_IN_ROUTINES.has(n)]).toEqual([n, true]);
  expect(NOT_IN_ROUTINES.has('weather')).toBe(false);
});

test('a message to me is refused', () => {
  expect(validateCall({ tool: 'message', args: { to: 'me', text: 'a fun fact' } })).toMatchObject({
    ok: false,
  });
  expect(
    validateCall({ tool: 'message', args: { to: 'Sam', text: 'running late' } }),
  ).toMatchObject({ ok: true });
});
