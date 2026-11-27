/**
 * Every setting Sidekick has, described once: id, plain name, type and range, a short
 * description and how risky a change is. The app_setting tool (tools-logic.ts) reads and changes
 * any of them by voice or chat; the screens stay as they are. A test fails when a setting exists
 * that is not in here (__tests__/settings-registry-test.ts).
 *
 * Risk, for a change asked by voice or chat:
 * - normal: applied at once, with Undo on the reply.
 * - critical (reversible, but it records, keeps or sends more, weakens a lock or check, grants an
 *   OS permission, or downloads over mobile data): a card with the consequence and an Approve
 *   button that works only after a short delay and expires.
 * - destructive (deletes data, memories, indexes or models): a confirmation sheet that says what
 *   is deleted and needs DELETE typed. Never by voice alone, never by one tap.
 *
 * Pure (no app state): values are read and written through a context. Tested.
 */
import { INTEGRATIONS } from '@/integrations/registry';
import { captionMode } from '@/memory/photo-text';
import { daysLabel, hoursLabel } from '@/ui/choice-logic';
import { APP_LOCK_AFTER_MIN, APP_LOCK_CHOICES, lockAfterLabel } from './app-lock-logic';
import { formatMinutes, parseTime } from './place-logic';
import { MAX_RATE, MIN_RATE } from './quick-commands-logic';
import type { Settings } from './settings';
import {
  AUDIO_KEEP_OPTIONS,
  FPS_OPTIONS,
  FRAME_WINDOW_OPTIONS,
  RESERVE_OPTIONS,
  VIDEO_KEEP_OPTIONS,
} from './setting-options';

export type Risk = 'normal' | 'critical' | 'destructive';
export type SettingType = 'boolean' | 'choice' | 'number' | 'text' | 'time' | 'list' | 'action';
export type SettingValue = boolean | number | string | string[] | null;
export type Choice = { value: string | number | boolean; label: string };

export type SectionId =
  | 'assistant'
  | 'camera'
  | 'privacy'
  | 'connections'
  | 'advanced'
  | 'storage'
  | 'models'
  | 'routines'
  | 'interpreter'
  | 'data';

export const SECTION_NAMES: Record<SectionId, string> = {
  assistant: 'Assistant',
  camera: 'Camera & audio',
  privacy: 'Privacy',
  connections: 'Connections',
  advanced: 'Advanced',
  storage: 'Storage',
  models: 'Models',
  routines: 'Routines',
  interpreter: 'Interpreter',
  data: 'Your data',
};

/** Where the setting's screen is, for "Open settings" on a reply. */
export const SECTION_HREF: Record<SectionId, string> = {
  assistant: '/settings/assistant',
  camera: '/settings/camera',
  privacy: '/settings/privacy',
  connections: '/settings/connections',
  advanced: '/settings/advanced',
  storage: '/storage',
  models: '/settings/models',
  routines: '/settings/routines',
  interpreter: '/interpret',
  data: '/settings/privacy',
};

/** Runtime work done after a change is saved (app-settings.ts). */
export type EffectId =
  | 'listening'
  | 'pauseRules'
  | 'retention'
  | 'speechModel'
  | 'answerStyle'
  | 'appLock'
  | 'contacts'
  | 'calendar'
  | 'notifications'
  | 'folders'
  | 'location'
  | 'wakeWord';

/** The Recommended values for this phone that a setting can follow (device-profile.ts). */
export type RecommendedLike = {
  fps: number;
  frameWindow: number;
  imageDetail: string;
  videoKeepHours: number;
  audioKeepDays: number;
  voice: string;
  storageReserveGB: number;
};

export type RegistryCtx = {
  s: Settings;
  rec: RecommendedLike;
  defaults: Settings;
};

export type SettingDef = {
  id: string;
  name: string;
  desc: string;
  section: SectionId;
  type: SettingType;
  choices?: Choice[];
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  /** How a value is said ("1 week", "120%"). */
  format?: (v: SettingValue) => string;
  /**
   * settings: a plain field of Settings (key). prefs: an integration switch (prefs.ts). runtime:
   * kept elsewhere or done by app-settings.ts (lists, models, devices, routines, actions).
   */
  store: 'settings' | 'prefs' | 'runtime';
  /** The Settings field this setting is (also for runtime lists kept in Settings). */
  key?: keyof Settings;
  /** null in Settings means "follow this Recommended value". */
  recommended?: (c: RegistryCtx) => SettingValue;
  /** How the saved field reads as this setting's value, when not plain. */
  read?: (s: Settings) => SettingValue;
  /** The most risky a change to it can be. */
  risk: Risk;
  /** The risk of this particular change (default: [risk] for every change). */
  riskOf?: (next: SettingValue, cur: SettingValue) => Risk;
  /** What happens, said on the approval card or the delete sheet. */
  consequence?: string | ((next: SettingValue, cur: SettingValue) => string);
  /** For actions: what it does, as "Tap Approve to …" ends ("delete everything from today"). */
  verb?: string;
  /** Android only (why not on iPhone: docs/decisions/0006). */
  android?: boolean;
  effect?: EffectId;
};

// --- Helpers for the definitions ---

const onOff = (v: SettingValue) => (v ? 'on' : 'off');
const opts = (values: (string | number | boolean)[], label: (v: never) => string): Choice[] =>
  values.map((v) => ({ value: v, label: label(v as never) }));
const labelOf = (choices: Choice[]) => (v: SettingValue) =>
  choices.find((c) => c.value === v)?.label ?? String(v);
/** Risky only when switched on (records, keeps or sends more). */
const whenOn =
  (r: Risk) =>
  (next: SettingValue): Risk =>
    next ? r : 'normal';
/** Risky only when switched off (a protection). */
const whenOff =
  (r: Risk) =>
  (next: SettingValue): Risk =>
    next ? 'normal' : r;
/** Keep periods: shorter deletes what is older (destructive); longer keeps more (critical). */
const keepRisk = (next: SettingValue, cur: SettingValue): Risk => {
  const forever = (v: SettingValue) => (v === 0 || v === null ? Infinity : Number(v));
  return forever(next) < forever(cur) ? 'destructive' : 'critical';
};
const keepConsequence =
  (what: string, fmt: (v: SettingValue) => string) =>
  (next: SettingValue, cur: SettingValue): string =>
    keepRisk(next, cur) === 'destructive'
      ? `${what} older than ${fmt(next)} is deleted for good.`
      : `${what} is kept for ${fmt(next)} instead of ${fmt(cur)}.`;

