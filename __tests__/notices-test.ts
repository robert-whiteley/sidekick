import { Notices } from '../src/engine/notices';

it('replaces an info line with the same key and holds back repeated decisions', () => {
  const n = new Notices();
  n.post({ key: 'fps', kind: 'info', text: 'Frame rate 2 → 1 fps: phone is hot (44 °C)', at: 1 });
  n.post({ key: 'fps', kind: 'info', text: 'Frame rate 1 → 0.5 fps: phone is hot (46 °C)', at: 2 });
  expect(n.all.map((x) => x.text)).toEqual(['Frame rate 1 → 0.5 fps: phone is hot (46 °C)']);
  expect(n.post({ key: 'storage', kind: 'decision', text: 'a', severity: 1, at: 10 })).toBe(true);
  expect(n.post({ key: 'storage', kind: 'decision', text: 'a', severity: 1, at: 20 })).toBe(false);
  expect(n.post({ key: 'storage', kind: 'decision', text: 'b', severity: 2, at: 30 })).toBe(true);
});

it('runs the action handler and removes the card', () => {
  const n = new Notices();
  const seen: string[] = [];
  n.post({ key: 's', kind: 'decision', text: 'x', actions: [{ label: 'Yes', id: 'yes' }] }, (a) =>
    seen.push(a),
  );
  n.act('s', 'yes');
  expect(seen).toEqual(['yes']);
  expect(n.all).toEqual([]);
});
