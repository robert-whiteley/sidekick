/**
 * The settings registry: every setting the app has is in it (a new one without an entry fails
 * here), and the plan for a spoken change says what changes and how risky it is.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { INTEGRATIONS } from '@/integrations/registry';
import type { Settings } from '@/engine/settings';
import {
  changeRisk,
  INTERNAL_KEYS,
  parseValue,
  planSetting,
  REGISTRY,
  type RegistryCtx,
  settingById,
  SETTING_IDS,
  switchSettingId,
} from '@/engine/settings-registry';
import { ANSWER_STYLE_MAX } from '@/engine/prompts';
import { TOOLS, validateCall } from '@/engine/tools-logic';

jest.mock('../modules/sidekick-native', () => ({
  __esModule: true,
  default: { kvGet: () => null, kvSet: () => {} },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DEFAULTS } = require('@/engine/settings') as typeof import('@/engine/settings');

const ctx = (patch: Partial<Settings> = {}): RegistryCtx => ({
  s: { ...DEFAULTS, ...patch },
  defaults: DEFAULTS,
  rec: {
    fps: 1,
    frameWindow: 2,
    imageDetail: 'medium',
    videoKeepHours: 24,
    audioKeepDays: 30,
    voice: 'pocket',
    storageReserveGB: 2,
  },
});
const def = (id: string) => {
  const d = settingById(id);
  if (!d) throw new Error(`no setting ${id}`);
  return d;
};

describe('every setting is in the registry', () => {
  it('each Settings field is a setting or listed as bookkeeping', () => {
    const keys = new Set(REGISTRY.map((d) => d.key).filter(Boolean));
    const missing = (Object.keys(DEFAULTS) as (keyof Settings)[]).filter(
      (k) => !keys.has(k) && !(k in INTERNAL_KEYS),
    );
    expect(missing).toEqual([]);
    for (const k of Object.keys(INTERNAL_KEYS)) expect(keys.has(k as keyof Settings)).toBe(false);
  });

  it('each Connections switch is a setting', () => {
    for (const i of INTEGRATIONS)
      for (const sw of i.switches) expect(settingById(switchSettingId(i.id, sw.id))).toBeTruthy();
  });

  it('ids are unique, and each has a name, a description and a type that fits', () => {
    expect(new Set(SETTING_IDS).size).toBe(SETTING_IDS.length);
    const dynamic = new Set(['ai_model', 'camera_device', 'microphone', 'sound_output']);
    for (const d of REGISTRY) {
      expect(d.name).toBeTruthy();
      expect(d.desc).toBeTruthy();
      if (d.type === 'choice' && !dynamic.has(d.id)) expect(d.choices?.length).toBeGreaterThan(1);
      if (d.store === 'settings') expect(d.key).toBeTruthy();
      if (d.risk !== 'normal' && d.type !== 'action')
        expect(d.consequence ?? d.riskOf).toBeTruthy();
    }
    expect(def('answer_style').maxLength).toBe(ANSWER_STYLE_MAX);
  });

  /**
   * Everything a settings screen imports from the app's stores is either a registry setting or
   * classified here. A screen that starts using something new fails until it is added to the
   * registry (or listed as read-only / one item of the user's data).
   */
  const SCREEN_IMPORTS: Record<string, string> = {
    // Changes a registry setting.
    updateSettings: 'settings',
    setSwitch: 'prefs',
    connectGoogle: 'prefs',
    setChatChoice: 'ai_model',
    setCamera: 'camera_device',
    setAudioOverride: 'microphone',
    setStillsKeepDays: 'keep_stills',
    addPausePlaceHere: 'pause_places',
    removePausePlace: 'pause_places',
    pickFolder: 'folders',
    removeFolder: 'folders',
    deleteRoutine: 'routines',
    updateRoutine: 'routines',
    editRoutine: 'routines',
    routineRequest: 'routines',
    deleteRange: 'delete_today',
    deleteSource: 'delete_source',
    deleteAllData: 'delete_everything',
    exportAllData: 'export_data',
    backupNow: 'back_up_now',
    deletePictureModel: 'delete_picture_model',
    downloadPictureModel: 'download_picture_model',
    resetBackendChoice: 'measure_ai_chip',
    unloadLlm: 'measure_ai_chip',
    allowExactReminders: 'exact_times',
    openExactRoutineSettings: 'exact_times',
    clearTrack: 'delete_location_history',
    requestContacts: 'contacts_source',
    clearContacts: 'contacts_source',
    requestCalendar: 'calendar_source',
    setNotificationCapture: 'notifications_source',
    openNotificationAccess: 'notifications_source',
    askLocationPermission: 'location_memory',
    // Work a change does (run by app-settings.ts too), or reading and showing values.
    applyRetention: 'read',
    applySpeechModel: 'read',
    configureListening: 'read',
    pushAssistantPrompt: 'read',
    pushPauseRules: 'read',
    syncNow: 'read',
    refreshPlaces: 'read',
    askNotificationPermission: 'read',
    askToDelete: 'read',
    // One item of the user's own data, not a setting (people, facts, follow-ups, notes, places).
    acceptSuggestedName: 'item',
    dismissSuggestedName: 'item',
    nameSpeaker: 'item',
    deleteSpeaker: 'item',
    deleteFact: 'item',
    saveFact: 'item',
    deleteMoment: 'item',
    addNote: 'item',
    addToCalendar: 'item',
    deleteFollowup: 'item',
    dismissFollowup: 'item',
    updateFollowup: 'item',
    deletePlace: 'item',
    renamePlace: 'item',
  };
  const READ_ONLY =
    /^([A-Z_]+|get|on|is|has|list|count|format|read|recommended|saved|phone|speed|picture|exact|stills|measure|check|catalog|available|bytes|chat|active|update(State)?$|lock|law|current|kind|parse|describe|named|track|folder|notification|google|drive|captionMode|platformText|integration|normalise|wake|speakerLabel|watch|cancel|confirm|pending|typed)/;

  it('screens use nothing that is not in the registry', () => {
    const root = join(__dirname, '..', 'src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.tsx')) files.push(p);
      }
    };
    walk(join(root, 'app', 'settings'));
    walk(join(root, 'features', 'settings'));
    walk(join(root, 'features', 'storage'));
    files.push(join(root, 'app', 'storage.tsx'));
    const unknown: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const re = /import\s+\{([^}]*)\}\s+from\s+'@\/(?:engine|memory|integrations|web)\/[^']+'/g;
      for (const m of src.matchAll(re))
        for (const raw of m[1].split(',')) {
          const name = raw.trim();
          if (!name || name.startsWith('type ')) continue;
          const c = SCREEN_IMPORTS[name];
          if (c === undefined && !READ_ONLY.test(name)) unknown.push(`${name} (${f})`);
          if (c && c !== 'read' && c !== 'item' && c !== 'settings' && c !== 'prefs')
            expect(settingById(c)).toBeTruthy();
        }
    }
    expect(unknown).toEqual([]);
  });

  it('the app_setting tool offers every setting by id', () => {
    const tool = TOOLS.find((t) => t.name === 'app_setting')!;
    expect(tool.args.setting.values).toEqual([...SETTING_IDS, 'all']);
    expect(validateCall({ tool: 'app_setting', args: { setting: 'web lookup' } }).ok).toBe(false);
    expect(
      validateCall({ tool: 'app_setting', args: { do: 'on', setting: 'online_lookup' } }),
    ).toEqual({ ok: true, args: { do: 'on', setting: 'online_lookup' } });
  });
});

