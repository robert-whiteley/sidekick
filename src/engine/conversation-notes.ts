import SidekickNative from '../../modules/sidekick-native';
import { askLlmInBackground, cancelLlm } from './llm';
import { notices } from './notices';
import { getSettings } from './settings';
import { templateFor } from '@/memory/note-templates';
import {
  actionFollowups,
  type Conversation,
  conversationEnded,
  freshLive,
  joinNames,
  type LiveNote,
  mergeNotes,
  notePassDue,
  notePrompt,
  noteText,
  parseNote,
  splitConversations,
  withSomeone,
} from '@/memory/conversation-note-logic';
import {
  heardLinesSince,
  loadLive,
  notesUntil,
  saveLive,
  saveNote,
  setNotesUntil,
  syncNoteFollowups,
  updateNote,
} from '@/memory/conversation-notes';

let running: Promise<void> | null = null;
let cancelled = false;

/** One model pass over [c]: writes or rewrites its note. Null if cancelled (try again later). */
async function notePass(c: Conversation, live: LiveNote, ended: boolean, now: number) {
  const st = getSettings();
  const template = templateFor(c, st.noteTemplateChoice, st.defaultNoteTemplate);
  const { text } = await askLlmInBackground(
    notePrompt(c, live.note, live.handled, template),
    null,
    {
      maxTokens: 240,
    },
  );
  if (cancelled) return null;
  const parsed = parseNote(text, c, template);
  const next: LiveNote = { ...live, handled: c.lines.length, passAt: now };
  if (!parsed) return next; // nothing useful yet: the next pass reads the whole conversation again
  const note = mergeNotes(live.note, parsed);
  next.note = note;
  if (next.noteId == null) next.noteId = await saveNote(c.from, c.to, noteText(note));
  else if (!(await updateNote(next.noteId, c.from, c.to, noteText(note))))
    return { ...next, deleted: true }; // deleted on its page while it went on
  await syncNoteFollowups(next.noteId, actionFollowups(note.actions, c.to, next.noteId), note.done);
  next.postedAt ??= now;
  // One faint line per conversation, updated in place (same key, same position).
  notices.post({
    key: `conversation-note-${next.noteId}`,
    kind: 'info',
    text: `${ended ? 'Notes from' : 'Live notes:'} your chat with ${joinNames(note.people)}`,
    href: `/note/${next.noteId}`,
    at: next.postedAt,
  });
  return next;
}

/**
 * Live notes of conversations heard with Listen on: a note as soon as someone else is in the
 * conversation and something useful was said, updated every few lines or at a pause while it
 * goes on. Like the other background passes it runs only when the model is already loaded,
 * after any answer, in a scratch chat; a question cancels it. Off the record: nothing is written.
 */
export function updateConversationNotes(now = Date.now()): Promise<void> {
  const s = getSettings();
  if (running || (s.conversationNotes ?? 'auto') === 'off') return running ?? Promise.resolve();
  cancelled = false;
  running = (async () => {
    const convs = splitConversations(await heardLinesSince(await notesUntil(), now));
    if (!convs.length) return;
    if (getSettings().offTheRecord) {
      await setNotesUntil(convs[convs.length - 1].to);
      await saveLive(null);
      return;
    }
    const listening = SidekickNative.listenActive();
    let live = await loadLive();
    for (let i = 0; i < convs.length; i++) {
      const c = convs[i];
      const ended = conversationEnded(c, i === convs.length - 1, now, listening);
      let state = live?.from === c.from ? live : freshLive(c.from);
      if (notePassDue(c, state, now, ended)) {
        if (!SidekickNative.llmIsLoaded()) return; // written when the model is next loaded
        const next = await notePass(c, state, ended, now);
        if (!next) return;
        state = next;
        live = next;
        await saveLive(next);
      }
      const finished = !withSomeone(c) || state.handled >= c.lines.length;
      if (!ended || !finished) return;
      if (state.noteId != null && state.note && !state.deleted) {
        // The line says "Notes from…" once the conversation is over.
        notices.post({
          key: `conversation-note-${state.noteId}`,
          kind: 'info',
          text: `Notes from your chat with ${joinNames(state.note.people)}`,
          href: `/note/${state.noteId}`,
          at: state.postedAt ?? now,
        });
      }
      await setNotesUntil(c.to);
      live = null;
      await saveLive(null);
    }
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