const CHOICES = {
  fps: opts(FPS_OPTIONS, (v: number) => `${v} a second`),
  frameWindow: opts(FRAME_WINDOW_OPTIONS, (v: number) => `${v}`),
  detail: opts(['low', 'medium', 'high'], (v: string) => v[0].toUpperCase() + v.slice(1)),
  video: opts(VIDEO_KEEP_OPTIONS, hoursLabel),
  audio: opts(AUDIO_KEEP_OPTIONS, daysLabel),
  stills: opts([30, 90, 365, 36500], (v: number) => (v >= 36500 ? 'Forever' : daysLabel(v))),
  reserve: opts(RESERVE_OPTIONS, (v: number) => `${v} GB`),
  retention: [
    { value: 30, label: '30 days' },
    { value: 90, label: '90 days' },
    { value: 365, label: '1 year' },
    { value: 0, label: 'Forever' },
  ],
  lockAfter: opts([...APP_LOCK_CHOICES], lockAfterLabel),
};

const s = (key: keyof Settings, d: Omit<SettingDef, 'store' | 'key'>): SettingDef => ({
  store: 'settings',
  key,
  ...d,
});

/** Settings fields that are bookkeeping, not settings (never shown or changed). */
export const INTERNAL_KEYS: Partial<Record<keyof Settings, string>> = {
  followupDigest: 'old daily briefing switch, moved into a routine at start-up',
  digestHour: 'old daily briefing hour, moved into a routine at start-up',
  lastBriefingAt: 'when the briefing was last spoken',
  lastDriveBackupAt: 'when Drive last took a backup',
  measuredTokPerSec: 'measured model speed',
  measuredVoiceFirstSoundMs: 'measured voice start-up',
};

// --- Every setting ---

