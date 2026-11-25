import { Platform } from 'react-native';

import SidekickNative from '../modules/sidekick-native';
import { StreamingSpeaker } from '../src/engine/speaker';

const mockSpoken: string[] = [];
jest.mock('expo-speech', () => ({
  speak: (t: string) => mockSpoken.push(t),
  stop: jest.fn(),
}));
jest.mock('../modules/sidekick-native', () => ({
  __esModule: true,
  default: {
    setMicPaused: jest.fn(),
    voiceBegin: jest.fn(() => 7),
    voiceSay: jest.fn(),
    voiceEnd: jest.fn(),
    voiceStop: jest.fn(),
    voiceSetChoice: jest.fn(),
    kvGet: jest.fn(() => null),
  },
}));

beforeEach(() => {
  mockSpoken.length = 0;
});

test('the first sentence is spoken as soon as it is complete, while the rest streams', () => {
  const sp = new StreamingSpeaker(true);
  let full = '';
  const stream = (chunk: string) => {
    full += chunk;
    sp.update(full);
  };
  stream('The sky');
  stream(' is blue.');
  expect(mockSpoken).toEqual([]); // could still be "blue.5" etc.
  stream(' Light');
  expect(mockSpoken).toEqual(['The sky is blue.']);
  stream(' scatters. And');
  expect(mockSpoken).toEqual(['The sky is blue.', 'Light scatters.']);
  stream(' more');
  sp.finish(full);
  expect(mockSpoken).toEqual(['The sky is blue.', 'Light scatters.', 'And more']);
});

test('nothing is spoken twice and nothing when speaking is off', () => {
  const sp = new StreamingSpeaker(true);
  sp.update('One. Two');
  sp.update('One. Two');
  sp.finish('One. Two');
  expect(mockSpoken).toEqual(['One.', 'Two']);
  const off = new StreamingSpeaker(false);
  off.update('Hi. There');
  off.finish('Hi. There');
  expect(mockSpoken).toEqual(['One.', 'Two']);
});

test('on Android the native voice speaks, tied to one answer id, and Stop stops it', () => {
  const native = jest.mocked(SidekickNative);
  const os = Platform.OS;
  native.setMicPaused.mockClear();
  Platform.OS = 'android';
  try {
    const sp = new StreamingSpeaker(true);
    sp.update('Hello there. How');
    sp.finish('Hello there. How are you');
    expect(native.voiceSay.mock.calls).toEqual([
      ['Hello there.', 7],
      ['How are you', 7],
    ]);
    expect(native.voiceEnd).toHaveBeenCalledWith(7);
    expect(native.setMicPaused).not.toHaveBeenCalled();
    expect(mockSpoken).toEqual([]);
    sp.stop();
    expect(native.voiceStop).toHaveBeenCalledTimes(1);
    sp.stop(); // already stopped: nothing more
    expect(native.voiceStop).toHaveBeenCalledTimes(1);
  } finally {
    Platform.OS = os;
  }
});

test('a reply that replaces the first one is spoken from its start', () => {
  const sp = new StreamingSpeaker(true);
  sp.update('I do not know that. ');
  sp.update('The fund changed in 2021. It moved ');
  expect(mockSpoken).toEqual(['I do not know that.', 'The fund changed in 2021.']);
});

test('the voice setting reaches the native voice once, before an answer', () => {
  const os = Platform.OS;
  Platform.OS = 'android';
  try {
    new StreamingSpeaker(true);
    new StreamingSpeaker(true);
    expect(SidekickNative.voiceSetChoice).toHaveBeenCalledTimes(1);
    expect(SidekickNative.voiceSetChoice).toHaveBeenCalledWith('auto');
  } finally {
    Platform.OS = os;
  }
});
