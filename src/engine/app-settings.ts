/**
 * The app_setting tool: reads and changes any setting in the registry (settings-registry.ts) by
 * voice or chat, without opening Settings. The model picks the setting and what to do
 * (tools-logic.ts); the plan (pure) says what changes and how risky it is:
 * - normal: saved at once, with Undo on a card under the reply;
 * - critical: a card with the consequence and an Approve button that works after a short delay
 *   and expires (never by voice);
 * - destructive: the delete confirmation sheet (delete-confirm.ts), DELETE typed to enable it.
 * Every change runs the same work the Settings screen does (permissions, listening, retention).
 */
import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { deleteAllData, exportAllData } from './data-export';
import { deleteLines, type DeleteWhat } from './delete-plans';
import { requestDelete } from './delete-confirm';
import { recommended } from './device-profile';
import { listInputs, listOutputs, setAudioOverride, setCamera } from './devices';
import { backupNow } from './drive-backup-schedule';
import { allowExactReminders } from './followup-notify';
import { interpretLanguage } from './interpreter-logic';
import { applySpeechModel } from './language';
import { configureListening, pushAssistantPrompt, wakeLine } from './listen';
import { resetBackendChoice, unloadLlm } from './llm';
import { availableModels, type ChatChoice } from './model-catalog';
import { chatChoice, setChatChoice } from './model-updates';
import { APPROVE_ARM_MS, APPROVE_EXPIRES_MS, notices } from './notices';
import {
  addPausePlaceHere,
  askLocationPermission,
  pushPauseRules,
  removePausePlace,
} from './places';
import {
  deleteRoutine,
  listRoutines,
  openExactRoutineSettings,
  updateRoutine,
} from './routines-store';
import { DEFAULTS, getSettings, updateSettings } from './settings';
import {
  changeRisk,
  type Choice,
  describeLine,
  type RegistryCtx,
  SECTION_HREF,
  SECTION_NAMES,
  sectionDefs,
  settingById,
  type SettingDef,
  type SettingPlan,
  type SettingValue,
  planSetting,
  readValue,
  settingOp,
  SWITCH_OF,
  writePatch,
} from './settings-registry';
import { diskSpace, keepPeriods, setStillsKeepDays, stillsKeepDays } from './storage-monitor';
import { connectGoogle } from '@/integrations/google';
import {
  addPhotoFolder,
  chooseMorePhotos,
  PHOTO_FOLDERS,
  removePhotoFolder,
  removePhotoIndex,
  setPhotoSearch,
} from '@/memory/gallery';
import { clearTrack } from '@/memory/places-store';
import { isOn, setSwitch } from '@/integrations/prefs';
import { applyRetention, deleteRange } from '@/memory/store';
import {
  clearContacts,
  deleteSource,
  fileLabel,
  folderLabel,
  openNotificationAccess,
  notificationAccessGranted,
  PICK_START,
  pickFiles,
  pickFolder,
  removeFolder,
  removePickedFile,
  requestCalendar,
  requestContacts,
  setNotificationCapture,
  stopFolders,
  syncNow,
} from '@/memory/sources';
import { deletePictureModel } from './picture';
import { normaliseFeedUrl, MAX_FEEDS } from '@/web/news-logic';
import { normaliseSearxUrl } from '@/web/lookup-logic';

const ctx = (): RegistryCtx => ({ s: getSettings(), rec: recommended(), defaults: DEFAULTS });
const iphone = () => Platform.OS === 'ios';

// --- Values kept outside Settings ---

/** The choices a runtime setting offers on this phone now (models, devices). */
function runtimeChoices(d: SettingDef): Choice[] | undefined {
  const safe = <T>(f: () => T, fallback: T): T => {
    try {
      return f();
    } catch {
      return fallback;
    }
  };
  const usable = (l: { key: string; name: string; available: boolean }[]) =>
    l.filter((x) => x.available).map((x) => ({ value: x.key, label: x.name }));
  switch (d.id) {
    case 'ai_model':
      return [
        { value: 'recommended', label: 'Recommended' },
        ...availableModels(SidekickNative.getDeviceInfo()).map((m) => ({
          value: m.id,
          label: m.label,
        })),
      ];
    case 'camera_device':
      return usable(safe(() => listInputs().cameras, []));
    case 'microphone':
      return usable(safe(() => listInputs().mics, []));
    case 'sound_output':
      return usable(safe(listOutputs, []));
    default:
      return d.choices;
  }
}