const STATIC: SettingDef[] = [
  // Assistant
  s('answerStyle', {
    id: 'answer_style',
    name: 'How Sidekick answers',
    desc: 'your own short instructions for every answer (empty for none)',
    section: 'assistant',
    type: 'text',
    maxLength: 300,
    risk: 'normal',
    effect: 'answerStyle',
  }),
  s('wakePhrase', {
    id: 'wake_word',
    name: 'Wake word',
    desc: 'what you say to start a question',
    section: 'assistant',
    type: 'text',
    maxLength: 40,
    risk: 'normal',
    android: true,
    effect: 'wakeWord',
  }),
  s('speakAnswers', {
    id: 'speak_answers',
    name: 'Speak answers',
    desc: 'say answers out loud',
    section: 'assistant',
    type: 'boolean',
    risk: 'normal',
    effect: 'listening',
  }),
  s('understandOtherLanguages', {
    id: 'understand_other_languages',
    name: 'Understand other languages around me',
    desc: '24 more European languages heard and translated into English (0.5 GB on Wi-Fi)',
    section: 'assistant',
    type: 'boolean',
    risk: 'normal',
    android: true,
    effect: 'speechModel',
  }),
  s('voiceChoice', {
    id: 'voice',
    name: 'Voice for answers',
    desc: 'the natural voice or the phone’s own voice',
    section: 'assistant',
    type: 'choice',
    choices: [
      { value: 'auto', label: 'Recommended' },
      { value: 'pocket', label: 'Natural voice' },
      { value: 'system', label: "Phone's voice" },
    ],
    risk: 'normal',
    android: true,
  }),
  s('speechRate', {
    id: 'speech_speed',
    name: 'Speech speed',
    desc: 'how fast answers are spoken, 50% to 200%',
    section: 'assistant',
    type: 'number',
    min: MIN_RATE,
    max: MAX_RATE,
    step: 0.15,
    format: (v) => `${Math.round(Number(v) * 100)}%`,
    recommended: () => 1,
    risk: 'normal',
  }),
  s('readBack', {
    id: 'read_back',
    name: 'Read back before sending',
    desc: 'read a message aloud and wait for yes before it sends',
    section: 'assistant',
    type: 'choice',
    choices: [
      { value: 'voice', label: 'When I speak' },
      { value: 'always', label: 'Always' },
      { value: 'off', label: 'Off' },
    ],
    recommended: () => 'voice',
    risk: 'critical',
    riskOf: (next) => (next === 'off' ? 'critical' : 'normal'),
    consequence: 'Messages you dictate are no longer read back to you before they go.',
  }),
  s('handsFree', {
    id: 'driving_walking_mode',
    name: 'Driving and walking mode',
    desc: 'spoken answers, read-back and bigger buttons when driving or walking',
    section: 'assistant',
    type: 'choice',
    choices: [
      { value: 'auto', label: 'Automatic' },
      { value: 'on', label: 'Always on' },
      { value: 'off', label: 'Off' },
    ],
    recommended: () => 'auto',
    risk: 'normal',
  }),
  s('quietSpeech', {
    id: 'quiet_at_night',
    name: 'Quiet at night',
    desc: 'no speaking out loud in quiet hours or Do Not Disturb, except into headphones',
    section: 'assistant',
    type: 'boolean',
    recommended: () => true,
    risk: 'normal',
  }),
  s('haptics', {
    id: 'vibrate',
    name: 'Vibrate on send and listen',
    desc: 'a light tick on send, cancel and when listening starts',
    section: 'assistant',
    type: 'boolean',
    recommended: () => true,
    risk: 'normal',
  }),
  s('modelUpdates', {
    id: 'better_models',
    name: 'Better models',
    desc: 'download better AI models on Wi-Fi while charging and switch automatically',
    section: 'models',
    type: 'choice',
    choices: [
      { value: 'auto', label: 'Automatic' },
      { value: 'ask', label: 'Ask me first' },
      { value: 'off', label: 'Off' },
    ],
    risk: 'normal',
  }),
  s('suggestFollowups', {
    id: 'suggest_follow_ups',
    name: 'Suggest follow-ups',
    desc: 'propose to-dos, events and reminders from what is said (each waits for approval)',
    section: 'assistant',
    type: 'boolean',
    risk: 'normal',
  }),
  s('conversationNotes', {
    id: 'conversation_notes',
    name: 'Live conversation notes',
    desc: 'notes of each conversation heard with Listen on',
    section: 'assistant',
    type: 'choice',
    choices: [
      { value: 'auto', label: 'On' },
      { value: 'off', label: 'Off' },
    ],
    recommended: () => 'auto',
    risk: 'normal',
    android: true,
  }),

  // Camera & audio
  s('cameraLens', {
    id: 'camera_lens',
    name: 'Phone camera',
    desc: 'which side of the phone films',
    section: 'camera',
    type: 'choice',
    choices: [
      { value: 'back', label: 'Back' },
      { value: 'front', label: 'Front' },
    ],
    risk: 'normal',
    android: true,
  }),
  s('fps', {
    id: 'frames_per_second',
    name: 'Frames per second',
    desc: 'camera frames remembered each second',
    section: 'camera',
    type: 'choice',
    choices: CHOICES.fps,
    recommended: (c) => c.rec.fps,
    risk: 'normal',
    android: true,
  }),
  s('frameWindow', {
    id: 'frames_per_question',
    name: 'Frames per question',
    desc: 'recent frames looked at for a question',
    section: 'camera',
    type: 'choice',
    choices: CHOICES.frameWindow,
    recommended: (c) => c.rec.frameWindow,
    risk: 'normal',
    android: true,
  }),
  s('imageDetail', {
    id: 'image_detail',
    name: 'Image detail',
    desc: 'higher reads small text better but answers more slowly',
    section: 'camera',
    type: 'choice',
    choices: CHOICES.detail,
    recommended: (c) => c.rec.imageDetail,
    risk: 'normal',
    android: true,
  }),
  s('cameraWhileLocked', {
    id: 'film_when_locked',
    name: 'Keep filming when the phone is locked',
    desc: 'the live camera keeps remembering with the screen off',
    section: 'camera',
    type: 'boolean',
    risk: 'critical',
    riskOf: whenOn('critical'),
    consequence: 'The camera keeps filming and remembering while the phone is locked.',
    android: true,
  }),
  s('captionFrames', {
    id: 'describe_camera_frames',
    name: 'Describe camera frames',
    desc: 'write what each stored frame shows while idle, so later questions work',
    section: 'camera',
    type: 'choice',
    choices: [
      { value: 'off', label: 'Off' },
      { value: 'charging', label: 'While charging' },
      { value: 'always', label: 'On battery too' },
    ],
    read: (x) => captionMode(x.captionFrames),
    risk: 'normal',
  }),
  s('recordConversations', {
    id: 'remember_conversations',
    name: 'Remember conversations',
    desc: 'keep transcripts of what is said around you while listening',
    section: 'camera',
    type: 'boolean',
    risk: 'critical',
    riskOf: whenOn('critical'),
    consequence: 'What people around you say is transcribed and kept while listening.',
    android: true,
    effect: 'listening',
  }),
  s('showConversation', {
    id: 'show_conversation',
    name: 'Show conversation',
    desc: 'show what is said on the main screen while listening (display only)',
    section: 'camera',
    type: 'boolean',
    risk: 'normal',
    android: true,
  }),
  s('rememberPhotos', {
    id: 'remember_photos',
    name: 'Remember photos',
    desc: 'keep photos you ask about, so later questions can look again',
    section: 'camera',
    type: 'boolean',
    risk: 'critical',
    riskOf: whenOn('critical'),
    consequence: 'Photos you ask about are kept in memory.',
    effect: 'listening',
  }),

  // Privacy
  s('appLock', {
    id: 'app_lock',
    name: 'App lock',
    desc: 'face, fingerprint or the phone’s PIN to open Sidekick',
    section: 'privacy',
    type: 'boolean',
    risk: 'critical',
    riskOf: whenOff('critical'),
    consequence: 'Anyone holding the unlocked phone can open Sidekick and your memories.',
    effect: 'appLock',
  }),
  s('appLockAfterMin', {
    id: 'app_lock_ask_again',
    name: 'App lock asks again',
    desc: 'minutes away before the lock asks again',
    section: 'privacy',
    type: 'choice',
    choices: CHOICES.lockAfter,
    format: (v) => lockAfterLabel(Number(v)),
    recommended: () => APP_LOCK_AFTER_MIN,
    risk: 'critical',
    riskOf: (next, cur) => (Number(next) > Number(cur) ? 'critical' : 'normal'),
    consequence: 'Sidekick stays open longer without asking for your face, fingerprint or PIN.',
  }),
  s('instructionsOnly', {
    id: 'instructions_only',
    name: 'Instructions only',
    desc: 'with other people: nothing around you is transcribed or kept',
    section: 'privacy',
    type: 'boolean',
    risk: 'critical',
    riskOf: whenOff('critical'),
    consequence: 'What is said around you is transcribed and kept again while listening.',
    android: true,
    effect: 'listening',
  }),
  s('consent', {
    id: 'consent_mode',
    name: 'Consent mode',
    desc: 'only keep other people’s speech after they agree; Automatic follows the local law',
    section: 'privacy',
    type: 'choice',
    choices: [
      { value: 'auto', label: 'Automatic' },
      { value: 'on', label: 'On' },
      { value: 'off', label: 'Off' },
    ],
    risk: 'critical',
    riskOf: (next, cur) =>
      next === 'off' || (cur === 'on' && next === 'auto') ? 'critical' : 'normal',
    consequence: 'Other people’s speech can be kept without them agreeing first.',
    android: true,
    effect: 'listening',
  }),
  s('locationMemory', {
    id: 'location_memory',
    name: 'Remember where I was',
    desc: 'location track, named places and parking, kept on the phone',
    section: 'privacy',
    type: 'boolean',
    risk: 'critical',
    riskOf: whenOn('critical'),
    consequence: 'Sidekick records where you go (it asks for the location permission first).',
    effect: 'location',
  }),
  s('quietHours', {
    id: 'quiet_hours',
    name: 'Quiet hours',
    desc: 'listening pauses every day between the start and end times',
    section: 'privacy',
    type: 'boolean',
    risk: 'critical',
    riskOf: whenOff('critical'),
    consequence: 'Listening no longer pauses at night.',
    android: true,
    effect: 'pauseRules',
  }),
  s('quietStart', {
    id: 'quiet_hours_start',
    name: 'Quiet hours start',
    desc: 'when listening pauses (24-hour time)',
    section: 'privacy',
    type: 'time',
    format: (v) => formatMinutes(Number(v)),
    risk: 'normal',
    effect: 'pauseRules',
  }),
  s('quietEnd', {
    id: 'quiet_hours_end',
    name: 'Quiet hours end',
    desc: 'when listening starts again (24-hour time)',
    section: 'privacy',
    type: 'time',
    format: (v) => formatMinutes(Number(v)),
    risk: 'normal',
    effect: 'pauseRules',
  }),
  {
    id: 'pause_places',
    name: 'Places where listening pauses',
    desc: 'add the place you are at now, or remove one by name',
    section: 'privacy',
    type: 'list',
    store: 'runtime',
    key: 'pausePlaces',
    read: (x) => x.pausePlaces.map((p) => p.name),
    risk: 'critical',
    riskOf: (next, cur) =>
      Array.isArray(next) && Array.isArray(cur) && next.length < cur.length ? 'critical' : 'normal',
    consequence: 'Listening no longer pauses at that place.',
    android: true,
  },
  s('webLookup', {
    id: 'online_lookup',
    name: 'Online lookup',
    desc: 'look things up on Wikipedia and DuckDuckGo (sends only the question)',
    section: 'privacy',
    type: 'boolean',
    risk: 'critical',
    riskOf: whenOn('critical'),
    consequence: 'Your questions that need the internet are sent to Wikipedia and DuckDuckGo.',
  }),
  s('searxngUrl', {
    id: 'searxng_server',
    name: 'Your own search server',
    desc: 'a SearXNG address (https) used for online lookups; empty for none',
    section: 'privacy',
    type: 'text',
    maxLength: 200,
    risk: 'critical',
    riskOf: (next) => (next ? 'critical' : 'normal'),
    consequence: 'Your online questions are sent to that server.',
  }),
  {
    id: 'news_feeds',
    name: 'News feeds',
    desc: 'RSS or Atom feeds (https) read for news questions',
    section: 'privacy',
    type: 'list',
    store: 'runtime',
    key: 'newsFeeds',
    risk: 'critical',
    riskOf: (next, cur) =>
      Array.isArray(next) && Array.isArray(cur) && next.length > cur.length ? 'critical' : 'normal',
    consequence: 'Sidekick fetches that feed over the internet for news questions.',
  },
  s('retentionDays', {
    id: 'keep_memories',
    name: 'Keep memories for',
    desc: 'older memories are deleted automatically',
    section: 'privacy',
    type: 'choice',
    choices: CHOICES.retention,
    format: (v) => (Number(v) === 0 ? 'Forever' : daysLabel(Number(v))),
    risk: 'destructive',
    riskOf: keepRisk,
    consequence: keepConsequence('Every memory', (v) =>
      Number(v) === 0 ? 'forever' : daysLabel(Number(v)).toLowerCase(),
    ),
    effect: 'retention',
  }),
  s('suggestSensitiveFacts', {
    id: 'suggest_private_facts',
    name: 'Suggest private facts',
    desc: 'suggest saving facts about health, beliefs, sexuality, politics or money',
    section: 'privacy',
    type: 'boolean',
    risk: 'critical',
    riskOf: whenOn('critical'),
    consequence:
      'Sidekick may suggest saving facts about health, beliefs, sexuality, politics or money.',
  }),
  s('offTheRecord', {
    id: 'off_the_record',
    name: 'Off the record',
    desc: 'use memories but save nothing until you leave it (or restart)',
    section: 'privacy',
    type: 'boolean',
    risk: 'critical',
    riskOf: whenOff('critical'),
    consequence: 'What you say and ask is saved again.',
  }),

  // Connections
  s('actionSend', {
    id: 'sending',
    name: 'Sending',
    desc: 'messages, emails, events and calls: after a 5 s countdown, at once, or ask first',
    section: 'connections',
    type: 'choice',
    choices: [
      { value: 'countdown', label: 'After 5 s' },
      { value: 'instant', label: 'At once' },
      { value: 'ask', label: 'Ask me first' },
    ],
    risk: 'critical',
    riskOf: (next) => (next === 'instant' ? 'critical' : 'normal'),
    consequence: 'Messages, emails and calls go at once, with no countdown to stop them.',
  }),
  s('readIncoming', {
    id: 'read_messages_aloud',
    name: 'Read new messages aloud',
    desc: 'read new messages as they arrive',
    section: 'connections',
    type: 'choice',
    choices: [
      { value: 'off', label: 'Off' },
      { value: 'headphones', label: 'With headphones or in the car' },
      { value: 'always', label: 'Always' },
    ],
    recommended: () => 'off',
    risk: 'critical',
    riskOf: (next) => (next === 'always' ? 'critical' : 'normal'),
    consequence: 'New messages are read out loud, where people nearby can hear them.',
    android: true,
  }),
  s('sourceNotes', {
    id: 'notes_source',
    name: 'Notes',
    desc: 'notes you type for Sidekick to remember',
    section: 'connections',
    type: 'boolean',
    risk: 'normal',
  }),
  s('sourceFolders', {
    id: 'folders_source',
    name: 'Folders',
    desc: 'read documents, spreadsheets and PDFs in folders you pick',
    section: 'connections',
    type: 'boolean',
    risk: 'normal',
    effect: 'folders',
  }),
  {
    id: 'folders',
    name: 'Picked folders',
    desc: 'add a folder (the folder picker opens) or remove one by name',
    section: 'connections',
    type: 'list',
    store: 'runtime',
    key: 'folderUris',
    risk: 'destructive',
    riskOf: (next, cur) =>
      Array.isArray(next) && Array.isArray(cur) && next.length < cur.length
        ? 'destructive'
        : 'normal',
    consequence: 'What Sidekick read from that folder is deleted. Your files are not touched.',
  },
  s('sourceContacts', {
    id: 'contacts_source',
    name: 'Contacts',
    desc: 'a read-only copy of your contacts, for numbers and naming voices',
    section: 'connections',
    type: 'boolean',
    // Off deletes only Sidekick's copy (read again when turned back on): reversible.
    risk: 'critical',
    consequence: (next) =>
      next
        ? 'Sidekick asks for the contacts permission and keeps a copy of your contacts.'
        : 'Sidekick’s copy of your contacts is deleted. Your contacts are not touched.',
    effect: 'contacts',
  }),
  s('sourceCalendar', {
    id: 'calendar_source',
    name: 'Calendar',
    desc: 'events from the past and coming year, read only',
    section: 'connections',
    type: 'boolean',
    risk: 'critical',
    riskOf: whenOn('critical'),
    consequence: 'Sidekick asks for the calendar permission and reads your events.',
    effect: 'calendar',
  }),
  s('sourceNotifications', {
    id: 'notifications_source',
    name: 'Notifications',
    desc: 'keep the text of other apps’ notifications',
    section: 'connections',
    type: 'boolean',
    risk: 'critical',
    riskOf: whenOn('critical'),
    consequence:
      'Sidekick keeps the text of every app’s notifications (needs Notification access).',
    android: true,
    effect: 'notifications',
  }),

  // Advanced and storage
  s('storageReserveGB', {
    id: 'storage_reserve',
    name: 'Always keep free for the phone',
    desc: 'space left free for the phone',
    section: 'advanced',
    type: 'choice',
    choices: CHOICES.reserve,
    recommended: (c) => c.rec.storageReserveGB,
    risk: 'normal',
  }),
  s('mobileDataDownloads', {
    id: 'mobile_data_downloads',
    name: 'Large downloads on mobile data',
    desc: 'ask me, allow, or Wi-Fi only',
    section: 'advanced',
    type: 'choice',
    choices: [
      { value: 'ask', label: 'Ask me' },
      { value: 'auto', label: 'Allow' },
      { value: 'off', label: 'Wi-Fi only' },
    ],
    risk: 'critical',
    riskOf: (next) => (next === 'auto' ? 'critical' : 'normal'),
    consequence: 'Large downloads (models of 1 GB or more) can use your mobile data allowance.',
  }),
  s('quickFixes', {
    id: 'quick_fixes',
    name: 'Get quick fixes',
    desc: 'small app updates on Wi-Fi; off means the app never contacts Expo',
    section: 'advanced',
    type: 'boolean',
    risk: 'critical',
    riskOf: whenOn('critical'),
    consequence: 'The app checks Expo’s update server on Wi-Fi for fixes.',
  }),
  s('videoKeepHours', {
    id: 'keep_video',
    name: 'Keep video for',
    desc: 'rolling camera video (about 0.5 GB an hour)',
    section: 'storage',
    type: 'choice',
    choices: CHOICES.video,
    format: (v) => hoursLabel(Number(v)),
    recommended: (c) => c.rec.videoKeepHours,
    risk: 'destructive',
    riskOf: keepRisk,
    consequence: keepConsequence('Video', (v) => hoursLabel(Number(v)).toLowerCase()),
    android: true,
  }),
  s('audioKeepDays', {
    id: 'keep_audio',
    name: 'Keep conversation audio for',
    desc: 'audio for listening back (about 7 MB an hour of speech)',
    section: 'storage',
    type: 'choice',
    choices: CHOICES.audio,
    format: (v) => daysLabel(Number(v)),
    recommended: (c) => c.rec.audioKeepDays,
    risk: 'destructive',
    riskOf: keepRisk,
    consequence: keepConsequence('Conversation audio', (v) => daysLabel(Number(v)).toLowerCase()),
    android: true,
  }),
  {
    id: 'keep_stills',
    name: 'Keep camera stills for',
    desc: 'still frames from the camera',
    section: 'storage',
    type: 'choice',
    store: 'runtime',
    choices: CHOICES.stills,
    format: labelOf(CHOICES.stills),
    risk: 'destructive',
    riskOf: (next, cur) => keepRisk(next === 36500 ? 0 : next, cur === 36500 ? 0 : cur),
    consequence: keepConsequence('Camera stills', (v) => labelOf(CHOICES.stills)(v).toLowerCase()),
    android: true,
  },

  // Models and pictures
  {
    id: 'ai_model',
    name: 'AI model',
    desc: 'Recommended for this phone, or a fixed model',
    section: 'models',
    type: 'choice',
    store: 'runtime',
    risk: 'normal',
  },
  {
    id: 'download_picture_model',
    name: 'Download the picture model',
    desc: 'the optional 0.7 GB model for making pictures; its terms are shown first',
    section: 'models',
    type: 'action',
    store: 'runtime',
    risk: 'critical',
    verb: 'open the picture model’s terms',
    consequence: 'The picture model’s terms open; downloading means agreeing to them.',
    android: true,
  },
  {
    id: 'delete_picture_model',
    name: 'Delete the picture model',
    desc: 'frees 0.7 GB; pictures already made stay',
    section: 'models',
    type: 'action',
    store: 'runtime',
    risk: 'destructive',
    verb: 'delete the picture model',
    consequence: 'The picture model (0.7 GB) is deleted. Pictures already made stay.',
    android: true,
  },
  {
    id: 'measure_ai_chip',
    name: 'Measure the AI chip again',
    desc: 'time each chip again on the next question and use the fastest',
    section: 'advanced',
    type: 'action',
    store: 'runtime',
    risk: 'normal',
    verb: 'measure the AI chip again',
    android: true,
  },

  // Devices
  {
    id: 'camera_device',
    name: 'Camera',
    desc: 'a plugged-in USB camera or the phone camera',
    section: 'camera',
    type: 'choice',
    store: 'runtime',
    risk: 'normal',
    android: true,
  },
  {
    id: 'microphone',
    name: 'Microphone',
    desc: 'camera, headphone or phone microphone',
    section: 'camera',
    type: 'choice',
    store: 'runtime',
    risk: 'normal',
    android: true,
  },
  {
    id: 'sound_output',
    name: 'Sound',
    desc: 'headphones or the phone speaker',
    section: 'camera',
    type: 'choice',
    store: 'runtime',
    risk: 'normal',
    android: true,
  },

  // Quick ways to ask (Android)
  {
    id: 'phone_assistant',
    name: 'Phone assistant',
    desc: 'make Sidekick the phone’s assistant, to ask about the screen (system settings)',
    section: 'assistant',
    type: 'action',
    store: 'runtime',
    risk: 'critical',
    verb: 'open the phone’s assistant settings',
    consequence: 'As the phone’s assistant, Sidekick can see the screen when you ask it to.',
    android: true,
  },
  {
    id: 'quick_settings_tile',
    name: 'Quick Settings tile',
    desc: 'add the Ask Sidekick tile',
    section: 'assistant',
    type: 'action',
    store: 'runtime',
    risk: 'normal',
    verb: 'add the Quick Settings tile',
    android: true,
  },
  {
    id: 'home_screen_widget',
    name: 'Home-screen widget',
    desc: 'add the Sidekick widget',
    section: 'assistant',
    type: 'action',
    store: 'runtime',
    risk: 'normal',
    verb: 'add the home-screen widget',
    android: true,
  },
  {
    id: 'exact_times',
    name: 'Exact reminder and routine times',
    desc: 'Android’s Alarms & reminders permission, so nothing runs late',
    section: 'routines',
    type: 'action',
    store: 'runtime',
    risk: 'critical',
    verb: 'open the Alarms & reminders permission',
    consequence: 'Sidekick may wake the phone at the exact time of reminders and routines.',
    android: true,
  },

  // Routines
  {
    id: 'routines',
    name: 'Routines',
    desc: 'things Sidekick does by itself; pause, resume or delete one by name',
    section: 'routines',
    type: 'list',
    store: 'runtime',
    risk: 'destructive',
    riskOf: (next, cur) =>
      Array.isArray(next) && Array.isArray(cur) && next.length < cur.length
        ? 'destructive'
        : 'normal',
    consequence: 'The routine is deleted.',
    android: true,
  },

  // Interpreter
  {
    id: 'interpreter_languages',
    name: 'Interpreter languages',
    desc: 'languages whose speech model is kept for interpreting',
    section: 'interpreter',
    type: 'list',
    store: 'runtime',
    key: 'interpreterLanguages',
    read: (x) => x.interpreterLanguages ?? [],
    risk: 'critical',
    riskOf: (next, cur) =>
      Array.isArray(next) && Array.isArray(cur) && next.length < cur.length ? 'critical' : 'normal',
    consequence: 'Its speech model may be deleted to free space; it downloads again when needed.',
  },

  // Your data
  {
    id: 'export_data',
    name: 'Export everything',
    desc: 'copy all your data to a folder you choose',
    section: 'data',
    type: 'action',
    store: 'runtime',
    risk: 'critical',
    verb: 'export everything to a folder you choose',
    consequence: 'A full unencrypted copy of your memories, photos and audio leaves the app.',
  },
  {
    id: 'back_up_now',
    name: 'Back up to Google Drive now',
    desc: 'the same zip as Export everything, to your Google Drive',
    section: 'data',
    type: 'action',
    store: 'runtime',
    risk: 'critical',
    verb: 'back up everything to Google Drive now',
    consequence: 'A copy of all your data is uploaded to your Google Drive.',
    android: true,
  },
  {
    id: 'delete_last_hour',
    name: 'Delete the last hour',
    desc: 'everything from the last hour',
    section: 'data',
    type: 'action',
    store: 'runtime',
    risk: 'destructive',
    verb: 'delete everything from the last hour',
  },
  {
    id: 'delete_today',
    name: 'Delete today',
    desc: 'everything from today',
    section: 'data',
    type: 'action',
    store: 'runtime',
    risk: 'destructive',
    verb: 'delete everything from today',
  },
  {
    id: 'delete_source',
    name: 'Delete one source',
    desc: 'everything kept from notes, folders, calendar, contacts or notifications',
    section: 'data',
    type: 'action',
    store: 'runtime',
    choices: [
      { value: 'notes', label: 'Notes' },
      { value: 'folders', label: 'Files read from folders' },
      { value: 'calendar', label: 'Calendar events' },
      { value: 'contacts', label: 'Contacts copy' },
      { value: 'notifications', label: 'Notifications' },
    ],
    risk: 'destructive',
    verb: 'delete everything kept from one source',
  },
  {
    id: 'delete_location_history',
    name: 'Delete location history',
    desc: 'every remembered position and the town names on memories (named places stay)',
    section: 'data',
    type: 'action',
    store: 'runtime',
    risk: 'destructive',
    verb: 'delete your location history',
  },
  {
    id: 'delete_everything',
    name: 'Delete everything',
    desc: 'all memories, people, facts, photos, video, settings and models',
    section: 'data',
    type: 'action',
    store: 'runtime',
    risk: 'destructive',
    verb: 'delete everything',
  },
];

