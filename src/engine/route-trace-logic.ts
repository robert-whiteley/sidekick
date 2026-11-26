/**
 * Which rule in `answer()` (assistant.ts) would take a request, without running it: the same
 * pure parsers in the same order. Used by the answers bench (bench/answers, the dev bench screen)
 * to score routing offline and to route on the phone without doing anything. When a stage is
 * added to or moved in `answer()`, change it here too (__tests__/route-trace-test.ts).
 */
import { parseFeedback } from './feedback';
import { parseVoiceCommand } from './quick-commands-logic';
import { parseLocationQuestion } from './location-logic';
import { parseRoutine } from './routines-logic';
import { relevantTools } from './tools-logic';
import { parseExtra } from '@/integrations/extras-logic';
import { parseIntent } from '@/integrations/parse';
import { parseControl } from '@/integrations/phone-controls-logic';
import { quickAnswer } from '@/integrations/quick-answers';
import { splitSchedule } from '@/integrations/schedule-logic';
import { parseTelephony } from '@/integrations/sms-logic';
import { parseTranslate } from '@/integrations/translate';
import { parseReminderRequest } from '@/memory/followup-logic';
import { recapRequest } from '@/memory/recap-logic';
import { askedNumberOf } from '@/memory/sources-logic';
import { parseWeatherQuestion } from '@/web/weather-logic';

export type RuleStage =
  | 'command'
  | 'weather'
  | 'location'
  | 'remember'
  | 'translate'
  | 'reminder'
  | 'routine'
  | 'feedback'
  | 'scheduled_send'
  | 'telephony'
  | 'extra'
  | 'intent'
  | 'quick_answer'
  | 'control'
  | 'move_event'
  | 'recap'
  | 'contact_number'
  /** No rule: the model router runs with these tools offered. */
  | 'router'
  /** No rule and no tool offered: the normal answer (memory search + model). */
  | 'answer';

export type RuleTrace = {
  stage: RuleStage;
  /** What the rule read (its parse result), for checking arguments. */
  detail?: unknown;
  /** The tools the router would offer (stage 'router'). */
  tools?: string[];
};

const REMEMBER = /^(please )?remember(?: that)? (.+)$/i;
const MOVE =
  /^(?:please )?(?:move|reschedule|push|change|shift) (?:my |the )?(.+?) (?:to|until|till) (.+?)[.!?]*$/i;

/** The first rule of `answer()` that takes [q] (typed, no photo, not off the record). */
export function traceRules(
  q: string,
  now: Date,
  opts: { contacts?: string[]; routine?: boolean; offRecord?: boolean } = {},
): RuleTrace {
  const contacts = opts.contacts ?? [];
  const cmd = parseVoiceCommand(q);
  if (cmd) return { stage: 'command', detail: cmd };
  const weather = parseWeatherQuestion(q);
  if (weather) return { stage: 'weather', detail: weather };
  const loc = parseLocationQuestion(q, now);
  if (loc) return { stage: 'location', detail: loc };
  const rem = REMEMBER.exec(q.trim());
  if (rem && !q.trim().endsWith('?')) return { stage: 'remember', detail: rem[2] };
  const tr = parseTranslate(q);
  if (tr) return { stage: 'translate', detail: tr };
  const reminder = parseReminderRequest(q, now);
  if (reminder) return { stage: 'reminder', detail: reminder };
  if (!opts.routine && !opts.offRecord) {
    const p = parseRoutine(q, now);
    if (p && !(p.ok && p.when.type === 'once' && parseIntent(p.action, now)))
      return { stage: 'routine', detail: p };
  }
  const fb = parseFeedback(q);
  if (fb) return { stage: 'feedback', detail: fb };
  const sched = splitSchedule(q, now);
  if (sched) {
    const si = parseIntent(sched.rest, now, contacts);
    if (si && (si.type === 'message' || si.type === 'email'))
      return { stage: 'scheduled_send', detail: { ...si, at: sched.at } };
  }
  const tel = parseTelephony(q, now);
  if (tel) return { stage: 'telephony', detail: tel };
  const extra = parseExtra(q);
  if (extra) return { stage: 'extra', detail: extra };
  const intent = parseIntent(q, now, contacts);
  if (intent) return { stage: 'intent', detail: intent };
  const quick = quickAnswer(q, now);
  if (quick) return { stage: 'quick_answer', detail: quick };
  const control = parseControl(q);
  if (control) return { stage: 'control', detail: control };
  const move = MOVE.exec(q.trim());
  if (move) return { stage: 'move_event', detail: { what: move[1], to: move[2] } };
  const recap = recapRequest(q, now);
  if (recap) return { stage: 'recap', detail: recap };
  const who = askedNumberOf(q);
  if (who) return { stage: 'contact_number', detail: who };
  const tools = relevantTools(q, opts).map((t) => t.name);
  return tools.length ? { stage: 'router', tools } : { stage: 'answer' };
}