function currentValue(d: SettingDef): SettingValue {
  const c = ctx();
  if (d.store === 'prefs') {
    const w = SWITCH_OF[d.id];
    return w ? isOn(w.integration, w.sw) : null;
  }
  if (d.store === 'settings') return readValue(d, c);
  const active = (l: { key: string; active: boolean; available: boolean }[]) =>
    l.find((x) => x.active && x.available)?.key ?? null;
  switch (d.id) {
    case 'pause_places':
      return c.s.pausePlaces.map((p) => p.name);
    case 'news_feeds':
      return c.s.newsFeeds;
    case 'folders':
      return c.s.folderUris.map(folderLabel);
    case 'photo_folders':
      return c.s.photoFolderUris.map(folderLabel);
    case 'picked_files':
      return c.s.fileUris.map(fileLabel);
    case 'interpreter_languages':
      return (c.s.interpreterLanguages ?? []).map((x) => interpretLanguage(x)?.name ?? x);
    case 'routines':
      return listRoutines().map((r) => `${r.action}${r.paused ? ' (paused)' : ''}`);
    case 'keep_stills':
      return stillsKeepDays() ?? keepPeriods(diskSpace().total).stillsKeepDays;
    case 'ai_model':
      return chatChoice();
    case 'camera_device':
      return active(listInputs().cameras);
    case 'microphone':
      return active(listInputs().mics);
    case 'sound_output':
      return active(listOutputs());
    default:
      return null;
  }
}

// --- Saving a change, with the same work the screens do ---

/** Saves [next] for [d]; returns why not when it couldn't (a permission refused). */
async function apply(d: SettingDef, next: SettingValue, item?: string): Promise<string | null> {
  if (d.store === 'prefs') {
    const w = SWITCH_OF[d.id];
    if (!w) return null;
    if (next && w.google) {
      const ok = await connectGoogle(w.google as Parameters<typeof connectGoogle>[0]);
      return ok ? null : 'Google sign-in didn’t finish, so it stays off.';
    }
    setSwitch(w.integration, w.sw, next === true);
    return null;
  }
  if (d.store === 'settings') return applySettings(d, next);
  return applyRuntime(d, next, item);
}

/** Photo search on or off, as on Settings → Phone search (off deletes the photo index). */
async function applyPhotos(on: boolean): Promise<string | null> {
  if (!on) {
    await setPhotoSearch(false);
    return null;
  }
  if (!iphone()) {
    // No Photos permission on Android: the camera folder in the system picker.
    await setPhotoSearch(true);
    await addPhotoFolder(PHOTO_FOLDERS.camera);
    return null;
  }
  return (await setPhotoSearch(true)) === 'none' ? 'Photos permission was not given.' : null;
}

async function applySettings(d: SettingDef, next: SettingValue): Promise<string | null> {
  if (d.effect === 'photos') return applyPhotos(next === true);
  if (d.effect === 'folders' && !next) {
    // Everything read from folders and files is deleted and the picks forgotten.
    await stopFolders();
    return null;
  }
  // Checks before saving, as on the screens.
  switch (d.effect) {
    case 'appLock': {
      const r = await LocalAuthentication.authenticateAsync({
        promptMessage: next ? 'Turn on app lock' : 'Turn off app lock',
      });
      if (!r.success) return 'App lock wasn’t changed (the phone didn’t confirm it was you).';
      break;
    }
    case 'contacts':
      if (next && !(await requestContacts())) return 'Contacts permission was not given.';
      break;
    case 'calendar':
      if (next && !(await requestCalendar())) return 'Calendar permission was not given.';
      break;
    case 'location':
      if (next && !(await askLocationPermission().catch(() => false)))
        return 'Location permission was not given.';
      break;
    case 'wakeWord': {
      const p = String(next).trim();
      if (!p || wakeLine(p).phrase.toLowerCase() !== p.toLowerCase())
        return `“${p}” can’t be a wake word (unsupported letters).`;
      break;
    }
  }
  if (d.id === 'searxng_server' && next && normaliseSearxUrl(String(next)) === null)
    return 'That isn’t a search server address Sidekick can use (it needs https).';
  updateSettings(writePatch(d, next, ctx()));
  switch (d.effect) {
    case 'listening':
      configureListening();
      break;
    case 'pauseRules':
      pushPauseRules();
      break;
    case 'retention':
      await applyRetention();
      break;
    case 'speechModel':
      void applySpeechModel();
      break;
    case 'answerStyle':
      pushAssistantPrompt();
      break;
    case 'wakeWord':
      configureListening();
      break;
    case 'contacts':
      if (next) void syncNow('contacts').catch(() => {});
      else await clearContacts();
      break;
    case 'calendar':
      if (next) void syncNow('calendar').catch(() => {});
      break;
    case 'notifications':
      setNotificationCapture(next === true);
      if (next && !notificationAccessGranted()) openNotificationAccess();
      break;
    case 'folders':
      if (next && !getSettings().folderUris.length)
        void pickFolder().then((uri) => (uri ? syncNow('folders') : 0));
      break;
  }
  return null;
}