/** Integration switches (Settings → Connections → each app): one setting each. */
const snake = (x: string) => x.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
export const switchSettingId = (integration: string, sw: string) =>
  `${snake(integration)}_${snake(sw)}`;

const SWITCHES: SettingDef[] = INTEGRATIONS.flatMap((i) =>
  i.switches.map((sw): SettingDef => ({
    id: switchSettingId(i.id, sw.id),
    name: `${i.name}: ${sw.label}`,
    desc: i.description,
    section: 'connections',
    type: 'boolean',
    store: 'prefs',
    // Turning an app on gives Sidekick access to it (and Google ones sign in to Google).
    risk: 'critical',
    riskOf: whenOn('critical'),
    consequence: i.google
      ? `Sidekick signs in to Google for ${i.name} and can use it.`
      : `Sidekick can use ${i.name}: ${sw.label.toLowerCase()}.`,
    android: !!i.androidOnly && !sw.iphone,
  })),
);

/** Where each integration switch lives (prefs.ts): setting id → integration and switch. */
export const SWITCH_OF: Record<string, { integration: string; sw: string; google?: string }> =
  Object.fromEntries(
    INTEGRATIONS.flatMap((i) =>
      i.switches.map((sw) => [
        switchSettingId(i.id, sw.id),
        { integration: i.id, sw: sw.id, google: i.google },
      ]),
    ),
  );

