import { matchApp, stepBrightness } from '@/integrations/phone-controls-logic';
import { translatePrompt } from '@/integrations/translate';

test('the named app is found', () => {
  const apps = [
    { label: 'Spotify', pkg: 'com.spotify.music' },
    { label: 'Camera', pkg: 'com.google.android.GoogleCamera' },
    { label: 'Google Maps', pkg: 'com.google.android.apps.maps' },
    { label: 'Maps Lite', pkg: 'x.maps.lite' },
  ];
  expect(matchApp('spotify', apps)?.pkg).toBe('com.spotify.music');
  expect(matchApp('maps', apps)?.pkg).toBe('x.maps.lite');
  expect(matchApp('google maps', apps)?.pkg).toBe('com.google.android.apps.maps');
  expect(matchApp('the door', apps)).toBeNull();
});

test('brightness steps stay on screen', () => {
  expect(stepBrightness(90, 'up')).toBe(100);
  expect(stepBrightness(10, 'down')).toBe(1);
});

test('translation prompt keeps the text apart', () => {
  expect(translatePrompt(' hola ', 'English')).toContain('<<<\nhola\n>>>');
});
