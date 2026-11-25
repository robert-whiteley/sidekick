/**
 * Inputs and outputs (docs/PLAN-v2.md "Inputs and outputs"): cameras, mics and speakers, the
 * recommended pick (USB camera > phone camera; USB mic > headset > phone mic; headphones for
 * output), the user's override, change events and the chat notices for plug/unplug.
 */
import { Platform } from 'react-native';

import SidekickNative, {
  type AudioDevices,
  type SplitAudioProbe,
} from '../../modules/sidekick-native';
import {
  audioChoices,
  cameraChoices,
  iosAudio,
  NOT_ON_IPHONE,
  micNotice,
  usbCameraNotice,
  type DeviceChoice,
  type UsbCamera,
} from './devices-logic';
import { notices } from './notices';

export type { DeviceChoice } from './devices-logic';

const android = Platform.OS === 'android';
const KEY_IN = 'audio.input';
const KEY_OUT = 'audio.output';
const KEY_CAMERA = 'camera.source';

let usingUsb = false;
let lastInput: string | null = null;

function usbCameras(): UsbCamera[] {
  if (!android) return [];
  try {
    return SidekickNative.usbCameraList();
  } catch {
    return [];
  }
}

function audio(): AudioDevices {
  if (!android) return iosAudio();
  try {
    return SidekickNative.audioDevices();
  } catch {
    return iosAudio();
  }
}

/** Every input: cameras then mics. */
export function listInputs(): { cameras: DeviceChoice[]; mics: DeviceChoice[] } {
  return {
    cameras: cameraChoices(Platform.OS, usbCameras(), usingUsb),
    mics: audioChoices(audio(), true),
  };
}

export function listOutputs(): DeviceChoice[] {
  return audioChoices(audio(), false);
}

/** The mic in use (or recommended) and the camera to use. */
export function preferredInput(): {
  camera: DeviceChoice | undefined;
  mic: DeviceChoice | undefined;
} {
  const { cameras, mics } = listInputs();
  const camPin = SidekickNative.kvGet(KEY_CAMERA);
  const camera =
    cameras.find((c) => c.available && c.key === camPin) ?? cameras.find((c) => c.recommended);
  return { camera, mic: mics.find((m) => m.active) ?? mics.find((m) => m.recommended) };
}

export function preferredOutput(): DeviceChoice | undefined {
  const outs = listOutputs();
  return outs.find((o) => o.active) ?? outs.find((o) => o.recommended);
}

/** Headphones connected (wired, Bluetooth, USB headset)? iPhone: false (not detected yet). */
export function headphonesOn(): boolean {
  if (!android) return false;
  try {
    return SidekickNative.headphonesOn();
  } catch {
    return false;
  }
}

/** Pin a mic / speaker by key; null returns to Recommended. Saved and applied at once. */
export function setAudioOverride(kind: 'input' | 'output', key: string | null) {
  SidekickNative.kvSet(kind === 'input' ? KEY_IN : KEY_OUT, key);
  if (android)
    SidekickNative.audioSetOverride(SidekickNative.kvGet(KEY_IN), SidekickNative.kvGet(KEY_OUT));
}

/**
 * Choose the camera: a USB camera key uses it (Android asks permission once), the phone camera
 * key or null stays on / returns to the phone camera. Size and rate: 720p 10 fps by default.
 */
export function setCamera(key: string | null, mode = { width: 1280, height: 720, fps: 10 }) {
  SidekickNative.kvSet(KEY_CAMERA, key);
  if (!android) return;
  if (key?.startsWith('usb:')) SidekickNative.usbCameraOpen(mode.width, mode.height, mode.fps);
  else if (key) SidekickNative.usbCameraUsePhone();
}

/** Use the USB camera if one is plugged in and the user hasn't chosen the phone camera. */
export function openBestCamera(mode = { width: 1280, height: 720, fps: 10 }): boolean {
  if (!android) return false;
  const pin = SidekickNative.kvGet(KEY_CAMERA);
  if (pin && !pin.startsWith('usb:')) return false;
  return SidekickNative.usbCameraOpen(mode.width, mode.height, mode.fps);
}

/** Can the phone record the headset mic and the USB camera mic at once? (Listen must be off.) */
export async function probeSplitAudio(): Promise<SplitAudioProbe> {
  if (!android) return { possible: false, tested: false, reason: NOT_ON_IPHONE };
  return SidekickNative.audioProbeSplit();
}

/** Headset / Bluetooth button → `onPress` (walk mode). Returns an unsubscribe. */
export function listenMediaButton(
  onPress: (action: 'ask' | 'next' | 'previous') => void,
): () => void {
  if (!android) return () => {};
  SidekickNative.mediaButtonsEnable(true);
  const sub = SidekickNative.addListener('onMediaButton', (e) => onPress(e.action));
  return () => {
    sub.remove();
    SidekickNative.mediaButtonsEnable(false);
  };
}

/** A button-press ask started / ended (the Bluetooth headset mic is used meanwhile). */
export function setAsking(on: boolean) {
  if (android) SidekickNative.audioSetAsking(on);
}

/**
 * Follow device changes: re-applies the saved override, posts the plug/unplug notices, and calls
 * `onChange` (for Settings lists). Call once at start-up; returns an unsubscribe.
 */
export function watchDevices(onChange?: () => void): () => void {
  if (!android) return () => {};
  SidekickNative.audioSetOverride(SidekickNative.kvGet(KEY_IN), SidekickNative.kvGet(KEY_OUT));
  lastInput = audio().input;
  usbCameras(); // starts the native USB watcher (a USB camera then opens on plug-in)
  const subs = [
    SidekickNative.addListener('onUsbCamera', (e) => {
      const was = usingUsb;
      if (!e.attached) usingUsb = false;
      else if (e.permission === true) usingUsb = true;
      const n = usbCameraNotice(e, was);
      if (n) notices.post(n);
      onChange?.();
    }),
    SidekickNative.addListener('onAudioDevices', (d) => {
      const n = micNotice(lastInput, d);
      if (n) notices.post(n);
      lastInput = d.input;
      onChange?.();
    }),
  ];
  return () => subs.forEach((s) => s.remove());
}