export const REGISTRY: SettingDef[] = [...STATIC, ...SWITCHES];

export const settingById = (id: string) => REGISTRY.find((d) => d.id === id);

/** The ids, for the app_setting tool's schema. */
export const SETTING_IDS: string[] = REGISTRY.map((d) => d.id);

// --- Reading, parsing and saying values ---

const norm = (v: unknown) =>
  String(v)
    .toLowerCase()
    .replace(/[^a-z0-9.%: ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** A Settings-backed setting's current value (Recommended when unset). */
export function readValue(d: SettingDef, c: RegistryCtx): SettingValue {
  if (d.read) return d.read(c.s);
  if (!d.key) return null;
  const raw = c.s[d.key] as SettingValue | undefined;
  if (raw !== null && raw !== undefined) return raw;
  return d.recommended?.(c) ?? (c.defaults[d.key] as SettingValue) ?? null;
}

/** The Settings patch that saves [v] (null where it equals the Recommended value). */
export function writePatch(d: SettingDef, v: SettingValue, c: RegistryCtx): Partial<Settings> {
  if (!d.key) return {};
  const rec = d.recommended?.(c);
  const save = d.recommended && v === rec ? null : v;
  return { [d.key]: save } as Partial<Settings>;
}

/** What "reset" means: the Recommended value, else the default. */
export function resetValue(d: SettingDef, c: RegistryCtx): SettingValue {
  if (d.recommended) return d.recommended(c);
  return d.key ? ((c.defaults[d.key] as SettingValue) ?? null) : null;
}

export type Parsed = { ok: true; value: SettingValue } | { ok: false; error: string };

/** What a setting can be, in a few words ("on or off", "Low, Medium or High"). */
export function rangeText(d: SettingDef, choices = d.choices): string {
  switch (d.type) {
    case 'boolean':
      return 'on or off';
    case 'number':
      return `from ${formatValue(d, d.min ?? 0)} to ${formatValue(d, d.max ?? 0)}`;
    case 'time':
      return 'a time like 22:00';
    case 'text':
      return `some text (up to ${d.maxLength ?? 200} characters)`;
    default: {
      const l = (choices ?? []).map((c) => c.label);
      return l.length > 1 ? `${l.slice(0, -1).join(', ')} or ${l[l.length - 1]}` : (l[0] ?? '');
    }
  }
}

/**
 * The model's value for [d] as a real value: a choice by its value or label, a number within
 * range (a choice of numbers takes the nearest), a time, text. No guessing beyond that.
 */
export function parseValue(d: SettingDef, raw: unknown, choices = d.choices): Parsed {
  const bad: Parsed = { ok: false, error: `${d.name} can be ${rangeText(d, choices)}.` };
  if (raw === undefined || raw === null || raw === '') return bad;
  switch (d.type) {
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      const t = norm(raw);
      if (/^(true|yes|on|1)$/.test(t)) return { ok: true, value: true };
      if (/^(false|no|off|0)$/.test(t)) return { ok: true, value: false };
      return bad;
    }
    case 'number': {
      let n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      if (!Number.isFinite(n)) return bad;
      // A percentage for a rate ("120%", 120) means 1.2.
      if (d.format?.(1) === '100%' && (n > (d.max ?? Infinity) || /%/.test(String(raw))))
        n = n / 100;
      if ((d.min !== undefined && n < d.min) || (d.max !== undefined && n > d.max)) return bad;
      return { ok: true, value: Math.round(n * 100) / 100 };
    }
    case 'time': {
      const t = typeof raw === 'number' ? raw : parseTime(String(raw));
      return t === null || !Number.isFinite(t) ? bad : { ok: true, value: t };
    }
    case 'text': {
      const t = String(raw).trim();
      return t.length > (d.maxLength ?? 200) ? bad : { ok: true, value: t };
    }
    case 'choice':
    case 'action': {
      const list = choices ?? [];
      const t = norm(raw);
      const hit = list.find((c) => norm(c.value) === t || norm(c.label) === t);
      if (hit) return { ok: true, value: hit.value };
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      const nums = list.filter((c) => typeof c.value === 'number');
      if (Number.isFinite(n) && nums.length) {
        const near = nums.reduce((b, c) =>
          Math.abs(Number(c.value) - n) < Math.abs(Number(b.value) - n) ? c : b,
        );
        return { ok: true, value: near.value };
      }
      return bad;
    }
    default:
      return { ok: true, value: String(raw).trim() };
  }
}

/** One step up or down: the next choice in order, or a number by its step. Null at the end. */
export function stepValue(
  d: SettingDef,
  cur: SettingValue,
  dir: 'up' | 'down',
  choices = d.choices,
): SettingValue | null {
  if (d.type === 'number') {
    const n = Number(cur) + (dir === 'up' ? 1 : -1) * (d.step ?? 1);
    const v = Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, Math.round(n * 100) / 100));
    return v === cur ? null : v;
  }
  if (d.type === 'boolean') return dir === 'up' ? (cur ? null : true) : cur ? false : null;
  const list = choices ?? [];
  const numeric = list.length > 0 && list.every((c) => typeof c.value === 'number');
  const ordered = numeric
    ? [...list].sort((a, b) => order(Number(a.value)) - order(Number(b.value)))
    : list;
  const i = ordered.findIndex((c) => c.value === cur);
  const j = i + (dir === 'up' ? 1 : -1);
  return i < 0 || j < 0 || j >= ordered.length ? null : ordered[j].value;
}
/** 0 days (forever) is the longest keep period. */
const order = (n: number) => (n === 0 ? Infinity : n);

