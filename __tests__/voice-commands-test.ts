import {
  helpText,
  MAX_RATE,
  MIN_RATE,
  nextRate,
  parseVoiceCommand as p,
  rateReply,
} from '../src/engine/voice-commands-logic';
import {
  NOTE_TEMPLATES,
  parseTemplateSections,
  templateFor,
  templateFormat,
} from '../src/memory/note-templates';

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
    expect(p('pause the camera')).toEqual({ type: 'camera', on: false });
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
  it('note templates', () => {
    expect(p('This is a meeting')).toEqual({ type: 'template', id: 'meeting' });
    expect(p("I'm at the doctor's appointment")).toEqual({ type: 'template', id: 'doctor' });
    expect(p("it's a lecture")).toEqual({ type: 'template', id: 'lecture' });
    expect(p('this is an interview with Jo')).toEqual({ type: 'template', id: 'interview' });
    expect(p('take meeting notes')).toEqual({ type: 'template', id: 'meeting' });
    expect(p('this is just a normal chat')).toEqual({ type: 'template', id: null });
    expect(p("it's a great day for a talk about the meeting tomorrow")).toBeNull();
    expect(p('this is Sam')).toBeNull();
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

describe('note templates', () => {
  const conv = { from: 1_000_000, to: 2_000_000 };
  it('a voice choice during the conversation wins over the default', () => {
    expect(templateFor(conv, { id: 'meeting', at: 1_500_000 }, 'lecture')?.id).toBe('meeting');
    expect(templateFor(conv, { id: null, at: 1_500_000 }, 'lecture')).toBeNull();
    expect(templateFor(conv, { id: 'meeting', at: 100 }, 'lecture')?.id).toBe('lecture');
    expect(templateFor(conv, null, null)).toBeNull();
  });
  it('format and parsing', () => {
    const t = NOTE_TEMPLATES.doctor;
    expect(templateFormat(null)).toBe('');
    expect(templateFormat(t)).toMatch(/Medicines:/);
    const out = parseTemplateSections(
      t,
      'Topics: knee\nSymptoms: pain on stairs; swelling\nMedicines: ibuprofen 400 mg three times a day\nDiagnosis: none',
    );
    expect(out).toEqual([
      { name: 'Symptoms', items: ['pain on stairs', 'swelling'] },
      { name: 'Medicines', items: ['ibuprofen 400 mg three times a day'] },
    ]);
  });
});
