import {
  commandSafeWhenLocked,
  helpText,
  MAX_RATE,
  MIN_RATE,
  nextRate,
  parseVoiceCommand as p,
  rateReply,
} from '../src/engine/quick-commands-logic';

describe('parseVoiceCommand', () => {
  it('speech speed', () => {
    expect(p('Speak slower')).toEqual({ type: 'speed', rate: 'slower' });
    expect(p('can you talk a bit faster please?')).toEqual({ type: 'speed', rate: 'faster' });
    expect(p("you're talking too fast")).toEqual({ type: 'speed', rate: 'slower' });
    expect(p('set speech speed to 120%')).toEqual({ type: 'speed', rate: 1.2 });
    expect(p('speech speed 300 percent')).toEqual({ type: 'speed', rate: MAX_RATE });
    expect(p('speak at normal speed')).toEqual({ type: 'speed', rate: 'normal' });
  });
  it('repeat and help', () => {
    expect(p('Repeat that')).toEqual({ type: 'repeat' });
    expect(p('say that again')).toEqual({ type: 'repeat' });
    expect(p('Sorry?')).toEqual({ type: 'repeat' });
    expect(p('What can you do?')).toEqual({ type: 'help' });
    expect(p('help')).toEqual({ type: 'help' });
    expect(p('help me write an email to Sam')).toBeNull();
  });
  it('listening and camera', () => {
    expect(p('Stop listening')).toEqual({ type: 'listening', on: false });
    expect(p('Sidekick, start listening')).toEqual({ type: 'listening', on: true });
    expect(p('pause the camera')).toEqual({ type: 'camera', on: false, pause: true });
    expect(p('resume the camera')).toEqual({ type: 'camera', on: true, pause: true });
    expect(p('stop the camera')).toEqual({ type: 'camera', on: false });
    expect(p('turn on the camera')).toEqual({ type: 'camera', on: true });
  });
  it('camera watches', () => {
    expect(p('Tell me when you see a parking space')).toEqual({
      type: 'watch',
      what: 'parking space',
      every: false,
    });
    expect(p('let me know whenever you see a red car')).toEqual({
      type: 'watch',
      what: 'red car',
      every: true,
    });
    expect(p('watch out for the number 12 bus')).toEqual({
      type: 'watch',
      what: 'number 12 bus',
      every: false,
    });
    expect(p('stop watching for the bus')).toEqual({ type: 'unwatch', what: 'bus' });
    expect(p('stop watching')).toEqual({ type: 'unwatch', what: null });
    expect(p('what are you watching for?')).toEqual({ type: 'watchList' });
    expect(p('tell me when you get the answer')).toBeNull();
  });
  it('scan', () => {
    expect(p('scan this')).toEqual({ type: 'scan' });
    expect(p("what's this QR code")).toEqual({ type: 'scan' });
    expect(p('what does this barcode say')).toEqual({ type: 'scan' });
    expect(p('what is this')).toBeNull();
  });
  it('leaves ordinary questions alone', () => {
    for (const q of ['what did Sam say', 'remind me to call mum', 'what time is it', 'text Jo hi'])
      expect(p(q)).toBeNull();
  });
});

describe('speech speed', () => {
  it('steps and clamps', () => {
    expect(nextRate(1, 'faster')).toBe(1.15);
    expect(nextRate(1, 'slower')).toBe(0.85);
    expect(nextRate(0.55, 'slower')).toBe(MIN_RATE);
    expect(nextRate(1.6, 'normal')).toBe(1);
    expect(rateReply(1)).toMatch(/normal/);
    expect(rateReply(1.15)).toBe('OK, speaking at 115% speed.');
    expect(rateReply(MAX_RATE)).toMatch(/fastest/);
  });
});

describe('helpText', () => {
  const base = {
    camera: true,
    listening: false,
    memory: true,
    calendar: false,
    messages: false,
    email: false,
    online: false,
    location: false,
  };
  it('lists only what is on and points at the rest', () => {
    const t = helpText(base);
    expect(t).toMatch(/watch for something/);
    expect(t).not.toMatch(/calendar/);
    expect(t).toMatch(/More with Listen and Online lookup in Settings/);
    const all = helpText({ ...base, listening: true, calendar: true, online: true });
    expect(all).toMatch(/calendar/);
    expect(all).toMatch(/look things up online/);
    expect(all).not.toMatch(/More with/);
  });
});

describe('commandSafeWhenLocked', () => {
  it('lets the camera and mic be switched with the phone locked', () => {
    expect(commandSafeWhenLocked(p('Resume the camera.'))).toBe(true);
    expect(commandSafeWhenLocked(p('pause the camera'))).toBe(true);
    expect(commandSafeWhenLocked(p('stop the camera'))).toBe(true);
    expect(commandSafeWhenLocked(p('stop listening'))).toBe(true);
    expect(commandSafeWhenLocked(p('speak slower'))).toBe(true);
  });
  it('keeps anything that could say something personal for after an unlock', () => {
    expect(commandSafeWhenLocked(p('repeat that'))).toBe(false);
    expect(commandSafeWhenLocked(p('start listening'))).toBe(false);
    expect(commandSafeWhenLocked(p('what did Sam say'))).toBe(false);
    expect(commandSafeWhenLocked(null)).toBe(false);
  });
});

describe('help on iPhone', () => {
  const on = {
    camera: false,
    listening: false,
    memory: true,
    calendar: true,
    messages: false,
    email: false,
    online: false,
    location: false,
  };
  it('offers no alarms, timers or Listen', () => {
    const t = helpText({ ...on, iphone: true });
    expect(t).not.toMatch(/alarms|timers|Listen/);
    expect(t).toMatch(/set reminders/);
    expect(t).toMatch(/More with Online lookup in Settings/);
  });
  it('Android still offers them', () => {
    expect(helpText(on)).toMatch(/timers and alarms.*Listen/s);
  });
});