export function formatValue(d: SettingDef, v: SettingValue, choices = d.choices): string {
  if (v === null || v === undefined) return 'not set';
  if (d.format) return d.format(v);
  if (d.type === 'boolean') return onOff(v);
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'none';
  if (d.type === 'text') return v === '' ? 'empty' : `“${v}”`;
  const c = choices?.find((x) => x.value === v);
  return c ? c.label : String(v);
}

const lowerName = (n: string) => (/^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n);

/** The risk of changing [d] from [cur] to [next]. */
export function changeRisk(d: SettingDef, next: SettingValue, cur: SettingValue): Risk {
  return d.riskOf ? d.riskOf(next, cur) : d.risk;
}

/** What the change does, as words after "Tap Approve to …". */
export function changePhrase(
  d: SettingDef,
  next: SettingValue,
  cur: SettingValue,
  item?: string,
  choices = d.choices,
): string {
  if (d.type === 'action')
    return item
      ? `${d.verb ?? lowerName(d.name)}: ${formatValue(d, item, choices).toLowerCase()}`
      : (d.verb ?? lowerName(d.name));
  if (d.type === 'boolean') return `turn ${onOff(next)} ${lowerName(d.name)}`;
  if (d.type === 'list' && Array.isArray(next) && Array.isArray(cur)) {
    const what = item ? `“${item}”` : 'it';
    return next.length < cur.length
      ? `remove ${what} from ${lowerName(d.name)}`
      : `add ${what} to ${lowerName(d.name)}`;
  }
  return `set ${lowerName(d.name)} to ${formatValue(d, next, choices)}`;
}

