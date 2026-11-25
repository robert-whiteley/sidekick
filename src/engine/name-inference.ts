import SidekickNative from '../../modules/sidekick-native';
import { askLlmInBackground, cancelLlm } from './llm';
import {
  CONTEXT_WEIGHT,
  MAX_NAME_LINES,
  namePrompt,
  parseWhoGuesses,
  roleFromLines,
} from '@/memory/names';
import { currentConversationForNames, setSpeakerDescription, suggestName } from '@/memory/store';

let running: Promise<void> | null = null;
let cancelled = false;
let again = false;
let lastId = 0;
/** "conversation:voice:name" already counted: one reading per voice per conversation. */
const counted = new Set<string>();

/**
 * Live, as each line is heard: reads the conversation going on and works out who is who from
 * context, not only "my name is …": names (who answers to one, who is introduced) and otherwise
 * a description ("Waiter", "Bus driver"). A name is evidence for that voice (applied once another
 * cue agrees); a description shows at once until a name is known. Only when the model is already
 * loaded; waits behind questions and is stopped by them.
 */
export function inferNamesIfIdle(): Promise<void> {
  if (running) {
    again = true; // read again with the newest lines once this one is done
    return running;
  }
  cancelled = false;
  again = false;
  running = (async () => {
    const convo = await currentConversationForNames(MAX_NAME_LINES, lastId);
    if (!convo) return;
    // Roles shown by what each person says themselves: instant, and they outrank the model.
    const roles = new Map<string, string>();
    for (const [label, id] of convo.labels) {
      const role = roleFromLines(convo.lines.filter((l) => l.who === label).map((l) => l.text));
      if (role) {
        roles.set(label, role);
        await setSpeakerDescription(id, role);
      }
    }
    if (!SidekickNative.llmIsLoaded()) return;
    const { text } = await askLlmInBackground(namePrompt(convo.lines), null, { maxTokens: 80 });
    if (cancelled) return; // partial output: read again on the next line
    lastId = convo.lastId;
    const heard = convo.lines.map((l) => l.text).join(' ');
    for (const g of parseWhoGuesses(text, [...convo.labels.keys()], heard)) {
      const id = convo.labels.get(g.label)!;
      if (g.description && !roles.has(g.label)) await setSpeakerDescription(id, g.description);
      const key = `${convo.startId}:${id}:${g.name}`;
      if (g.name && !counted.has(key)) {
        counted.add(key);
        await suggestName(id, g.name, CONTEXT_WEIGHT);
      }
    }
  })()
    .catch((e) => {
      if (!cancelled) console.log(`[names] inference failed: ${String(e)}`);
    })
    .finally(() => {
      running = null;
      if (again && !cancelled) void inferNamesIfIdle();
    });
  return running;
}

/** Stops a running pass so a question gets the model at once. */
export async function stopNameInference() {
  if (!running) return;
  cancelled = true;
  cancelLlm();
  await running;
}
