import { draftSummary, planAction } from '@/engine/actions';
import { recallContext } from '@/memory/recall';
import SidekickNative from '../../modules/sidekick-native';
import {
  askLlm,
  askLlmInBackground,
  backgroundPreemptions,
  llmLoadCount,
  prepareChat,
  setChatSystemSource,
} from './llm';
import {
  chatSystem,
  compact,
  type CompactReason,
  Conversation,
  historyBudgetTokens,
  IDLE_COMPACT_MS,
  SUMMARY_MAX_TOKENS,
  SUMMARY_SYSTEM,
} from './conversation';
import { getSettings } from './settings';
import { clearChatState, loadChatState, saveChatState } from '@/memory/chat-state';
import { SYSTEM_PROMPT } from './prompts';
import { keptFile } from '@/memory/media-files';
import { speechClipFor } from './speech-clip';
import type { Moment } from '@/memory/store';
import { MEMORY_LIMIT, memoryContext, pickFacts } from './prompt-budget';
import {
  rememberExchange,
  rememberPhotoQuestion,
  saveFact,
  savedFacts,
  searchMemory,
} from '@/memory/store';
import { asksAboutSomethingSeen } from '@/memory/search-logic';
import { ocrPromptLine } from '@/memory/photo-text';
import { photoTextOrNull } from './photo-ocr';
import { answerLocally } from '@/memory/sources';
import {
  asksAboutFollowups,
  followupContext,
  formatDue,
  parseReminderRequest,
} from '@/memory/followup-logic';
import { addFollowup, listFollowups } from '@/memory/followups';
import { personPromptContext } from '@/memory/people';
import { askWithLookup, type WebSource } from '@/web/lookup';

export { SYSTEM_PROMPT, memoryContext };

export const DEFAULT_PHOTO_QUESTION = 'What am I looking at?';

const REMEMBER = /^(please )?remember(?: that)? (.+)$/i;

export type AnswerResult = {
  text: string;
  usedPhoto: string | null;
  sources: Moment[];
  ms: number;
  ttftMs: number;
  /** Online lookup results the answer used (Settings > Online lookup; off by default). */
  web?: WebSource[];
  /** The search words sent, when a lookup ran (reused by the browser link). */
  webQuery?: string;
  /** Answered here without the model (a saved fact, reminder or contact); no web link. */
  local?: boolean;
  /** A phone action drafted for the user's OK (message, email, event, call): shown as a card. */
  draftId?: string;
  /** Stored moments the answer is about (video clip or still), shown in the chat player. */
  media?: { momentAt: number; kind: 'video' | 'photo' | 'audio'; path?: string }[];
};

/**
 * Answers a question using, in order: a photo just taken; else the user's memory, re-reading the
 * original photo of a remembered moment when the question is about something seen.
 */

/** The last question asked, for a follow-up's search words. */
let lastQuestion: string | undefined;

let chat: Conversation | null = null;
/** The model load the current chat was started under (another load means it is gone). */
let chatLoad = -1;
/** The "Off the record" chat has been started (the model keeps its turns until it is left). */
let offRecordStarted = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function chatBudget(): number {
  const own = (getSettings() as { chatMemoryTokens?: number | null }).chatMemoryTokens;
  if (own) return own;
  try {
    return historyBudgetTokens(SidekickNative.getDeviceInfo().totalRamMb);
  } catch {
    return historyBudgetTokens(0);
  }
}

/** The one continuous conversation (loaded from the phone on first use). */
export function conversation(): Conversation {
  if (!chat) {
    chat = new Conversation(loadChatState(), chatBudget());
    prepareChat(chatSystem(SYSTEM_PROMPT, chat.state));
  }
  return chat;
}

setChatSystemSource(() => chatSystem(SYSTEM_PROMPT, conversation().state));

/** The running summary and recent turns (for a "what we talked about" view). */
export const chatState = () => conversation().state;