export function consequenceOf(d: SettingDef, next: SettingValue, cur: SettingValue): string {
  return typeof d.consequence === 'function' ? d.consequence(next, cur) : (d.consequence ?? '');
}

/** The spoken line for a change waiting on the card or the sheet. */
export function approvalLine(risk: Risk, phrase: string): string {
  return risk === 'destructive'
    ? `To ${phrase}, check what is deleted and type DELETE on the screen that opened.`
    : `Tap Approve to ${phrase}.`;
}

/** The one-line confirmation: "Online lookup is now on." */
export function confirmLine(d: SettingDef, v: SettingValue, c?: RegistryCtx, choices = d.choices) {
  const rec = c && d.recommended ? d.recommended(c) : undefined;
  const tag = rec !== undefined && v === rec ? ' (Recommended)' : '';
  return `${d.name} is now ${formatValue(d, v, choices)}${tag}.`;
}

/** "Online lookup: off" for a get. */
export function describeLine(d: SettingDef, v: SettingValue, choices = d.choices): string {
  return d.type === 'action' ? `${d.name}: ${d.desc}` : `${d.name}: ${formatValue(d, v, choices)}`;
}

// --- What a request does to one setting ---

export const SETTING_OPS = [
  'get',
  'set',
  'on',
  'off',
  'toggle',
  'up',
  'down',
  'reset',
  'add',
  'remove',
  'list',
] as const;
export type SettingOp = (typeof SETTING_OPS)[number];

