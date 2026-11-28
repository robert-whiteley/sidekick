/**
 * The two levels of protection for spoken settings changes: an approval card that works only
 * after a short delay and expires (critical), and the delete sheet that needs DELETE typed
 * (destructive). Normal changes apply at once with Undo.
 */
import { Platform } from 'react-native';

import {
  cancelDelete,
  confirmDelete,
  pendingDelete,
  requestDelete,
  typedConfirms,
} from '@/engine/delete-confirm';
import { actionable, APPROVE_ARM_MS, APPROVE_EXPIRES_MS, Notices, notices } from '@/engine/notices';

const mockStore: Record<string, string> = {};
jest.mock('../modules/sidekick-native', () => ({
  __esModule: true,
  default: {
    kvGet: (k: string) => mockStore[k] ?? null,
    kvSet: (k: string, v: string) => {
      mockStore[k] = v;
    },
    getDeviceInfo: () => ({ soc: '', totalRamMb: 8000 }),
  },
}));
jest.mock('expo-local-authentication', () => ({
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));
jest.mock('@/engine/device-profile', () => ({
  recommended: () => ({
    fps: 1,
    frameWindow: 2,
    imageDetail: 'medium',
    videoKeepHours: 24,
    audioKeepDays: 30,
    voice: 'pocket',
    storageReserveGB: 2,
  }),
}));
jest.mock('@/engine/listen', () => ({
  configureListening: jest.fn(),
  pushAssistantPrompt: jest.fn(),
  wakeLine: (p: string) => ({ line: p, phrase: p }),
}));
jest.mock('@/engine/language', () => ({ applySpeechModel: jest.fn() }));
jest.mock('@/engine/llm', () => ({ resetBackendChoice: jest.fn(), unloadLlm: jest.fn() }));
jest.mock('@/engine/devices', () => ({
  listInputs: () => ({ cameras: [], mics: [] }),
  listOutputs: () => [],
  setAudioOverride: jest.fn(),
  setCamera: jest.fn(),
}));
jest.mock('@/engine/drive-backup-schedule', () => ({ backupNow: jest.fn() }));
jest.mock('@/engine/followup-notify', () => ({ allowExactReminders: jest.fn() }));
jest.mock('@/engine/model-updates', () => ({
  chatChoice: () => 'recommended',
  setChatChoice: jest.fn(),
}));
jest.mock('@/engine/places', () => ({
  addPausePlaceHere: jest.fn(),
  askLocationPermission: jest.fn(async () => true),
  pushPauseRules: jest.fn(),
  removePausePlace: jest.fn(),
}));
jest.mock('@/engine/routines-store', () => ({
  deleteRoutine: jest.fn(),
  listRoutines: () => [],
  openExactRoutineSettings: jest.fn(),
  updateRoutine: jest.fn(),
}));
jest.mock('@/engine/storage-monitor', () => ({
  diskSpace: () => ({ free: 1e10, total: 1e11 }),
  keepPeriods: () => ({ videoKeepHours: 24, audioKeepDays: 30, stillsKeepDays: 90 }),
  measureUsageNow: async () => ({
    video: 2e9,
    stills: 0,
    photos: 0,
    audio: 1e8,
    text: 0,
    models: 0,
  }),
  setStillsKeepDays: jest.fn(),
  stillsKeepDays: () => null,
}));
jest.mock('@/engine/data-export', () => ({ deleteAllData: jest.fn(), exportAllData: jest.fn() }));
jest.mock('@/engine/picture', () => ({ deletePictureModel: jest.fn() }));
jest.mock('@/integrations/google', () => ({ connectGoogle: jest.fn(async () => true) }));
jest.mock('@/memory/gallery', () => ({
  addPhotoFolder: jest.fn(async () => null),
  chooseMorePhotos: jest.fn(),
  galleryStats: async () => ({ photos: 1200, read: 900, done: 1000, failed: 0 }),
  PHOTO_FOLDERS: { camera: 'camera', screenshots: 'shots' },
  removePhotoFolder: jest.fn(),
  removePhotoIndex: jest.fn(),
  setPhotoSearch: jest.fn(async () => 'none'),
}));
jest.mock('@/memory/places-store', () => ({ clearTrack: jest.fn(), trackSize: async () => 12 }));
jest.mock('@/memory/store', () => ({
  applyRetention: jest.fn(),
  countMoments: jest.fn(async () => 42),
  deleteRange: jest.fn(),
}));
jest.mock('@/memory/sources', () => ({
  clearContacts: jest.fn(),
  countKind: async () => 7,
  deleteSource: jest.fn(),
  folderLabel: (u: string) => u,
  notificationAccessGranted: () => true,
  openNotificationAccess: jest.fn(),
  pickFolder: jest.fn(),
  removeFolder: jest.fn(),
  requestCalendar: jest.fn(async () => true),
  requestContacts: jest.fn(async () => true),
  fileLabel: (u: string) => u,
  PICK_START: { documents: 'docs', downloads: 'dl' },
  pickFiles: jest.fn(async () => 0),
  removePickedFile: jest.fn(),
  setNotificationCapture: jest.fn(),
  stopFolders: jest.fn(),
  syncNow: jest.fn(async () => 0),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { appSettingTool } =
  require('@/engine/app-settings') as typeof import('@/engine/app-settings');
const { getSettings, updateSettings } =
  require('@/engine/settings') as typeof import('@/engine/settings');
const { deleteAllData } = require('@/engine/data-export') as { deleteAllData: jest.Mock };
const gallery = require('@/memory/gallery') as Record<string, jest.Mock>;
const sources = require('@/memory/sources') as Record<string, jest.Mock>;
/* eslint-enable @typescript-eslint/no-require-imports */

beforeAll(() => {
  Platform.OS = 'android';
});
afterAll(() => {
  Platform.OS = 'ios';
});

const clearNotices = () => notices.all.forEach((n) => notices.dismiss(n.key));
beforeEach(() => {
  clearNotices();
  cancelDelete();
  updateSettings({ webLookup: false, imageDetail: null, consent: 'auto' });
});

describe('approval cards', () => {
  it('a tap before the delay or after expiry does nothing', () => {
    const list = new Notices();
    const ran = jest.fn();
    list.post(
      { key: 'k', kind: 'decision', text: 'x', at: 0, armAt: 1500, expiresAt: 120_000 },
      ran,
    );
    expect(list.act('k', 'approve', 1000)).toBe(false);
    expect(ran).not.toHaveBeenCalled();
    expect(list.all).toHaveLength(1); // still there to tap once armed
    expect(list.act('k', 'approve', 1600)).toBe(true);
    expect(ran).toHaveBeenCalledWith('approve');

    list.post(
      { key: 'k2', kind: 'decision', text: 'x', at: 0, armAt: 1500, expiresAt: 120_000 },
      ran,
    );
    expect(list.act('k2', 'approve', 120_000)).toBe(false);
    expect(list.all).toHaveLength(0); // expired: gone
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it('expire() drops cards whose time is up; plain cards stay', () => {
    const list = new Notices();
    list.post({ key: 'a', kind: 'decision', text: 'x', at: 0, expiresAt: 10 });
    list.post({ key: 'b', kind: 'decision', text: 'y', at: 0 });
    list.expire(11);
    expect(list.all.map((n) => n.key)).toEqual(['b']);
    expect(actionable({}, 0)).toBe(true);
  });

  it('a critical change by voice only posts the card; Approve works after the delay', async () => {
    const t0 = Date.now();
    const said = await appSettingTool({ do: 'on', setting: 'online_lookup' });
    expect(said).toBe('Tap Approve to turn on online lookup.');
    expect(getSettings().webLookup).toBe(false);
    const card = notices.all.find((n) => n.armAt !== undefined)!;
    expect(card.text).toMatch(/Wikipedia and DuckDuckGo/);
    expect(card.armAt! - t0).toBeGreaterThanOrEqual(APPROVE_ARM_MS);
    expect(card.expiresAt! - t0).toBeGreaterThanOrEqual(APPROVE_EXPIRES_MS);
    expect(notices.act(card.key, 'approve', card.at + 100)).toBe(false);
    expect(getSettings().webLookup).toBe(false);
    expect(notices.act(card.key, 'approve', card.armAt!)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(getSettings().webLookup).toBe(true);
  });
});

describe('normal changes', () => {
  it('apply at once with Undo on the reply', async () => {
    const said = await appSettingTool({ do: 'set', setting: 'image_detail', value: 'high' });
    expect(said).toBe('Image detail is now High.');
    expect(getSettings().imageDetail).toBe('high');
    const card = notices.all.find((n) => n.actions?.[0]?.id === 'undo')!;
    expect(card).toBeTruthy();
    notices.act(card.key, 'undo');
    await new Promise((r) => setTimeout(r, 0));
    expect(getSettings().imageDetail).toBeNull(); // back to Recommended
  });

  it('says a part of Settings for "what are my privacy settings"', async () => {
    const said = await appSettingTool({ do: 'list', setting: 'consent_mode' });
    expect(said).toMatch(/^Privacy settings: /);
    expect(said).toMatch(/Online lookup: off/);
  });
});

it('on iPhone, Android-only settings say so', async () => {
  Platform.OS = 'ios';
  try {
    expect(await appSettingTool({ do: 'off', setting: 'consent_mode' })).toBe(
      'Consent mode isn’t on iPhone.',
    );
  } finally {
    Platform.OS = 'android';
  }
});

describe('deleting', () => {
  it('needs DELETE typed; a tap or other words do nothing', async () => {
    const run = jest.fn();
    const done = jest.fn();
    requestDelete({ title: 'Delete?', lines: ['3 notes deleted.'], run, onDone: done });
    expect(await confirmDelete('')).toBe(false);
    expect(await confirmDelete('yes')).toBe(false);
    expect(await confirmDelete('delet')).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(pendingDelete()).not.toBeNull();
    expect(await confirmDelete(' delete ')).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(true);
    expect(pendingDelete()).toBeNull();
    expect(typedConfirms('DELETE')).toBe(true);
  });

  it('cancelling deletes nothing', async () => {
    const run = jest.fn();
    const done = jest.fn();
    requestDelete({ title: 'Delete?', lines: [], run, onDone: done });
    cancelDelete();
    expect(await confirmDelete('DELETE')).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(false);
  });

  it('by voice opens the sheet with counts and sizes, and offers export first', async () => {
    const said = await appSettingTool({ do: 'set', setting: 'delete_everything' });
    expect(said).toMatch(/type DELETE/);
    const r = pendingDelete()!;
    expect(r.title).toBe('Delete everything?');
    expect(r.lines.join(' ')).toMatch(/42 memories/);
    expect(r.lines.join(' ')).toMatch(/GB/);
    expect(r.exportFirst).toBe(true);
    expect(deleteAllData).not.toHaveBeenCalled();
    expect(await confirmDelete('DELETE')).toBe(true);
    expect(deleteAllData).toHaveBeenCalled();
  });

  it('a shorter keep period is a deletion too', async () => {
    updateSettings({ videoKeepHours: null });
    await appSettingTool({ do: 'set', setting: 'keep_video', value: '2 hours' });
    const r = pendingDelete()!;
    expect(r.lines[0]).toBe('Video older than 2 hours is deleted for good.');
    expect(getSettings().videoKeepHours).toBeNull();
    await confirmDelete('DELETE');
    expect(getSettings().videoKeepHours).toBe(2);
  });
});

describe('phone search', () => {
  it('photo search off and removing the index open the sheet with the photo count', async () => {
    updateSettings({ sourceGallery: true });
    await appSettingTool({ do: 'off', setting: 'search_photos' });
    let r = pendingDelete()!;
    expect(r.title).toBe('Stop searching photos?');
    expect(r.lines[0]).toMatch(/1,?200 photos \(/);
    expect(gallery.setPhotoSearch).not.toHaveBeenCalled();
    await confirmDelete('DELETE');
    expect(gallery.setPhotoSearch).toHaveBeenCalledWith(false);

    await appSettingTool({ do: 'set', setting: 'remove_photo_index' });
    r = pendingDelete()!;
    expect(r.title).toBe('Remove the photo index?');
    expect(gallery.removePhotoIndex).not.toHaveBeenCalled();
    await confirmDelete('DELETE');
    expect(gallery.removePhotoIndex).toHaveBeenCalled();
  });

  it('turning folders off is a deletion; turning photos on needs Approve', async () => {
    updateSettings({ sourceFolders: true, sourceGallery: false });
    await appSettingTool({ do: 'off', setting: 'folders_source' });
    expect(pendingDelete()!.lines[0]).toMatch(/7 passages/);
    await confirmDelete('DELETE');
    expect(sources.stopFolders).toHaveBeenCalled();

    expect(await appSettingTool({ do: 'on', setting: 'search_photos' })).toMatch(/^Tap Approve/);
    expect(notices.all.some((n) => n.armAt !== undefined)).toBe(true);
  });

  it('pause and the battery settings change at once', async () => {
    expect(await appSettingTool({ do: 'on', setting: 'pause_phone_search' })).toBe(
      'Pause reading is now on.',
    );
    expect(getSettings().searchPaused).toBe(true);
    await appSettingTool({ do: 'off', setting: 'read_photos_on_battery' });
    expect(getSettings().indexOnBattery).toBe(false);
    await appSettingTool({ do: 'set', setting: 'lowest_battery_for_reading', value: '50%' });
    expect(getSettings().indexMinBattery).toBe(50);
  });
});
