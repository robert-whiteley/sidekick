import {
  matchApp,
  parseControl,
  safeWhenLocked,
  stepBrightness,
} from '@/integrations/phone-controls-logic';
import { parseTranslate, translatePrompt } from '@/integrations/translate';

test('phone controls are recognised', () => {
  expect(parseControl('open Spotify')).toEqual({ type: 'openApp', name: 'Spotify' });
  expect(parseControl('launch the camera app')).toEqual({ type: 'openApp', name: 'camera' });
  expect(parseControl('turn on the torch')).toEqual({ type: 'torch', on: true });
  expect(parseControl('flashlight off please')).toEqual({ type: 'torch', on: false });
  expect(parseControl('volume up')).toEqual({ type: 'volume', dir: 'up' });
  expect(parseControl('turn the volume down')).toEqual({ type: 'volume', dir: 'down' });
  expect(parseControl('mute')).toEqual({ type: 'volume', dir: 'mute' });
  expect(parseControl('set volume to 30%')).toEqual({ type: 'volume', dir: 'set', percent: 30 });
  expect(parseControl('turn on do not disturb')).toEqual({ type: 'dnd', on: true });
  expect(parseControl('switch DND off')).toEqual({ type: 'dnd', on: false });
  expect(parseControl('brightness 50 percent')).toEqual({ type: 'brightness', percent: 50 });
  expect(parseControl('make the screen brighter')).toEqual({ type: 'brightness', percent: 'up' });
  expect(parseControl('auto brightness')).toEqual({ type: 'brightness', percent: 'auto' });
  expect(parseControl('turn off wifi')).toEqual({ type: 'panel', kind: 'wifi', on: false });
  expect(parseControl('turn on bluetooth')).toEqual({ type: 'panel', kind: 'bluetooth', on: true });
  expect(parseControl('switch on airplane mode')).toEqual({
    type: 'panel',
    kind: 'airplane',
    on: true,
  });
  expect(parseControl('turn off mobile data')).toEqual({
    type: 'panel',
    kind: 'internet',
    on: false,
  });
  expect(parseControl('play Bohemian Rhapsody on Spotify')).toEqual({
    type: 'play',
    query: 'Bohemian Rhapsody',
    app: 'Spotify',
  });
  expect(parseControl('play some jazz')).toEqual({ type: 'play', query: 'jazz', app: null });
  expect(parseControl("what's on my screen?")).toEqual({ type: 'screen' });
});

test('ordinary questions are not controls', () => {
  expect(parseControl('play')).toBeNull();
  expect(parseControl('play the next song')).toBeNull();
  expect(parseControl('open directions to the station')).toBeNull();
  expect(parseControl('what volume of water is in a bath')).toBeNull();
  expect(parseControl('what did Sam say about the wifi password')).toBeNull();
});

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

test('only safe things run while locked', () => {
  expect(safeWhenLocked({ type: 'torch', on: true }, 'torch on', false)).toBe(true);
  expect(safeWhenLocked({ type: 'openApp', name: 'Messages' }, 'open messages', false)).toBe(false);
  expect(safeWhenLocked(null, "what's 2 plus 2", true)).toBe(true);
  expect(safeWhenLocked(null, 'set a timer for 10 minutes', false)).toBe(true);
  expect(safeWhenLocked(null, 'text Sam I set an alarm', false)).toBe(false);
  expect(safeWhenLocked(null, 'what did Sam say', false)).toBe(false);
});

test('translation requests', () => {
  expect(parseTranslate('translate good morning into Spanish')).toEqual({
    text: 'good morning',
    target: 'Spanish',
    fromView: false,
  });
  expect(parseTranslate('how do you say thank you in Japanese?')).toEqual({
    text: 'thank you',
    target: 'Japanese',
    fromView: false,
  });
  expect(parseTranslate('translate this')).toEqual({ text: '', target: 'English', fromView: true });
  expect(parseTranslate('translate this sign into French')).toEqual({
    text: '',
    target: 'French',
    fromView: true,
  });
  expect(parseTranslate('what does this say')).toEqual({
    text: '',
    target: 'English',
    fromView: true,
  });
  expect(parseTranslate('what is the capital of France')).toBeNull();
  expect(translatePrompt(' hola ', 'English')).toContain('<<<\nhola\n>>>');
});