export type SettingPlan =
  /** Nothing to change: say this. */
  | { kind: 'say'; text: string }
  /**
   * A change: [text] is the confirmation (normal) or the "Tap Approve…" line (critical,
   * destructive). [item]: the list entry added or removed, or the action's choice.
   */
  | {
      kind: 'change';
      next: SettingValue;
      cur: SettingValue;
      item?: string;
      risk: Risk;
      phrase: string;
      consequence: string;
      text: string;
    };

/** The entry of [list] that [said] names (same words, any case), or null. */
export function findItem(list: string[], said: string): string | null {
  const t = norm(said);
  if (!t) return null;
  return list.find((x) => norm(x) === t) ?? list.find((x) => norm(x).includes(t)) ?? null;
}

const upperFirst = (t: string) => t[0].toUpperCase() + t.slice(1);

/**
 * The model's call for [d] (op and value) against its current value: what to change and how
 * risky that is, or what to say. Pure; the change itself is app-settings.ts.
 */
export function planSetting(
  d: SettingDef,
  op: SettingOp,
  raw: unknown,
  cur: SettingValue,
  c: RegistryCtx,
  choices = d.choices,
): SettingPlan {
  const say = (text: string): SettingPlan => ({ kind: 'say', text });
  const change = (next: SettingValue, item?: string): SettingPlan => {
    const risk = d.type === 'action' ? d.risk : changeRisk(d, next, cur);
    const phrase = changePhrase(d, next, cur, item, choices);
    const done =
      d.type === 'action'
        ? `${upperFirst(phrase)}.`
        : d.type === 'list'
          ? `${upperFirst(phrase)}: done.`
          : confirmLine(d, next, c, choices);
    return {
      kind: 'change',
      next,
      cur,
      item,
      risk,
      phrase,
      consequence: consequenceOf(d, next, cur),
      text: risk === 'normal' ? done : approvalLine(risk, phrase),
    };
  };

  if (op === 'get' || op === 'list') {
    if (d.type === 'action') return say(`${d.name}: ${d.desc}.`);
    return say(`${describeLine(d, cur, choices)}.`);
  }

  if (d.type === 'action') {
    if (choices?.length) {
      const p = parseValue(d, raw, choices);
      return p.ok ? change(p.value, String(p.value)) : say(`Which one? ${rangeText(d, choices)}.`);
    }
    return change(true);
  }

  if (d.type === 'list') {
    const list = Array.isArray(cur) ? cur : [];
    const said = raw === undefined || raw === null ? '' : String(raw).trim();
    if (op === 'remove' || op === 'off') {
      const hit = findItem(list, said);
      if (!hit)
        return say(
          list.length
            ? `Which one? ${d.name}: ${list.join(', ')}.`
            : `There are no ${lowerName(d.name)}.`,
        );
      return change(
        list.filter((x) => x !== hit),
        hit,
      );
    }
    if (op === 'add' || op === 'set' || op === 'on') {
      if (said && findItem(list, said) === said) return say(`“${said}” is already there.`);
      return change([...list, said], said || undefined);
    }
    return say(`${describeLine(d, cur, choices)}.`);
  }

  let next: SettingValue;
  switch (op) {
    case 'on':
    case 'off':
      if (d.type === 'boolean') next = op === 'on';
      else {
        const p = parseValue(d, raw ?? op, choices);
        if (!p.ok) return say(p.error);
        next = p.value;
      }
      break;
    case 'toggle':
      if (d.type !== 'boolean') return say(`${d.name} can be ${rangeText(d, choices)}.`);
      next = !cur;
      break;
    case 'up':
    case 'down': {
      const n = stepValue(d, cur, op, choices);
      if (n === null)
        return say(
          `${d.name} is already at the ${op === 'up' ? 'highest' : 'lowest'}: ${formatValue(d, cur, choices)}.`,
        );
      next = n;
      break;
    }
    case 'reset':
      next = resetValue(d, c);
      break;
    default: {
      // A plain on/off given as the value of a switch ("set online lookup on").
      const p = parseValue(d, raw, choices);
      if (!p.ok) return say(p.error);
      next = p.value;
    }
  }
  if (next === cur) return say(`${d.name} is already ${formatValue(d, cur, choices)}.`);
  return change(next);
}

/** The settings shown for "what are my X settings" (the section of the one named). */
export function sectionDefs(section: SectionId, platform: string): SettingDef[] {
  return REGISTRY.filter(
    (d) => d.section === section && d.type !== 'action' && (platform !== 'ios' || !d.android),
  );
}
