import {
  formatMinutes,
  FRAME_PLACE_MAX_GAP_MS,
  haversineM,
  inQuietHours,
  insidePlace,
  parseTime,
  placeForFrame,
} from '@/engine/place-logic';

const leeds = { lat: 53.7965, lon: -1.5478 };
const london = { lat: 51.5074, lon: -0.1278 };

test('haversine distance', () => {
  const km = haversineM(leeds, london) / 1000;
  expect(km).toBeGreaterThan(268);
  expect(km).toBeLessThan(275);
  expect(haversineM(leeds, leeds)).toBe(0);
});

test('inside a paused place', () => {
  const work = { id: '1', name: 'Work', lat: 53.8, lon: -1.55, radiusM: 150 };
  expect(insidePlace({ lat: 53.8005, lon: -1.5502 }, [work])?.name).toBe('Work');
  expect(insidePlace({ lat: 53.81, lon: -1.55 }, [work])).toBeNull();
});

test('quiet hours, same day and overnight', () => {
  const t = (s: string) => parseTime(s)!;
  expect(inQuietHours(t('13:00'), t('12:00'), t('14:00'))).toBe(true);
  expect(inQuietHours(t('14:00'), t('12:00'), t('14:00'))).toBe(false);
  expect(inQuietHours(t('23:30'), t('22:00'), t('07:00'))).toBe(true);
  expect(inQuietHours(t('06:59'), t('22:00'), t('07:00'))).toBe(true);
  expect(inQuietHours(t('07:00'), t('22:00'), t('07:00'))).toBe(false);
  expect(inQuietHours(t('12:00'), t('22:00'), t('07:00'))).toBe(false);
  expect(inQuietHours(t('12:00'), t('09:00'), t('09:00'))).toBe(false);
});

test('time parsing and formatting', () => {
  expect(parseTime('7:30')).toBe(450);
  expect(parseTime('22')).toBe(1320);
  expect(parseTime('24:00')).toBeNull();
  expect(parseTime('noon')).toBeNull();
  expect(formatMinutes(450)).toBe('07:30');
});

test('camera frames take the last position only if it is recent', () => {
  const fix = { lat: 51.5, lon: -1.2, place: 'Town', at: 1_000_000 };
  expect(placeForFrame(1_000_000 + 5 * 60_000, fix)).toBe(fix);
  expect(placeForFrame(1_000_000 - 9 * 60_000, fix)).toBe(fix);
  expect(placeForFrame(1_000_000 + FRAME_PLACE_MAX_GAP_MS + 1, fix)).toBeNull();
  expect(placeForFrame(1_000_000, null)).toBeNull();
});
