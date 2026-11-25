import SidekickNative from '../../modules/sidekick-native';
import { askLlmInBackground, cancelLlm } from './llm';
import { notices } from './notices';
import { getSettings } from './settings';
import {
  actionFollowups,
  endedConversations,
  joinNames,
  noteText,
  notePrompt,
  parseNote,
} from '@/memory/conversation-note-logic';
import { heardLinesSince, notesUntil, saveNote, setNotesUntil } from '@/memory/conversation-notes';
import { suggestFollowups } from '@/memory/followups';

let running: Promise<void> | null = null;
let cancelled = false;

/**
 * Writes a note for each conversation heard with Listen on that has ended (5 min of silence or
 * Listen off, at least ~2 min of speech, someone else in it). Like the other background passes:
 * only when the model is already loaded (a waiting conversation is written up later), after any
 * answer, in a scratch chat; a question cancels it. Off the record: nothing is written.
 */
export function writeConversationNotesIfDue(now = Date.now()): Promise<void> {
  const s = getSettings();
  if (running || (s.conversationNotes ?? 'auto') === 'off') return running ?? Promise.resolve();
  cancelled = false;
  running = (async () => {
    const lines = await heardLinesSince(await notesUntil(), now);
    const { ready, until } = endedConversations(lines, now, SidekickNative.listenActive());
    if (until == null) return;
    if (getSettings().offTheRecord) {
      await setNotesUntil(until);
      return;
    }
    if (ready.length && !SidekickNative.llmIsLoaded()) return;
    for (const c of ready) {
      const { text } = await askLlmInBackground(notePrompt(c), null, { maxTokens: 220 });
      if (cancelled) return; // partial output: try again later
      const note = parseNote(text, c);
      await setNotesUntil(c.to);
      if (!note) continue;
      const id = await saveNote(c.from, c.to, noteText(note));
      await suggestFollowups(actionFollowups(note.actions, c.to, id));
      notices.post({
        key: `conversation-note-${id}`,
        kind: 'info',
        text: `Notes from your chat with ${joinNames(note.people)}`,
        href: `/note/${id}`,
      });
    }
    await setNotesUntil(until);
  })()
    .catch((e) => {
      if (!cancelled) console.log(`[notes] conversation note failed: ${String(e)}`);
    })
    .finally(() => {
      running = null;
    });
  return running;
}

/** Stops a running pass so a question gets the model at once. */
export async function stopConversationNotes() {
  if (!running) return;
  cancelled = true;
  cancelLlm();
  await running;
}