async function applyRuntime(
  d: SettingDef,
  next: SettingValue,
  item?: string,
): Promise<string | null> {
  const s = getSettings();
  const removing = (prev: SettingValue) =>
    Array.isArray(next) && Array.isArray(prev) && next.length < prev.length;
  switch (d.id) {
    case 'pause_places': {
      if (removing(currentValue(d))) {
        const p = s.pausePlaces.find((x) => x.name === item);
        if (p) removePausePlace(p.id);
        return null;
      }
      return addPausePlaceHere(item ?? '')
        ? null
        : 'Location unknown. Allow location for Sidekick, start listening, then try again.';
    }
    case 'news_feeds': {
      if (removing(s.newsFeeds)) {
        updateSettings({ newsFeeds: s.newsFeeds.filter((x) => x !== item) });
        return null;
      }
      const url = normaliseFeedUrl(item ?? '');
      if (!url) return 'That isn’t a feed address Sidekick can use (it needs https).';
      if (s.newsFeeds.length >= MAX_FEEDS) return `Up to ${MAX_FEEDS} feeds.`;
      updateSettings({ newsFeeds: [...s.newsFeeds, url] });
      return null;
    }
    case 'folders': {
      if (removing(currentValue(d))) {
        const uri = s.folderUris.find((u) => folderLabel(u) === item);
        if (uri) await removeFolder(uri);
        return null;
      }
      const uri = await pickFolder();
      if (uri) void syncNow('folders').catch(() => {});
      return null;
    }
    case 'photo_folders': {
      if (removing(currentValue(d))) {
        const uri = s.photoFolderUris.find((u) => folderLabel(u) === item);
        if (uri) await removePhotoFolder(uri);
        return null;
      }
      await addPhotoFolder();
      return null;
    }
    case 'picked_files': {
      if (removing(currentValue(d))) {
        const uri = s.fileUris.find((u) => fileLabel(u) === item);
        if (uri) await removePickedFile(uri);
        return null;
      }
      if (!s.sourceFolders) updateSettings({ sourceFolders: true });
      await pickFiles(PICK_START.downloads);
      return null;
    }
    case 'interpreter_languages': {
      const keep = (s.interpreterLanguages ?? []).filter(
        (x) => (interpretLanguage(x)?.name ?? x) !== item,
      );
      updateSettings({ interpreterLanguages: keep });
      return null;
    }
    case 'routines': {
      const r = listRoutines().find((x) => `${x.action}${x.paused ? ' (paused)' : ''}` === item);
      if (r) deleteRoutine(r.id);
      return null;
    }
    case 'keep_stills':
      setStillsKeepDays(typeof next === 'number' ? next : null);
      return null;
    case 'ai_model':
      setChatChoice(String(next) as ChatChoice);
      return null;
    case 'camera_device':
      setCamera(next === null ? null : String(next));
      return null;
    case 'microphone':
    case 'sound_output':
      setAudioOverride(
        d.id === 'microphone' ? 'input' : 'output',
        next === null ? null : String(next),
      );
      return null;
    default:
      return runAction(d, next);
  }
}