describe('how risky a change is', () => {
  const risk = (id: string, next: unknown, cur: unknown) =>
    changeRisk(def(id), next as never, cur as never);

  it('turning off a protection, sending out and mobile-data downloads need approval', () => {
    expect(risk('online_lookup', true, false)).toBe('critical');
    expect(risk('online_lookup', false, true)).toBe('normal');
    expect(risk('consent_mode', 'off', 'auto')).toBe('critical');
    expect(risk('consent_mode', 'auto', 'on')).toBe('critical');
    expect(risk('consent_mode', 'on', 'off')).toBe('normal');
    expect(risk('app_lock', false, true)).toBe('critical');
    expect(risk('app_lock', true, false)).toBe('normal');
    expect(risk('instructions_only', false, true)).toBe('critical');
    expect(risk('mobile_data_downloads', 'auto', 'ask')).toBe('critical');
    expect(risk('mobile_data_downloads', 'off', 'ask')).toBe('normal');
    expect(risk('sending', 'instant', 'countdown')).toBe('critical');
    expect(risk('quick_fixes', true, false)).toBe('critical');
    expect(risk('email_send', true, false)).toBe('critical');
    expect(risk('email_send', false, true)).toBe('normal');
    expect(def('export_data').risk).toBe('critical');
    expect(def('back_up_now').risk).toBe('critical');
  });

  it('deleting data, indexes or models needs the typed confirmation', () => {
    for (const id of [
      'delete_everything',
      'delete_today',
      'delete_last_hour',
      'delete_source',
      'delete_picture_model',
      'delete_location_history',
    ])
      expect(def(id).risk).toBe('destructive');
    expect(risk('keep_video', 2, 24)).toBe('destructive');
    expect(risk('keep_video', 72, 24)).toBe('critical');
    expect(risk('keep_memories', 30, 0)).toBe('destructive');
    expect(risk('keep_memories', 0, 30)).toBe('critical');
    expect(risk('folders', [], ['Documents'])).toBe('destructive');
    expect(risk('folders', ['Documents'], [])).toBe('normal');
  });

  it('everyday changes apply at once', () => {
    expect(risk('image_detail', 'high', 'medium')).toBe('normal');
    expect(risk('speech_speed', 1.2, 1)).toBe('normal');
    expect(risk('camera_lens', 'front', 'back')).toBe('normal');
    expect(risk('voice', 'system', 'auto')).toBe('normal');
  });
});

