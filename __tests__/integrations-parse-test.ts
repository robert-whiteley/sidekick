import { clockTime } from '../src/integrations/parse';

test('clock times keep the hour as said', () => {
  expect(clockTime('6')).toEqual({ hour: 6, minute: 0 });
  expect(clockTime('7:30')).toEqual({ hour: 7, minute: 30 });
  expect(clockTime('6.45 pm')).toEqual({ hour: 18, minute: 45 });
  expect(clockTime('half past seven')).toEqual({ hour: 7, minute: 30 });
  expect(clockTime('quarter to six')).toEqual({ hour: 5, minute: 45 });
  expect(clockTime('noon')).toEqual({ hour: 12, minute: 0 });
  expect(clockTime('soon')).toBeNull();
});
