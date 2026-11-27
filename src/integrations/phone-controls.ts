/**
 * Runs phone controls (phone-controls-logic.ts) for the model's tool calls (tools.ts). Each
 * control has its own switch in Settings → Connections → Phone controls.
 */
import type { PlannedAction } from './types';
import { integrationsNative } from './native';
import { isOn } from './prefs';
import {
  type Control,
  type LaunchableApp,
  MEDIA_APPS,
  matchApp,
  PANEL_NAMES,
  stepBrightness,
} from './phone-controls-logic';

type Native = NonNullable<ReturnType<typeof integrationsNative>>;

const reply = (text: string): PlannedAction => ({ kind: 'reply', text });
const off = (what: string) => reply(`${what} is off in Settings → Connections → Phone controls.`);
const NOT_HERE = "That isn't possible on this phone yet.";

let apps: { at: number; list: LaunchableApp[] } | null = null;
const APPS_TTL_MS = 5 * 60_000;

function installedApps(native: Native): LaunchableApp[] {
  if (apps && Date.now() - apps.at < APPS_TTL_MS) return apps.list;
  let list: LaunchableApp[] = [];
  try {
    list = JSON.parse(native.launchableApps?.() ?? '[]') as LaunchableApp[];
  } catch {
    list = [];
  }
  apps = { at: Date.now(), list };
  return list;
}

/** The phone is locked (screen off, hands-free): only lock-safe tools run (decide-logic.ts). */
export function phoneLocked(): boolean {
  return !!integrationsNative()?.isLocked?.();
}

export const UNLOCK_FIRST = 'Unlock your phone first, then ask me again.';

export async function runControl(c: Control): Promise<PlannedAction | null> {
  const n = integrationsNative();
  if (c.type === 'screen') {
    return reply(
      'Hold the home button (or swipe up from a bottom corner) while the screen is showing, and I’ll look at it. That needs Sidekick as the phone’s assistant: Settings → Ways to open Sidekick.',
    );
  }
  if (!n) return reply(NOT_HERE);
  switch (c.type) {
    case 'openApp': {
      if (!isOn('phone', 'apps')) return off('Opening apps');
      if (!n.openApp || !n.launchableApps) return reply(NOT_HERE);
      const app = matchApp(c.name, installedApps(n));
      if (!app) return reply(`I can't find an app called ${c.name} on this phone.`);
      return reply(n.openApp(app.pkg) ? `Opening ${app.label}.` : `I couldn't open ${app.label}.`);
    }
    case 'torch': {
      if (!isOn('phone', 'torch')) return off('Torch');
      const r = n.flashlight?.(c.on === null ? -1 : c.on ? 1 : 0) ?? -1;
      if (r < 0) return reply("This phone's torch isn't available (the camera may be using it).");
      return reply(r === 1 ? 'Torch on.' : 'Torch off.');
    }
    case 'volume': {
      if (!isOn('phone', 'volume')) return off('Volume');
      if (!n.volume) return reply(NOT_HERE);
      const v = n.volume(c.dir, c.percent ?? 0);
      if (c.dir === 'mute') return reply('Muted.');
      if (c.dir === 'unmute') return reply(`Unmuted, volume ${v}%.`);
      return reply(`Volume ${v}%.`);
    }
    case 'dnd': {
      if (!isOn('phone', 'dnd')) return off('Do Not Disturb');
      if (!n.dndAccess || !n.setDnd) return reply(NOT_HERE);
      if (!n.dndAccess()) {
        n.openDndAccess?.();
        return reply(
          'Allow Sidekick to change Do Not Disturb on the screen I opened, then ask again.',
        );
      }
      n.setDnd(c.on);
      return reply(c.on ? 'Do Not Disturb is on (priority only).' : 'Do Not Disturb is off.');
    }
    case 'brightness': {
      if (!isOn('phone', 'brightness')) return off('Brightness');
      if (!n.setBrightness || !n.canWriteSettings) return reply(NOT_HERE);
      if (!n.canWriteSettings()) {
        n.openWriteSettings?.();
        return reply(
          'Turn on "Modify system settings" for Sidekick on the screen I opened, then ask again.',
        );
      }
      let p: number;
      if (c.percent === 'auto') p = -1;
      else if (c.percent === 'up' || c.percent === 'down') {
        const now = n.brightness?.() ?? 50;
        p = stepBrightness(now < 0 ? 50 : now, c.percent);
      } else p = c.percent;
      if (!n.setBrightness(p)) return reply("I couldn't change the brightness.");
      return reply(p < 0 ? 'Brightness is automatic.' : `Brightness ${p}%.`);
    }
    case 'panel': {
      if (!isOn('phone', 'panels')) return off('Connection switches');
      if (!n.openPanel) return reply(NOT_HERE);
      const name = PANEL_NAMES[c.kind];
      const what = c.on === null ? 'change' : c.on ? 'turn on' : 'turn off';
      // Android doesn't let apps switch these (since Android 10): the system panel opens instead.
      return reply(
        n.openPanel(c.kind)
          ? `Android only lets you ${what} ${name} yourself, so I opened the switch.`
          : `I couldn't open the ${name} settings.`,
      );
    }
    case 'play': {
      if (!isOn('phone', 'play')) return off('Play from search');
      if (!n.playFromSearch) return reply(NOT_HERE);
      let pkg = '';
      let label = '';
      if (c.app) {
        const key = c.app.toLowerCase();
        pkg = MEDIA_APPS[key] ?? '';
        label = c.app;
        if (!pkg && n.launchableApps) {
          const a = matchApp(c.app, installedApps(n));
          if (a) [pkg, label] = [a.pkg, a.label];
        }
        if (!pkg) return reply(`I can't find ${c.app} on this phone.`);
        if (!n.isInstalled(pkg)) return reply(`${c.app} isn't installed.`);
      }
      const ok = n.playFromSearch(c.query, pkg);
      if (!ok)
        return reply(
          label ? `${label} didn't take the request.` : 'No music app took the request.',
        );
      return reply(label ? `Playing ${c.query} on ${label}.` : `Playing ${c.query}.`);
    }
  }
  return null;
}