describe('reading a value as said', () => {
  it('switches, choices, numbers and times', () => {
    expect(parseValue(def('online_lookup'), 'On')).toEqual({ ok: true, value: true });
    expect(parseValue(def('online_lookup'), false)).toEqual({ ok: true, value: false });
    expect(parseValue(def('image_detail'), 'High')).toEqual({ ok: true, value: 'high' });
    expect(parseValue(def('voice'), "phone's voice")).toEqual({ ok: true, value: 'system' });
    expect(parseValue(def('keep_video'), '20 hours')).toEqual({ ok: true, value: 24 });
    expect(parseValue(def('speech_speed'), '120%')).toEqual({ ok: true, value: 1.2 });
    expect(parseValue(def('speech_speed'), 1.5)).toEqual({ ok: true, value: 1.5 });
    expect(parseValue(def('quiet_hours_start'), '22:30')).toEqual({ ok: true, value: 1350 });
    const bad = parseValue(def('image_detail'), 'purple');
    expect(bad).toEqual({ ok: false, error: 'Image detail can be Low, Medium or High.' });
  });
});

describe('planning a spoken change', () => {
  it('a normal change confirms in one line', () => {
    const p = planSetting(def('image_detail'), 'set', 'high', 'medium', ctx());
    expect(p).toMatchObject({ kind: 'change', next: 'high', risk: 'normal' });
    expect(p.kind === 'change' && p.text).toBe('Image detail is now High.');
  });

  it('a critical change asks for a tap, with what it means', () => {
    const p = planSetting(def('online_lookup'), 'on', undefined, false, ctx());
    expect(p).toMatchObject({ kind: 'change', next: true, risk: 'critical' });
    if (p.kind !== 'change') throw new Error();
    expect(p.text).toBe('Tap Approve to turn on online lookup.');
    expect(p.consequence).toMatch(/Wikipedia and DuckDuckGo/);
  });

  it('a deletion points to the confirmation screen', () => {
    const p = planSetting(def('delete_everything'), 'set', undefined, null, ctx());
    expect(p).toMatchObject({ kind: 'change', risk: 'destructive' });
    expect(p.kind === 'change' && p.text).toMatch(/type DELETE/);
    const src = planSetting(def('delete_source'), 'set', 'calendar events', null, ctx());
    expect(src).toMatchObject({ kind: 'change', next: 'calendar', risk: 'destructive' });
  });

  it('already set, steps, toggles and back to Recommended', () => {
    expect(planSetting(def('online_lookup'), 'off', undefined, false, ctx())).toEqual({
      kind: 'say',
      text: 'Online lookup is already off.',
    });
    expect(planSetting(def('image_detail'), 'up', undefined, 'high', ctx())).toEqual({
      kind: 'say',
      text: 'Image detail is already at the highest: High.',
    });
    expect(planSetting(def('keep_audio'), 'up', undefined, 365, ctx())).toMatchObject({
      next: 0, // forever is the longest
    });
    expect(planSetting(def('vibrate'), 'toggle', undefined, true, ctx())).toMatchObject({
      next: false,
      risk: 'normal',
    });
    const r = planSetting(def('frames_per_second'), 'reset', undefined, 2, ctx());
    expect(r.kind === 'change' && r.text).toBe(
      'Frames per second is now 1 a second (Recommended).',
    );
  });

  it('lists add and remove by name', () => {
    const cur = ['Documents', 'Downloads'];
    const p = planSetting(def('folders'), 'remove', 'documents', cur, ctx());
    expect(p).toMatchObject({ next: ['Downloads'], item: 'Documents', risk: 'destructive' });
    expect(planSetting(def('folders'), 'remove', 'photos', cur, ctx())).toEqual({
      kind: 'say',
      text: 'Which one? Picked folders: Documents, Downloads.',
    });
  });

  it('get says the value', () => {
    expect(planSetting(def('consent_mode'), 'get', undefined, 'auto', ctx())).toEqual({
      kind: 'say',
      text: 'Consent mode: Automatic.',
    });
  });
});