async function runAction(d: SettingDef, value: SettingValue): Promise<string | null> {
  switch (d.id) {
    case 'export_data': {
      const r = await exportAllData().catch(() => null);
      return r ? null : 'The export didn’t finish.';
    }
    case 'back_up_now':
      return (await backupNow()) ? null : 'The backup failed.';
    case 'measure_ai_chip':
      resetBackendChoice();
      await unloadLlm();
      return null;
    case 'phone_assistant':
      return SidekickNative.openAssistantSettings() ? null : 'Couldn’t open the phone’s settings.';
    case 'quick_settings_tile':
      return SidekickNative.requestAddTile()
        ? null
        : 'Pull down Quick Settings, tap the pencil and drag "Ask Sidekick" in.';
    case 'home_screen_widget':
      return SidekickNative.requestAddWidget()
        ? null
        : 'Long-press the home screen, tap Widgets and pick Sidekick.';
    case 'exact_times':
      openExactRoutineSettings();
      void allowExactReminders().catch(() => {});
      return null;
    case 'download_picture_model': {
      // The model's licence must be read and agreed to on its page.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('expo-router').router.push('/settings/pictures');
      return null;
    }
    case 'delete_last_hour':
      await deleteRange(Date.now() - 3600_000, Date.now() + 60_000);
      return null;
    case 'delete_today': {
      const d0 = new Date();
      d0.setHours(0, 0, 0, 0);
      await deleteRange(d0.getTime(), Date.now() + 60_000);
      return null;
    }
    case 'delete_source':
      await deleteSource(String(value) as Parameters<typeof deleteSource>[0]);
      return null;
    case 'delete_everything':
      await deleteAllData();
      return null;
    case 'delete_picture_model':
      await deletePictureModel();
      return null;
    case 'delete_location_history':
      await clearTrack();
      return null;
    case 'choose_allowed_photos':
      if (!iphone()) return 'On Android, add photo folders instead.';
      await chooseMorePhotos();
      return null;
    case 'remove_photo_index':
      await removePhotoIndex();
      return null;
    default:
      return null;
  }
}

// --- Cards ---

let seq = 0;
const cardKey = (id: string) => `setting:${id}:${Date.now()}:${seq++}`;

/** After a change that couldn't be made from a card, say why in the chat. */
const report = (key: string, why: string | null, done: string) =>
  notices.post({ key: `${key}:done`, kind: 'info', text: why ?? done });

function postUndo(d: SettingDef, plan: Extract<SettingPlan, { kind: 'change' }>) {
  if (d.type === 'action') return;
  const prev = plan.cur;
  const undoItem = plan.item;
  // Undo a list change: add back what was removed, or remove what was added.
  const back =
    d.type === 'list'
      ? Array.isArray(plan.next) && Array.isArray(prev) && plan.next.length < prev.length
        ? [...plan.next, undoItem ?? '']
        : (prev as string[])
      : prev;
  // No one-tap Undo when going back would delete something or need Approve.
  if (changeRisk(d, back, plan.next) !== 'normal') return;
  const key = cardKey(d.id);
  notices.post(
    {
      key,
      kind: 'decision',
      text: plan.text,
      href: SECTION_HREF[d.section],
      actions: [{ label: 'Undo', id: 'undo' }],
    },
    () => {
      void apply(d, back, undoItem).then((why) =>
        report(key, why, `Undone: ${describeLine(d, back)}.`),
      );
    },
  );
}

function postApproval(
  d: SettingDef,
  plan: Extract<SettingPlan, { kind: 'change' }>,
  now = Date.now(),
) {
  const key = cardKey(d.id);
  const verb = plan.phrase[0].toUpperCase() + plan.phrase.slice(1);
  notices.post(
    {
      key,
      kind: 'decision',
      text: `${verb}? ${plan.consequence}`.trim(),
      actions: [{ label: 'Approve', id: 'approve' }],
      armAt: now + APPROVE_ARM_MS,
      expiresAt: now + APPROVE_EXPIRES_MS,
    },
    () => {
      void apply(d, plan.next, plan.item).then((why) => report(key, why, `Done: ${plan.phrase}.`));
    },
  );
}

