/**
 * The iPhone app must not talk about Android: no fingerprint / PIN, Play Store, Pictures/
 * folders, wake word, Quick Settings tiles… (ADR 0006 "iPhone"). Renders the settings screens as
 * an iPhone and collects every text, and checks the iPhone prompt, replies and first-run texts.
 */
import { render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import SettingsScreen from '@/app/settings';
import AdvancedSettings from '@/app/settings/advanced';
import AssistantSettings from '@/app/settings/assistant';
import CameraAudioSettings from '@/app/settings/camera';
import ConnectionSettings from '@/app/settings/connections/[id]';
import ConnectionsSettings from '@/app/settings/connections';
import PhoneFeatures from '@/app/settings/features';
import ModelsSettings from '@/app/settings/models';
import PrivacySettings from '@/app/settings/privacy';
import { phoneFeatures, readDeviceProfile } from '@/engine/device-profile';
import { allIphoneTexts, ANDROID_ONLY_WORDS, IPHONE, platformText } from '@/engine/platform-text';
import { systemPrompt } from '@/engine/prompts';
import { helpText } from '@/engine/quick-commands-logic';
import { integrationAvailability } from '@/features/settings/connections-logic';
import { EXPLAINER, introMessage } from '@/features/onboarding/first-run';
import { StorageScreen } from '@/features/storage/StorageScreen';
import { INTEGRATIONS } from '@/integrations/registry';
import { wantsCameraNow } from '@/memory/search-logic';

let mockParams: Record<string, string> = {};
jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('expo-router'),
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    useLocalSearchParams: () => mockParams,
    Stack: { Screen: () => null },
  };
});
jest.mock('@/memory/store', () => ({
  listSpeakers: async () => [],
  savedFacts: async () => [],
  recentMoments: async () => [],
  applyRetention: async () => {},
}));
jest.mock('expo-file-system', () => ({
  Paths: { totalDiskSpace: 128 * 1024 ** 3, availableDiskSpace: 60 * 1024 ** 3 },
}));
jest.mock('../modules/sidekick-native', () => ({
  __esModule: true,
  default: {
    kvGet: () => null,
    kvSet: () => {},
    readBase64: () => null,
    listenConfigure: () => {},
    countryCode: () => 'GB',
    fileExists: () => false,
    getDeviceInfo: () => ({
      manufacturer: 'Apple',
      model: 'iPhone 13 mini',
      soc: 'Apple A15',
      totalRamMb: 3800,
      filesDir: '/data',
      externalFilesDir: null,
    }),
  },
}));

/** Every string in a rendered tree: text children and the labels people (and VoiceOver) get. */
function texts(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => texts(n, out));
  else if (node && typeof node === 'object') {
    const n = node as { props?: Record<string, unknown>; children?: unknown };
    for (const k of ['placeholder', 'accessibilityLabel', 'accessibilityHint', 'title', 'label'])
      if (typeof n.props?.[k] === 'string') out.push(n.props[k] as string);
    texts(n.children, out);
  }
  return out;
}

const androidOnly = (all: string[]) => all.filter((t) => ANDROID_ONLY_WORDS.test(t));

beforeEach(() => {
  Platform.OS = 'ios';
  mockParams = {};
});

describe('iPhone screens have no Android-only words', () => {
  const SCREENS = {
    SettingsScreen,
    AdvancedSettings,
    AssistantSettings,
    CameraAudioSettings,
    ConnectionsSettings,
    PhoneFeatures,
    ModelsSettings,
    PrivacySettings,
    StorageScreen,
  };
  test.each(Object.entries(SCREENS))('%s', async (_name, Screen) => {
    await render(<Screen />);
    const all = texts(screen.toJSON());
    expect(all.length).toBeGreaterThan(3); // really rendered
    expect(androidOnly(all)).toEqual([]);
  });

  test('the check catches Android wording', async () => {
    Platform.OS = 'android';
    await render(<PrivacySettings />);
    expect(androidOnly(texts(screen.toJSON())).length).toBeGreaterThan(0);
  });

  test.each(INTEGRATIONS.map((i) => i.id))('connection %s', async (id) => {
    mockParams = { id };
    await render(<ConnectionSettings />);
    expect(androidOnly(texts(screen.toJSON()))).toEqual([]);
  });
});

describe('iPhone texts', () => {
  test('the platform text catalog', () => {
    expect(androidOnly(allIphoneTexts())).toEqual([]);
  });

  test('the system prompt says what the iPhone app can do, without Android', () => {
    const p = systemPrompt('ios');
    expect(p).not.toMatch(ANDROID_ONLY_WORDS);
    expect(p).toMatch(/camera button/);
    expect(p).toMatch(/cannot watch live video/);
  });

  test('"what can you do?", first run and phone features', () => {
    const help = helpText({
      camera: false,
      listening: false,
      memory: true,
      calendar: true,
      messages: false,
      email: false,
      online: false,
      location: true,
      iphone: true,
    });
    expect(help).toMatch(/camera button/);
    const first = [introMessage().text, ...introMessage().tries, ...EXPLAINER.map((e) => e.body)];
    const features = phoneFeatures(readDeviceProfile()).flatMap((f) => [f.name, f.why ?? '']);
    expect(androidOnly([help, ...first, ...features])).toEqual([]);
  });

  test('Google features say they are not set up, not that Apple forbids them', () => {
    const email = INTEGRATIONS.find((i) => i.google === 'gmail')!;
    expect(integrationAvailability(email, { platform: 'ios' }).why).toBe(IPHONE.googleNotSetUp);
  });

  test('privacy has no consent or "Instructions only" (nothing listens in the background)', async () => {
    await render(<PrivacySettings />);
    expect(screen.queryByText('Consent mode')).toBeNull();
    expect(screen.queryByText('Instructions only')).toBeNull();
    expect(screen.queryByText('Pause listening here')).toBeNull();
    expect(screen.getByText('Quiet hours')).toBeTruthy();
    expect(screen.getByText('Your places')).toBeTruthy();
  });
});

describe('Android keeps its wording', () => {
  test('texts and prompt', () => {
    expect(platformText('appLockHint', {}, 'android')).toMatch(/fingerprint, face or phone PIN/);
    expect(platformText('quickFixesHint', {}, 'android')).toMatch(/Play Store/);
    expect(systemPrompt('android')).not.toMatch(/iPhone/);
    expect(systemPrompt('ios').startsWith(systemPrompt('android'))).toBe(true);
  });

  test('privacy still has consent and auto-pause', async () => {
    Platform.OS = 'android';
    await render(<PrivacySettings />);
    expect(screen.getByText('Consent mode')).toBeTruthy();
    expect(screen.getByText('Auto-pause')).toBeTruthy();
  });
});

test('questions that need the camera now', () => {
  for (const q of [
    'What am I looking at?',
    'what is this?',
    'Can you see the bus?',
    'watch live',
    "what's in front of me",
  ])
    expect(wantsCameraNow(q)).toBe(true);
  for (const q of [
    'what did I see this morning?',
    'what is this word in French',
    'where did I park?',
    'what was I looking at yesterday?',
    'remind me about this tomorrow',
  ])
    expect(wantsCameraNow(q)).toBe(false);
});
