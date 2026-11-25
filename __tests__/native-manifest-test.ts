import { readFileSync } from 'fs';
import { join } from 'path';

const manifest = readFileSync(
  join(__dirname, '../modules/sidekick-native/android/src/main/AndroidManifest.xml'),
  'utf8',
);

describe('native manifest', () => {
  it('declares SET_ALARM, which Clock requires for alarm and timer hand-offs', () => {
    expect(manifest).toContain('com.android.alarm.permission.SET_ALARM');
  });
});