/** What a destructive change deletes, for the confirmation sheet. */
function deleteWhat(d: SettingDef, plan: Extract<SettingPlan, { kind: 'change' }>): DeleteWhat {
  const d0 = new Date();
  d0.setHours(0, 0, 0, 0);
  switch (d.id) {
    case 'delete_last_hour':
      return {
        kind: 'range',
        from: Date.now() - 3600_000,
        to: Date.now() + 60_000,
        label: 'the last hour',
      };
    case 'delete_today':
      return { kind: 'range', from: d0.getTime(), to: Date.now() + 60_000, label: 'today' };
    case 'delete_source':
      return { kind: 'source', source: String(plan.next) as 'notes' };
    case 'delete_everything':
      return { kind: 'everything' };
    case 'delete_picture_model':
      return { kind: 'pictureModel' };
    case 'delete_location_history':
      return { kind: 'locationHistory' };
    case 'folders':
      return { kind: 'folder', label: plan.item ?? '' };
    case 'routines':
      return { kind: 'routine', label: plan.item ?? '' };
    case 'search_photos':
      return { kind: 'photos', again: false };
    case 'remove_photo_index':
      return { kind: 'photos', again: true };
    case 'photo_folders':
      return { kind: 'photoFolder', label: plan.item ?? '' };
    case 'picked_files':
      return { kind: 'pickedFile', label: plan.item ?? '' };
    case 'folders_source':
      return { kind: 'folderSource' };
    case 'keep_memories': {
      const days = Number(plan.next);
      return {
        kind: 'keep',
        media: 'memories',
        line: plan.consequence,
        before: Date.now() - days * 86_400_000,
      };
    }
    default:
      return {
        kind: 'keep',
        media: d.id === 'keep_video' ? 'video' : d.id === 'keep_audio' ? 'audio' : 'stills',
        line: plan.consequence,
      };
  }
}

async function openDeleteSheet(d: SettingDef, plan: Extract<SettingPlan, { kind: 'change' }>) {
  const l = await deleteLines(deleteWhat(d, plan));
  requestDelete({
    ...l,
    run: async () => {
      const why = await apply(d, plan.next, plan.item);
      if (why) notices.post({ key: cardKey(d.id), kind: 'info', text: why });
    },
  });
}

// --- The tool ---

/**
 * Runs one app_setting call: returns the short line to say. [a] has been checked against the
 * tool's schema (setting is a registry id or 'all').
 */
export async function appSettingTool(a: Record<string, unknown>): Promise<string> {
  const id = typeof a.setting === 'string' ? a.setting : '';
  const platform = iphone() ? 'ios' : 'android';
  if (!id || id === 'all') {
    const names = Object.values(SECTION_NAMES).join(', ');
    return `Ask about one part of Settings: ${names}. Or name the setting.`;
  }
  const d = settingById(id);
  if (!d) return 'I don’t know that setting.';
  if (d.android && iphone()) return `${d.name} isn’t on iPhone.`;
  const choices = runtimeChoices(d);
  const op = settingOp(d, a.do, a.value);

  if (op === 'list') {
    const lines = sectionDefs(d.section, platform).map((x) =>
      describeLine(x, currentValue(x), runtimeChoices(x)),
    );
    return `${SECTION_NAMES[d.section]} settings: ${lines.join('; ')}.`;
  }

  // Routines: pausing or resuming one by name.
  if (d.id === 'routines' && (op === 'on' || op === 'off')) {
    const want = String(a.value ?? '')
      .trim()
      .toLowerCase();
    const r = want ? listRoutines().find((x) => x.action.toLowerCase().includes(want)) : undefined;
    if (!r)
      return `Which routine? ${
        listRoutines()
          .map((x) => x.action)
          .join(', ') || 'There are none.'
      }`;
    updateRoutine(r.id, { paused: op === 'off' });
    const plan: SettingPlan = {
      kind: 'change',
      next: null,
      cur: null,
      risk: 'normal',
      phrase: '',
      consequence: '',
      text: `${op === 'off' ? 'Paused' : 'Resumed'}: ${r.action}.`,
    };
    notices.post(
      {
        key: cardKey(d.id),
        kind: 'decision',
        text: plan.text,
        actions: [{ label: 'Undo', id: 'undo' }],
      },
      () => updateRoutine(r.id, { paused: op !== 'off' }),
    );
    return plan.text;
  }

  const plan = planSetting(d, op, a.value, currentValue(d), ctx(), choices);
  if (plan.kind === 'say') return plan.text;
  switch (plan.risk) {
    case 'normal': {
      const why = await apply(d, plan.next, plan.item);
      if (why) return why;
      postUndo(d, plan);
      return plan.text;
    }
    case 'critical':
      postApproval(d, plan);
      return plan.text;
    case 'destructive':
      await openDeleteSheet(d, plan);
      return plan.text;
  }
}
