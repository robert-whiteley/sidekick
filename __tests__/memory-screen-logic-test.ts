import { integrationAvailability } from '@/features/settings/connections-logic';
import { groupByDay } from '@/features/memory/timeline-logic';

test('timeline groups by day, newest first', () => {
  const now = new Date(2026, 10, 25, 15, 0);
  const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime();
  const g = groupByDay(
    [{ at: at(25, 14) }, { at: at(25, 9) }, { at: at(24, 20) }, { at: at(20, 8) }],
    now,
  );
  expect(
    g.map((x) => (x.day.startsWith('Today') || x.day.startsWith('Yesterday') ? x.day : 'other')),
  ).toEqual(['Today', 'Yesterday', 'other']);
  expect(g[0].items).toHaveLength(2);
});

test('integrations say why they are unavailable', () => {
  const android = { platform: 'android' as const };
  expect(integrationAvailability({}, android).available).toBe(true);
  expect(
    integrationAvailability({ androidOnly: true }, { ...android, platform: 'ios' }).why,
  ).toMatch(/iPhone/);
});
