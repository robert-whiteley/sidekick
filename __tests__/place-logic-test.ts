import {
  type CityTable,
  formatMinutes,
  haversineM,
  inQuietHours,
  insidePlace,
  nearestCity,
  parseTime,
  regionAt,
} from '@/engine/place-logic';

const leeds = { lat: 53.7965, lon: -1.5478 };
const london = { lat: 51.5074, lon: -0.1278 };

test('haversine distance', () => {
  const km = haversineM(leeds, london) / 1000;
  expect(km).toBeGreaterThan(268);
  expect(km).toBeLessThan(275);
  expect(haversineM(leeds, leeds)).toBe(0);
});

test('nearest city from a small table', () => {
  const t: CityTable = {
    names: ['Leeds, GB', 'London, GB', 'Suva, FJ'],
    lat: [537965, 515074, -181416],
    lon: [-15478, -1278, 1784419],
  };
  expect(nearestCity(t, { lat: 53.8, lon: -1.55 })).toBe('Leeds, GB');
  expect(nearestCity(t, { lat: 51.5, lon: -0.1 })).toBe('London, GB');
  // Across the date line.
  expect(nearestCity(t, { lat: -18.1, lon: -179.9 }, 300)).toBe('Suva, FJ');
  // Mid-Atlantic: nothing within 30 km.
  expect(nearestCity(t, { lat: 40, lon: -40 })).toBeNull();
});

test('the bundled GeoNames table finds real towns', () => {
  const t = require('../assets/geonames/cities15000.json') as CityTable;
  expect(t.names.length).toBeGreaterThan(30000);
  expect(nearestCity(t, leeds)).toBe('Leeds, GB');
  expect(nearestCity(t, { lat: 48.8566, lon: 2.3522 })).toBe('Paris, FR');
  expect(regionAt(t, { lat: 34.05, lon: -118.24 })).toEqual({ country: 'US', admin1: 'CA' });
  expect(regionAt(t, leeds).country).toBe('GB');
  expect(regionAt(t, { lat: 0, lon: -140 })).toEqual({ country: null, admin1: null });
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
