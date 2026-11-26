/**
 * Short spoken/typed commands answered without the model: speech speed, "repeat that", "what can
 * you do?", listening and camera on/off, camera watches ("tell me when you see my bus"), and
 * "scan this" (QR / barcode).
 * Pure parsing; tested in __tests__/quick-commands-test.ts.
 */

import type { CameraChange } from './camera-settings-logic';

export type VoiceCommand =
  | { type: 'speed'; rate: number | 'faster' | 'slower' | 'normal' }
  | { type: 'repeat' }
  | { type: 'help' }
  | { type: 'listening'; on: boolean }
  | { type: 'camera'; on: boolean; pause?: boolean }
  | { type: 'watch'; what: string; every: boolean }
  | { type: 'unwatch'; what: string | null }
  | { type: 'watchList' }
  | { type: 'scan' }
  /** Frame rate, phone lens, image detail (picked by the tool router, no fixed phrases). */
  | { type: 'cameraSetting'; change: CameraChange };

/** Speech speed limits (1 = normal). */
export const MIN_RATE = 0.5;
export const MAX_RATE = 2;
/** One "faster" / "slower" step. */
export const RATE_STEP = 0.15;

export const clampRate = (r: number) =>
  Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, r)) * 100) / 100;

/** The next speed after a "faster" / "slower" / "normal" / number command. */
export function nextRate(current: number, cmd: number | 'faster' | 'slower' | 'normal'): number {
  if (cmd === 'normal') return 1;
  if (typeof cmd === 'number') return clampRate(cmd);
  return clampRate(current + (cmd === 'faster' ? RATE_STEP : -RATE_STEP));
}

/** "Speaking at 115%." etc. */
export function rateReply(rate: number): string {
  if (rate === 1) return 'Back to normal speed.';
  if (rate <= MIN_RATE) return 'This is the slowest I can speak.';
  if (rate >= MAX_RATE) return 'This is the fastest I can speak.';
  return `OK, speaking at ${Math.round(rate * 100)}% speed.`;
}

/** What "what can you do?" says, from what is actually switched on. */
export function helpText(on: {
  camera: boolean;
  listening: boolean;
  memory: boolean;
  calendar: boolean;
  messages: boolean;
  email: boolean;
  online: boolean;
  location: boolean;
  /** iPhone: no timers, alarms or background Listen to offer. */
  iphone?: boolean;
}): string {
  const can: string[] = [
    'answer questions and remember things you tell me',
    on.iphone ? 'set reminders' : 'set reminders, timers and alarms',
    'do sums and conversions, and translate',
  ];
  if (on.camera)
    can.push(
      'tell you what the camera sees, and watch for something ("tell me when you see my bus")',
    );
  else if (on.iphone) can.push('look at a photo you take with the camera button');
  else can.push('look at a photo ("what am I looking at?")');
  if (!on.iphone)
    can.push('edit a photo you send me ("make the background white", "crop it square")');
  if (on.memory)
    can.push(
      on.iphone
        ? 'find what you told me or showed me earlier ("what was the wifi password on that sign?") and recap any time'
        : 'find what you saw or heard earlier ("what did Sam say this morning?") and recap any time',
    );
  if (on.listening) can.push('keep live notes of conversations');
  if (on.calendar) can.push('read and add calendar events');
  if (on.messages) can.push('read and reply to messages');
  if (on.email) can.push('send emails');
  if (on.location) can.push('say where you were');
  if (on.online) can.push('look things up online, or research a topic and write a short report');
  const off: string[] = [];
  if (!on.listening && !on.iphone) off.push('Listen');
  if (!on.online) off.push('Online lookup');
  const tail = off.length ? ` More with ${off.join(' and ')} in Settings.` : '';
  return `I can ${can.slice(0, -1).join(', ')} and ${can.at(-1)}.${tail}`;
}