/** Summarises the older turns into the running summary, in the background. */
export function compactChat(reason: CompactReason) {
  const c = conversation();
  console.log(
    `[chat] compacting (${reason}): ${c.older().length} turns, ~${c.usedTokens()} tokens`,
  );
  void compact(
    c,
    {
      summarise: (prompt) =>
        askLlmInBackground(prompt, null, {
          system: SUMMARY_SYSTEM,
          maxTokens: SUMMARY_MAX_TOKENS,
        }).then((r) => r.text),
      preemptions: backgroundPreemptions,
      save: saveChatState,
      prepare: prepareChat,
    },
    SYSTEM_PROMPT,
  );
}

function scheduleIdleCompaction() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (conversation().compactReason(Date.now()) === 'idle') compactChat('idle');
  }, IDLE_COMPACT_MS + 1000);
}

/** Leaving Off the record: the next question is back in the main chat (its own chat is closed then). */
export function leaveOffTheRecord() {
  offRecordStarted = false;
}

/** Delete all data: the conversation, its summary and the model's chat are forgotten. */
export function forgetConversation() {
  conversation().reset();
  clearChatState();
  prepareChat(SYSTEM_PROMPT);
  lastQuestion = undefined;
}

export async function answer(
  question: string,
  photoNow: string | null,
  onText: (full: string) => void,
  /**
   * The chat is always continuous (keepHistory is ignored, kept for older callers). offTheRecord:
   * uses memories but saves nothing, in its own chat (default: the Off the record setting).
   */
  opts?: { keepHistory?: boolean; offTheRecord?: boolean },
): Promise<AnswerResult> {
  const offRecord = opts?.offTheRecord ?? getSettings().offTheRecord ?? false;
  if (!offRecord) offRecordStarted = false;
  const remember = REMEMBER.exec(question.trim());
  if (remember && offRecord && !photoNow && !question.trim().endsWith('?')) {
    const text =
      "You're off the record, so I won't keep that. Leave Off the record and say it again.";
    onText(text);
    return { text, usedPhoto: null, sources: [], ms: 0, ttftMs: 0, local: true };
  }
  if (remember && !photoNow && !question.trim().endsWith('?')) {
    await saveFact(remember[2].replace(/[.!]+$/, ''));
    const text = "Got it, I'll remember that.";
    onText(text);
    return { text, usedPhoto: null, sources: [], ms: 0, ttftMs: 0, local: true };
  }

  // "Remind me to … at …": scheduled for real, here, so the reply never claims what didn't happen.
  const reminder = photoNow ? null : parseReminderRequest(question, new Date());
  if (reminder) {
    await addFollowup(reminder);
    // "tomorrow 09:00" → "tomorrow at 09:00"
    const due = formatDue(reminder, new Date()).replace(/ (\d{1,2}[:.]\d{2}\D*)$/, ' at $1');
    const what = reminder.title.charAt(0).toLowerCase() + reminder.title.slice(1);
    const text = due
      ? `OK, I'll remind you to ${what} ${due}.`
      : `I've added "${reminder.title}" to your to-dos. Say a time if you want a reminder.`;
    onText(text);
    return { text, usedPhoto: null, sources: [], ms: 0, ttftMs: 0, local: true };
  }

  // "Text Sam I'm running late", "add lunch with Jo tomorrow at 1": a draft card, sent only on OK.
  const plan = photoNow ? null : await planAction(question).catch(() => null);
  if (plan) {
    const text = plan.kind === 'reply' ? plan.text : draftSummary(plan.draft);
    onText(text);
    const draftId = plan.kind === 'draft' ? plan.draft.id : undefined;
    return { text, usedPhoto: null, sources: [], ms: 0, ttftMs: 0, local: true, draftId };
  }

  // "What's Sam's number": straight from contacts (when on), no model needed.
  const local = photoNow ? null : await answerLocally(question).catch(() => null);
  if (local) {
    onText(local);
    return { text: local, usedPhoto: null, sources: [], ms: 0, ttftMs: 0, local: true };
  }

  let sources: Moment[] = [];
  let facts: string[] = [];
  try {
    [sources, facts] = await Promise.all([
      // A few extra candidates so a remembered photo can still be found below.
      searchMemory(question, photoNow ? MEMORY_LIMIT.photo : MEMORY_LIMIT.text + 2),
      savedFacts().then((f) =>
        pickFacts(
          f.filter((x) => x.status === 'saved').map((x) => x.text),
          question,
        ),
      ),
    ]);
  } catch (e) {
    console.log(`[assistant] memory unavailable: ${String(e)}`);
  }

  let image = photoNow;
  if (!image && asksAboutSomethingSeen(question)) {
    image = sources.map((m) => keptFile(m.photoPath)).find((p) => p !== null) ?? null;
  }

  // Only the best few notes reach the model: each prompt token delays the first word.
  sources = sources.slice(0, photoNow ? MEMORY_LIMIT.photo : MEMORY_LIMIT.text);
  // "What do I need to do?": the approved follow-ups go first.
  const agenda =
    !photoNow && asksAboutFollowups(question)
      ? followupContext(await listFollowups().catch(() => []), new Date())
      : '';
  // "What did I ask Sam to do?": the named person's notes, kept facts and requests.
  const person = await personPromptContext(question).catch(() => '');
  // What the camera saw (live frames, clips): empty unless the question is about it. Its
  // frame beats an older photo note: it is what the question is about.
  const recall = photoNow ? null : await recallContext(question).catch(() => null);
  if (recall?.images.length) image = recall.images[0];
  if (recall && recall.intent !== 'none')
    console.log(
      `[recall] ${recall.intent}: ${recall.refs.length} matches, ${recall.images.length} images, media ${recall.media?.kind ?? 'none'}`,
    );
  // The photo's exact text (OCR, ~1 s) helps the model read numbers and names right.
  const seenText = ocrPromptLine(await photoTextOrNull(image));
  const recallPart = recall?.promptPart ?? '';
  const conv = conversation();
  if (conv.keepHistory() && chatLoad !== llmLoadCount()) conv.restart(); // the model was reloaded
  const idleBefore = conv.compactReason(Date.now()) === 'idle';
  // The model's chat continues; a fresh one (first question, after a restart or a compaction)
  // starts from the running summary and the last turns.
  const system = chatSystem(SYSTEM_PROMPT, conv.state);
  let keep = offRecord ? offRecordStarted : conv.keepHistory();
  let promptChars = 0;
  const recent = conv.idleFor(Date.now()) < IDLE_COMPACT_MS;
  // Online lookup (when on) sends only the question text; the prompt itself stays on the phone.
  const { text, stats, web, webQuery } = await askWithLookup(
    question,
    !!image,
    (webPart) =>
      `${agenda}${person}${webPart}${memoryContext(sources, facts, sources.length, question)}${seenText}${recallPart}Question: ${question}`,
    async (prompt, t, o) => {
      const r = await askLlm(prompt, image, t, {
        system,
        keepHistory: keep,
        undoable: o?.undoable,
        offRecord,
      });
      // A second pass (after an online lookup) continues the same chat.
      if (!keep) {
        if (offRecord) offRecordStarted = true;
        else {
          conv.started(system.length);
          chatLoad = llmLoadCount();
        }
        keep = true;
      }
      promptChars += prompt.length;
      return r;
    },
    onText,
    undefined,
    recent ? lastQuestion : undefined,
  );
  lastQuestion = question;

  // Off the record: nothing is kept, and the main conversation never hears of it.
  if (!offRecord) {
    conv.record(question, text, promptChars, Date.now());
    saveChatState(conv.state);
    const reason = idleBefore ? 'idle' : conv.compactReason(Date.now(), question);
    if (reason) compactChat(reason);
    scheduleIdleCompaction();
    if (photoNow) await rememberPhotoQuestion(photoNow, question, text).catch(() => {});
    else await rememberExchange(question, text).catch(() => {});
  }

  return {
    text,
    usedPhoto: image,
    sources,
    ms: stats.totalMs,
    ttftMs: stats.ttftMs,
    web,
    webQuery,
    media: recall?.media
      ? [{ momentAt: recall.media.at, kind: recall.media.kind, path: recall.media.path }]
      : speechClipFor(question, sources),
  };
}
