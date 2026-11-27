import {
  helpText,
  MAX_RATE,
  MIN_RATE,
  nextRate,
  rateReply,
} from '../src/engine/quick-commands-logic';

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
    expect(all).toMatch(/look things up online, or research a topic/);
    expect(all).toMatch(/edit a photo/);
    expect(all).not.toMatch(/More with/);
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
    expect(t).not.toMatch(/edit a photo/);
    expect(t).toMatch(/More with Online lookup in Settings/);
  });
  it('Android still offers them', () => {
    expect(helpText(on)).toMatch(/timers and alarms.*Listen/s);
  });
});
