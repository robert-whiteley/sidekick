/**
 * Routing fixes found by the answers bench (bench/answers/): questions never get action tools,
 * jokes / poems / tips / remarks go straight to the model, nothing is sent to "me", and clear
 * camera, timer, reminder and routine phrasings are caught by rules (no 5 s router call).
 */
import { parseVoiceCommand } from '@/engine/quick-commands-logic';
import { routineFirst, traceRules } from '@/engine/route-trace-logic';
import { looksImperative, looksQuestion, relevantTools } from '@/engine/tools-logic';
import { parseIntent } from '@/integrations/parse';
import { parseReminderRequest } from '@/memory/followup-logic';

const NOW = new Date(2026, 10, 26, 14, 30);
const names = (q: string) => relevantTools(q).map((t) => t.name);

describe('questions and requests', () => {
  it('reads the asked part of a puzzle', () => {
    expect(
      looksQuestion('Tom is taller than Sam, and Sam is taller than Ali. Who is the shortest?'),
    ).toBe(true);
    expect(looksQuestion('If I have 3 apples and buy 5 more, how many apples do I have?')).toBe(
      true,
    );
    expect(looksQuestion('At what temperature does water boil?')).toBe(true);
    expect(looksQuestion('Can you set a timer for 5 minutes?')).toBe(false);
    expect(looksImperative('Split the bill between 4 people. How much each?')).toBe(false);
    expect(looksImperative('Text Sam that I am late')).toBe(true);
  });
  it('never offers action tools to a question', () => {
    expect(names('What language do people speak in Brazil?')).toEqual([]);
    expect(names('How many minutes are there in 3 hours?')).toEqual([]);
    expect(names('What does the word routine mean?')).toEqual([]);
    expect(names('My meeting starts at 2pm and lasts 90 minutes. When does it end?')).toEqual([]);
    // Information tools stay.
    expect(names('do I need an umbrella in Leeds tomorrow')[0]).toBe('weather');
    expect(names('At what temperature does water boil in Celsius?')).toEqual([]);
  });
  it('sends jokes, poems, tips, explanations and remarks straight to the model', () => {
    for (const q of [
      'Tell me a joke',
      'Write a short poem about autumn',
      'Give me three tips for better sleep',
      'Explain how GPS navigation works',
      'Tell me a fun fact about otters',
      'Tell me about timers',
      'I love the camera on this phone',
      'Look up the opening hours of the British Museum',
    ])
      expect([q, names(q)]).toEqual([q, []]);
    // An action word still wins.
    expect(names('in one minute, tell me a fun fact')).toContain('routine');
    expect(names('write a message to Sam saying I am late')).toContain('message');
  });
  it('never offers messaging, email or calls to "me"', () => {
    expect(names('Send me a message with a joke')).toEqual([]);
    expect(names('Call me')).toEqual([]);
    expect(names('Text me a fun fact')).toEqual([]);
    expect(parseIntent('Text me a fun fact', NOW)).toBeNull();
    expect(parseIntent('Call myself', NOW)).toBeNull();
    expect(parseIntent('Text Sam I am late', NOW)).toMatchObject({ type: 'message' });
  });
  it('still offers everything for an unknown instruction', () => {
    expect(names('sort out the thing for Jo').length).toBeGreaterThan(10);
  });
});

describe('rules that skip the router', () => {
  it('camera settings by plain wording', () => {
    const cam = (q: string) => {
      const c = parseVoiceCommand(q);
      return c?.type === 'cameraSetting' ? c.change : null;
    };
    expect(cam('Lower the frame rate')).toEqual({ frames: 'fewer' });
    expect(cam('Take more frames per second')).toEqual({ frames: 'more' });
    expect(cam('Switch to the front camera')).toEqual({ lens: 'front' });
    expect(cam('Use the selfie camera')).toEqual({ lens: 'front' });
    expect(cam('back camera please')).toEqual({ lens: 'back' });
    expect(cam('Flip the camera')).toEqual({ lens: 'flip' });
    expect(cam('Use a higher resolution for the camera')).toEqual({ detail: 'higher' });
    expect(cam('lower the resolution please')).toEqual({ detail: 'lower' });
    expect(cam('I love the front camera')).toBeNull();
    expect(parseVoiceCommand('Turn off the camera')).toEqual({ type: 'camera', on: false });
  });
  it('countdowns are timers', () => {
    expect(parseIntent('Start a countdown of 90 seconds', NOW)).toMatchObject({
      type: 'timer',
      seconds: 90,
    });
  });
  it('to-do lists and "don\'t let me forget"', () => {
    expect(parseReminderRequest('Add bread to my to-do list', NOW)).toMatchObject({
      kind: 'todo',
      title: 'Bread',
    });
    expect(parseReminderRequest("Don't let me forget to buy milk", NOW)).toMatchObject({
      kind: 'todo',
      title: 'Buy milk',
    });
    expect(parseReminderRequest("Don't let me forget to call Jo at 6pm", NOW)).toMatchObject({
      kind: 'reminder',
    });
    expect(parseReminderRequest('Add Sam to the group chat', NOW)).toBeNull();
  });
  it('a routine about the weather is set up, not answered now', () => {
    expect(routineFirst('Every Monday at 8 tell me the weather', NOW)).toBe(true);
    expect(traceRules('Every Monday at 8 tell me the weather', NOW).stage).toBe('routine');
    expect(traceRules("What's the weather tomorrow?", NOW).stage).toBe('weather');
    expect(routineFirst('Remind me every day at 9 to water the plants', NOW)).toBe(false);
  });
});
