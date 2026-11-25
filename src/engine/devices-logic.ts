/**
 * Inputs and outputs, pure part (tested): which camera / mic / speaker to show and use, and the
 * notices for plug and unplug. Native lists come from engine/usb (Android); iPhone has only the
 * phone's own camera and mic (USB cameras: not possible on iPhone).
 */
import type { AudioDevices, UsbCameraEvent } from '../../modules/sidekick-native';

export type DeviceKind = 'usb' | 'wired' | 'bluetooth' | 'phone';

export type DeviceChoice = {
  key: string;
  kind: DeviceKind;
  name: string;
  /** In use now. */
  active: boolean;
  /** What Sidekick would pick on its own. */
  recommended: boolean;
  /** False when the device can't be used here; `why` says so in plain words. */
  available: boolean;
  why?: string;
};

export const PHONE_CAMERA = 'phone:Phone camera';
export const NOT_ON_IPHONE = 'not possible on iPhone';

export type UsbCamera = { name: string; permission: boolean };

/** Cameras: USB camera (if plugged in) is recommended over the phone camera. */
export function cameraChoices(
  platform: 'android' | 'ios' | string,
  usb: UsbCamera[],
  usingUsb: boolean,
): DeviceChoice[] {
  const phone: DeviceChoice = {
    key: PHONE_CAMERA,
    kind: 'phone',
    name: 'Phone camera',
    active: !usingUsb,
    recommended: usb.length === 0,
    available: true,
  };
  if (platform !== 'android') {
    return [
      { ...phone, active: true, recommended: true },
      {
        key: 'usb:USB camera',
        kind: 'usb',
        name: 'USB camera',
        active: false,
        recommended: false,
        available: false,
        why: NOT_ON_IPHONE,
      },
    ];
  }
  const cams = usb.map<DeviceChoice>((c, i) => ({
    key: `usb:${c.name}`,
    kind: 'usb',
    name: c.name,
    active: usingUsb && i === 0,
    recommended: i === 0,
    available: true,
    why: c.permission ? undefined : 'needs your OK (asked when chosen)',
  }));
  return [...cams, phone];
}

/** Mics and speakers from the native snapshot. */
export function audioChoices(d: AudioDevices, input: boolean): DeviceChoice[] {
  const list = input ? d.inputs : d.outputs;
  const active = input ? d.input : d.output;
  const rec = input ? d.recommendedInput : d.recommendedOutput;
  return list.map((p) => ({
    key: p.key,
    kind: p.kind,
    name: p.name,
    active: p.key === active,
    recommended: p.key === rec,
    available: true,
  }));
}

/** iPhone: only the phone's own mic and speaker are offered (the system routes headphones). */
export function iosAudio(): AudioDevices {
  return {
    inputs: [{ id: 0, key: 'phone:Phone mic', kind: 'phone', name: 'Phone mic' }],
    outputs: [{ id: 0, key: 'phone:Phone speaker', kind: 'phone', name: 'Phone speaker' }],
    input: 'phone:Phone mic',
    output: 'phone:Phone speaker',
    recommendedInput: 'phone:Phone mic',
    recommendedOutput: 'phone:Phone speaker',
  };
}

export type InfoNotice = { key: string; kind: 'info'; text: string; href: string };

/** The chat line for a USB camera event, or null when nothing needs saying. */
export function usbCameraNotice(e: UsbCameraEvent, wasUsing: boolean): InfoNotice | null {
  const href = '/settings#camera';
  if (!e.attached) {
    return wasUsing
      ? {
          key: 'usb-camera',
          kind: 'info',
          text: 'Camera unplugged: switched to the phone camera',
          href,
        }
      : null;
  }
  if (e.permission === true) {
    return { key: 'usb-camera', kind: 'info', text: `Using the USB camera (${e.name})`, href };
  }
  if (e.permission === false) {
    return {
      key: 'usb-camera',
      kind: 'info',
      text: 'USB camera not allowed: using the phone camera',
      href,
    };
  }
  return null;
}

/** The chat line when the mic in use changes kind (e.g. headphones unplugged). */
export function micNotice(before: string | null, after: AudioDevices): InfoNotice | null {
  if (!before || before === after.input) return null;
  const now = after.inputs.find((p) => p.key === after.input);
  const gone = !after.inputs.some((p) => p.key === before);
  if (!gone || !now) return null;
  return {
    key: 'mic',
    kind: 'info',
    text: `Mic disconnected: using the ${now.name.toLowerCase().startsWith('phone') ? 'phone mic' : now.name}`,
    href: '/settings#audio',
  };
}
