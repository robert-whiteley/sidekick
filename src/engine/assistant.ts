import { answerReadBack, autoSend, beginReadBack, draftSummary, drafts } from '@/engine/actions';
import { readBackOn } from './hands-free';
import { trackAnswer } from './quick-commands';
import { postCodeCards, scanCodes } from './codes';
import { codePromptLine } from './codes-logic';
import { answerRecap } from './recap';
import { recallContext } from '@/memory/recall';
import { postRoutineCard, routineRequest } from './routines-store';
import SidekickNative from '../../modules/sidekick-native';
import {
  answerStopped,
  askLlm,
  askLlmInBackground,
  backgroundPreemptions,
  ensureLlm,
  llmLoadCount,
  prepareChat,
  setChatSystemSource,
} from './llm';
import {
  type ChatState,
  chatSystem,
  compact,
  type CompactReason,
  fitQuestion,
  Conversation,
  historyBudgetTokens,
  IDLE_COMPACT_MS,
  isContextFull,
  SUMMARY_MAX_TOKENS,
  SUMMARY_SYSTEM,
} from './conversation';
import { getSettings, onSettingsChange } from './settings';
import { clearChatState, loadChatState, saveChatState } from '@/memory/chat-state';
import { IPHONE, onIphone, platformText } from './platform-text';
import { questionPart, SYSTEM_PROMPT, withAnswerStyle } from './prompts';
import { keptFile } from '@/memory/media-files';
import { speechClipFor, usedSpeechClip } from './speech-clip';
import {
  WEB_OFFER_MAX_TOKENS,
  WEB_OFFER_SYSTEM,
  wantsWebOffer,
  webOfferCheckWanted,
  webOfferPrompt,
} from '@/web/lookup-logic';
import type { Moment } from '@/memory/store';
import { MEMORY_LIMIT, memoryContext, pickFacts } from './prompt-budget';
import {
  deleteMoment,
  rememberExchange,
  rememberPhotoQuestion,
  rememberPicture,
  savedFacts,
  searchMemory,
} from '@/memory/store';
import { asksAboutSomethingSeen } from '@/memory/search-logic';
import { ocrPromptLine } from '@/memory/photo-text';
import { photoTextOrNull } from './photo-ocr';
import { memoryStatus } from './progress';
import { phoneLocked, UNLOCK_FIRST } from '@/integrations/phone-controls';
import { withClipboard } from '@/integrations/extras';
import { translatePrompt } from '@/integrations/translate';
import {
  asksAboutFollowups,
  followupContext,
  formatDue,
  parseReminderRequest,
} from '@/memory/followup-logic';
import { addFollowup, listFollowups } from '@/memory/followups';
import { repeatLabel } from '@/memory/repeat-logic';
import { personPromptContext } from '@/memory/people';
import { queueOnline } from '@/engine/online-queue';
import { answerAboutPage, answerPastedTable } from './shared-doc';
import { firstUrl, pastedTable } from './shared-doc-logic';
import { askWithLookup, type WebSource } from '@/web/lookup';
import { research } from '@/web/research';
import { runPhotoEdit } from './photo-edit';
import { makePicture } from './picture';
import { answerLocation } from './location';
import { fillTool, resolveTimeWithModel, runTool, type RouteOutcome } from './tools';
import { decideRequest } from './decide';
import { embedderEvictsChat } from './residency';
import { searchByMeaning } from './residency-logic';
import { findOnPhone } from './phone-search';
import { decisionLabel, lockSafe, type Decision } from './decide-logic';
import { NOT_IN_ROUTINES } from './tools-logic';
import { forgetRanges } from '@/memory/time-range';
import type { PlannedAction } from '@/integrations/types';

export { SYSTEM_PROMPT, memoryContext };

export const DEFAULT_PHOTO_QUESTION = 'What am I looking at?';

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
  /**
   * The text reads a draft back and waits for "yes / no / change it": speak it even when answers
   * aren't normally spoken, then call `readBackDone(readBackId)` once the voice has finished.
   */
  readBackId?: string;
  /** Stored moments the answer is about (video clip or still), shown in the chat player. */
  media?: { momentAt: number; kind: 'video' | 'photo' | 'audio'; path?: string }[];
  /** Offline search hand-off: show the browser link with these words (opened only on tap). */
  browserQuery?: string;
  /**
   * Show the "Search the web in your browser" link: online lookup is off and the question needs
   * the web (news, latest, an explicit search), or a lookup ran and found nothing.
   */
  webLink?: boolean;
  /** It needed the internet and there was none: kept for later (online-queue.ts). */
  waitingOnline?: boolean;
  /** The saved exchange (a model answer in the main chat): Edit / Try again can take it back. */
  momentId?: number;
  /** A picture made on the phone (shown with a Report button; picture.ts). */
  picture?: { prompt: string };
  /** A button under the answer that opens a screen in the app (e.g. the erase brush). */
  /** open: Android opens this original (a found photo or file) in the phone's own app. */
  link?: { label: string; href: string; open?: string };
  /**
   * Asked with [attached]: the model chose no phone tool, so nothing was done here and the caller
   * answers about the attached file itself (shared-doc.ts answerShared).
   */
  notTool?: boolean;
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

/** The chat's instructions: the usual ones plus the user's "How Sidekick answers" text. */
export const answerSystem = () => withAnswerStyle(SYSTEM_PROMPT, getSettings().answerStyle);
/** The chat's instructions with the conversation so far, the owner's own text last. */
const chatPrompt = (state: ChatState) =>
  chatSystem(SYSTEM_PROMPT, state, getSettings().answerStyle);

/** The one continuous conversation (loaded from the phone on first use). */
export function conversation(): Conversation {
  if (!chat) {
    chat = new Conversation(loadChatState(), chatBudget());
    prepareChat(chatPrompt(chat.state));
  }
  return chat;
}

setChatSystemSource(() => chatPrompt(conversation().state));

// New "How Sidekick answers" text: the model's chat starts again with it (from the summary and
// the last turns, so nothing said is lost).
let styleNow = getSettings().answerStyle;
onSettingsChange((st) => {
  if (st.answerStyle === styleNow) return;
  styleNow = st.answerStyle;
  if (!chat) return;
  chat.restart();
  prepareChat(chatPrompt(chat.state));
});

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
    getSettings().answerStyle,
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
  prepareChat(answerSystem());
  lastQuestion = undefined;
}

/**
 * Edit / Try again on the last exchange: it is taken back before the question is asked again,
 * so the one continuous chat stays consistent. Its turn leaves the conversation (the model's
 * chat starts fresh from the summary and the turns left), and its saved memory is deleted.
 */
export async function forgetLastExchange(answerText: string, momentId?: number): Promise<void> {
  const c = conversation();
  c.dropLast(answerText);
  saveChatState(c.state);
  prepareChat(chatPrompt(c.state));
  lastQuestion = c.state.turns.at(-1)?.q;
  if (momentId != null) await deleteMoment(momentId);
}

export async function answer(
  question: string,
  photoNow: string | null,
  onText: (full: string) => void,
  /**
   * The chat is always continuous (keepHistory is ignored, kept for older callers). offTheRecord:
   * uses memories but saves nothing, in its own chat (default: the Off the record setting).
   */
  opts?: {
    keepHistory?: boolean;
    offTheRecord?: boolean;
    spoken?: boolean;
    /** Progress lines as each step starts: searching memory, looking at frames, online. */
    onStatus?: (line: string) => void;
    /** The recalled clip or photo, shown as soon as it is found (before the answer). */
    onFound?: (media: NonNullable<AnswerResult['media']>) => void;
    /** Run by a routine (routines.ts): no new routines from it, and drafts wait for a tap. */
    routine?: boolean;
    /** Re-run of a request the tool router rewrote: rules only, no second routing pass. */
    routed?: boolean;
    /** A question kept until back online (online-queue.ts): look it up whatever the rules say. */
    forceLookup?: boolean;
    /**
     * The caller saves the exchange in memory itself (the online queue, which saves every answer
     * it gets the same way): not saved here, so it isn't kept twice.
     */
    callerSaves?: boolean;
    /** Dev answers bench: a routed action is reported, never done (no draft, timer or reminder). */
    dryActions?: boolean;
    /** The answer will be read out: plain sentences, no lists or tables. */
    voiceAnswer?: boolean;
    /**
     * Online lookup off and the answer couldn't give the facts asked for (the model checks after
     * the answer is shown): offer the "Search the web in your browser" link under it.
     */
    onWebOffer?: () => void;
    /**
     * A file is attached in the chat: only the tool choice runs here, so "turn off spoken answers"
     * still changes the setting; anything else comes back as `notTool` for the caller to answer
     * about the file.
     */
    attached?: boolean;
  },
): Promise<AnswerResult> {
  onText = trackAnswer(onText); // "repeat that"
  const status = opts?.onStatus ?? (() => {});
  const done = (text: string): AnswerResult => {
    onText(text);
    return { text, usedPhoto: null, sources: [], ms: 0, ttftMs: 0, local: true };
  };
  if (!opts?.routed) forgetRanges();
  const offRecord = opts?.offTheRecord ?? getSettings().offTheRecord ?? false;
  if (!offRecord) offRecordStarted = false;
  const saveHere = !offRecord && !opts?.callerSaves;
  // Time words a fixed reader can't parse ("over Christmas"): the model gives the span once, and
  // search, recall, recaps and location all use it (tools.ts).
  if (!photoNow && !opts?.routed) await resolveTimeWithModel([question]).catch(() => null);
  // Plan cards and replies from tools: read-back, countdown, the card in the chat.
  const finishPlan = (plan: PlannedAction): AnswerResult => {
    const draftId = plan.kind === 'draft' ? plan.draft.id : undefined;
    // Driving-style read-back: "Text to Sam: I'm running late. Send it?" then the countdown.
    let readBackId = plan.kind === 'reply' ? plan.readBackId : undefined;
    let text = plan.kind === 'reply' ? plan.text : draftSummary(plan.draft);
    if (draftId && !opts?.routine && readBackOn(!!opts?.spoken)) {
      const said = beginReadBack(draftId);
      if (said) [text, readBackId] = [said, draftId];
    }
    if (draftId && !readBackId && !opts?.routine) autoSend(draftId);
    onText(text);
    return {
      text,
      usedPhoto: null,
      sources: [],
      ms: 0,
      ttftMs: 0,
      local: true,
      draftId,
      readBackId,
      browserQuery: plan.kind === 'reply' ? plan.browserQuery : undefined,
    };
  };
  // Translation of [given] (or, from the camera, the text in view read exactly by OCR).
  const translate = async (
    given: string,
    target: string,
    fromView: boolean,
  ): Promise<AnswerResult> => {
    let source = given;
    if (fromView) {
      if (!photoNow) return done(platformText('translateNeedsPhoto'));
      status('Reading the text…');
      source = (await photoTextOrNull(photoNow)) ?? '';
      if (!source.trim()) return done("I can't see any text to translate.");
    }
    status(`Translating into ${target}…`);
    const t0 = Date.now();
    const { text } = await askLlm(translatePrompt(source, target), null, onText, {
      system: SYSTEM_PROMPT,
      maxTokens: 400,
      scratch: true,
    });
    return { text, usedPhoto: photoNow, sources: [], ms: Date.now() - t0, ttftMs: 0 };
  };
  let useClipboard = false;
  // The model chose to play back a recording (play_recording): the heard line's clip is shown.
  let wantsRecording = false;
  const routed = async (o: RouteOutcome): Promise<AnswerResult | null> => {
    switch (o.kind) {
      case 'reply':
        return done(o.text);
      case 'plan':
        return finishPlan(o.plan);
      case 'rules':
        return answer(o.text, null, onText, { ...opts, routed: true });
      case 'translate':
        // "Translate this" with a file attached: the file is translated by the caller.
        if (opts?.attached && !o.text.trim()) return null;
        return translate(o.text, o.to, !o.text.trim());
      case 'recap': {
        const recap = await answerRecap(o.req, onText);
        if (!recap) return null;
        return {
          text: recap.text,
          usedPhoto: null,
          sources: [],
          ms: recap.ms,
          ttftMs: 0,
          ...(recap.local ? { local: true } : {}),
        };
      }
      case 'answer':
        useClipboard = !!o.clipboard;
        wantsRecording = !!o.recording;
        return null;
      case 'research': {
        // Several searches, pages read on the phone, one report with numbered sources.
        const r = await research(o.topic, onText, status, undefined, !!o.news);
        // No internet: the research waits and runs once back online (online-queue.ts).
        if (r.offline && !offRecord && !opts?.routine) {
          const text = queueOnline('research', o.topic, Date.now(), undefined, { news: o.news });
          return { ...done(text), waitingOnline: true };
        }
        // Stopped part-way: shown, but not kept as if it were the report.
        if (saveHere && !r.local && !answerStopped())
          await rememberExchange(question, r.text).catch(() => {});
        return {
          text: r.text,
          usedPhoto: null,
          sources: [],
          ms: r.ms,
          ttftMs: 0,
          web: r.web,
          webQuery: r.queries[0],
          // Nothing found online: offer the browser search instead.
          webLink: !r.local && !r.web.length && !!r.queries[0],
          ...(r.local ? { local: true } : {}),
        };
      }
      case 'edit_photo': {
        // "Make the background white", "turn it the right way up": a new, edited copy.
        if (!photoNow) return null;
        const edit = await runPhotoEdit(o.edit, photoNow, status);
        onText(edit.text);
        return {
          text: edit.text,
          usedPhoto: photoNow,
          sources: [],
          ms: edit.ms,
          ttftMs: 0,
          local: true,
          // momentAt 0: a new file, not a stored moment, so no camera frames are shown around it.
          media: edit.path ? [{ momentAt: 0, kind: 'photo', path: edit.path }] : undefined,
          link: edit.link,
        };
      }
      case 'find': {
        // A photo or file the user allowed for phone search, found and read on the phone.
        const r = await findOnPhone(question, o.req, onText, status);
        return {
          text: r.text,
          usedPhoto: null,
          sources: [],
          ms: r.ms,
          ttftMs: 0,
          local: true,
          media: r.photoPath ? [{ momentAt: 0, kind: 'photo', path: r.photoPath }] : undefined,
          link: r.link,
        };
      }
      case 'picture': {
        // Drawn on the phone (picture.ts); kept in the chat history unless off the record.
        const r = await makePicture(question, o.prompt, status);
        onText(r.text);
        const momentId =
          r.path && !offRecord
            ? await rememberPicture(question, r.text, r.path).catch(() => undefined)
            : undefined;
        return {
          text: r.text,
          usedPhoto: null,
          sources: [],
          ms: r.ms,
          ttftMs: 0,
          local: true,
          media: r.path ? [{ momentAt: 0, kind: 'photo', path: r.path }] : undefined,
          picture: r.path ? { prompt: r.prompt } : undefined,
          momentId,
          link: r.needsDownload
            ? { label: 'Open Make pictures', href: '/settings/pictures' }
            : undefined,
        };
      }
    }
  };

  // A tool's own handler, given the words tools.ts wrote for it ("remind me to call Jo at 17:00",
  // "what's the weather in Leeds tomorrow"): never the user's words, which the model read.
  let noPlace: string | null = null;
  if (opts?.routed) {
    const loc = await answerLocation(question, { offRecord }).catch(() => null);
    noPlace = loc?.empty ? loc.text : null;
    if (loc && !noPlace) {
      onText(loc.text);
      return {
        text: loc.text,
        usedPhoto: null,
        sources: [],
        ms: 0,
        ttftMs: 0,
        local: !loc.web,
        web: loc.web,
        waitingOnline: loc.waitingOnline,
      };
    }
    const reminder = parseReminderRequest(question, new Date());
    if (reminder) {
      await addFollowup(reminder);
      // "tomorrow 09:00" → "tomorrow at 09:00"
      const due = reminder.repeat
        ? `${repeatLabel(reminder.repeat)} at ${new Date(reminder.dueAt!).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
        : formatDue(reminder, new Date()).replace(/ (\d{1,2}[:.]\d{2}\D*)$/, ' at $1');
      const what = reminder.title.charAt(0).toLowerCase() + reminder.title.slice(1);
      return done(
        due
          ? `OK, I'll remind you to ${what} ${due}.`
          : `I've added "${reminder.title}" to your to-dos. Say a time if you want a reminder.`,
      );
    }
    const routine = opts.routine || offRecord ? null : routineRequest(question);
    if (routine) {
      if (routine.routineId) postRoutineCard(routine.routineId);
      return done(routine.text);
    }
  }

  // Cells pasted into the question (a bill, a list of figures): worked out exactly on them like
  // an attached spreadsheet, not added up by the model.
  const pasted = photoNow || opts?.routed || opts?.attached ? null : pastedTable(question);
  if (pasted) {
    const r = await answerPastedTable(pasted, onText, status, offRecord);
    return { text: r.text, usedPhoto: null, sources: [], ms: r.ms, ttftMs: 0 };
  }

  // A link in the question ("summarise https://…"): that one page is read (Online on) and the
  // answer comes from it, with the page shown as the source; offline it waits (shared-doc.ts).
  const pageUrl = photoNow || opts?.attached ? null : firstUrl(question);
  if (pageUrl) {
    const r = await answerAboutPage(pageUrl, question, onText, status, offRecord);
    if (saveHere && !r.waitingOnline && !answerStopped())
      await rememberExchange(question, r.text).catch(() => {});
    return {
      text: r.text,
      usedPhoto: null,
      sources: [],
      ms: r.ms,
      ttftMs: 0,
      web: r.web,
      waitingOnline: r.waitingOnline,
      local: !r.web,
    };
  }

  // What the request needs, decided by the model in any wording or language (decide.ts): an
  // answer, an online lookup (offered only while lookup is on), or one phone tool, whose
  // arguments the model then fills in for that tool alone and code checks (tools.ts).
  let lookupWanted = !!opts?.forceLookup;
  let newsWanted = false;
  // Whether the model said the answer is in the owner's memories (undefined: no sorter ran).
  let memoryWanted: boolean | undefined;
  if (!opts?.routed && !opts?.forceLookup) {
    // A spoken answer to the draft just read back ("yes", "change it to …"): only while one is
    // waiting, never from a routine run (its text isn't the user's reply).
    const readBack = opts?.routine ? null : await answerReadBack(question).catch(() => null);
    if (readBack) return finishPlan(readBack);
    const draftOpen = !!drafts.latestOpen();
    const chatNow = conversation();
    const last = chatNow.state.turns.at(-1);
    const { decision, ms, reply } = await decideRequest(question, {
      previous: last && chatNow.idleFor(Date.now()) < IDLE_COMPACT_MS ? last : undefined,
      draftOpen,
      photo: !!photoNow,
      file: !!opts?.attached,
    }).catch(() => ({ decision: { kind: 'answer' } as Decision, ms: 0, reply: '' }));
    const mem = decision.kind === 'answer' && decision.memory ? ' memory' : '';
    console.log(`[decide] ${decisionLabel(decision)}${mem} (${reply}) in ${ms} ms`);
    // Phone locked (screen off, hands-free): nothing personal until it is unlocked. Routine and
    // back-online runs are the user's own standing requests: they answer into a notification.
    const locked = !opts?.routine && phoneLocked();
    if (decision.kind === 'do' && !(opts?.routine && NOT_IN_ROUTINES.has(decision.tool))) {
      const fill = await fillTool(question, decision.tool).catch(() => null);
      console.log(`[decide] ${decision.tool} args ${fill?.error ?? fill?.tool ?? 'none'}`);
      if (fill && fill.tool === decision.tool && !fill.error) {
        if (locked && !lockSafe(fill.tool, fill.args)) return done(UNLOCK_FIRST);
        if (opts?.dryActions) return done(`[dry] ${fill.tool} ${JSON.stringify(fill.args)}`);
        // iPhone: no live camera (ADR 0006); a photo is taken on the Ask screen instead.
        if (onIphone() && fill.tool === 'camera' && fill.args.on === true)
          return done(IPHONE.takePhotoFirst);
        const outcome = await runTool(fill.tool, fill.args, question, {
          routine: opts?.routine,
          offRecord,
        }).catch(() => null);
        const r = outcome ? await routed(outcome) : null;
        if (r) return r;
      }
    }
    if (locked) return done(UNLOCK_FIRST);
    if (opts?.attached) {
      console.log(`[decide] about the attached file`);
      return { text: '', usedPhoto: null, sources: [], ms: 0, ttftMs: 0, notTool: true };
    }
    lookupWanted = decision.kind === 'lookup';
    newsWanted = decision.kind === 'lookup' && !!decision.news;
    // A tool that didn't run falls through to an answer without a view on memory.
    memoryWanted =
      decision.kind === 'do' ? undefined : decision.kind === 'answer' && !!decision.memory;
  }

  let sources: Moment[] = [];
  let facts: string[] = [];
  status('Searching memory…');
  try {
    [sources, facts] = await Promise.all([
      // A few extra candidates so a remembered photo can still be found below.
      searchMemory(question, photoNow ? MEMORY_LIMIT.photo : MEMORY_LIMIT.text + 2, new Date(), {
        // On a small phone, by meaning only when the model said the answer is in memory: the
        // memory-search model would unload the chat model (residency-logic.ts).
        words: !searchByMeaning({
          evictsChat: embedderEvictsChat(),
          photo: !!photoNow,
          memory: memoryWanted,
        }),
      }),
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

  if (noPlace && !sources.length) return done(noPlace);

  let image = photoNow;
  if (!image && asksAboutSomethingSeen(question)) {
    // A picture Sidekick drew is never something the user saw.
    image =
      sources
        .filter((m) => m.kind !== 'picture')
        .map((m) => keptFile(m.photoPath))
        .find((p) => p !== null) ?? null;
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
  if (recall?.media)
    opts?.onFound?.([
      { momentAt: recall.media.at, kind: recall.media.kind, path: recall.media.path },
    ]);
  status(memoryStatus(sources.length, recall?.images.length ?? 0, recall?.refs.length ?? 0));
  if (recall && recall.intent !== 'none')
    console.log(
      `[recall] ${recall.intent}: ${recall.refs.length} matches, ${recall.images.length} images, media ${recall.media?.kind ?? 'none'}`,
    );
  // The photo's exact text (OCR, ~1 s) helps the model read numbers and names right.
  if (image) status('Reading the text in the picture…');
  const [ocrText, codes] = await Promise.all([
    photoTextOrNull(image),
    photoNow ? scanCodes(photoNow) : Promise.resolve([]),
  ]);
  // The slow steps get their own lines (the chat counts their seconds): loading the model again,
  // and the model looking at the picture (on the iPhone's CPU, tens of seconds).
  if (!SidekickNative.llmIsLoaded()) {
    status('Loading the model…');
    await ensureLlm().catch(() => {}); // a failure is reported by the question itself
  }
  if (image) status('Looking at the picture…');
  // A QR code or barcode in the photo: its content for the model, and a card with its buttons.
  if (codes.length) postCodeCards(codes);
  const seenText = ocrPromptLine(ocrText) + codePromptLine(codes);
  const recallPart = recall?.promptPart ?? '';
  // A camera frame answers the question: unrelated notes would only pull the model away from it
  // ("I have no information about what you saw"), so they stay out of the prompt.
  const notes = recall?.images.length
    ? ''
    : memoryContext(sources, facts, sources.length, question);
  const conv = conversation();
  if (conv.keepHistory() && chatLoad !== llmLoadCount()) conv.restart(); // the model was reloaded
  const idleBefore = conv.compactReason(Date.now()) === 'idle';
  // The model's chat continues; a fresh one (first question, after a restart or a compaction)
  // starts from the running summary and the last turns.
  const system = chatPrompt(conv.state);
  let keep = offRecord ? offRecordStarted : conv.keepHistory();
  let promptChars = 0;
  /** The question reached the model's chat (Stop before that leaves the chat untouched). */
  let reachedModel = false;
  const recent = conv.idleFor(Date.now()) < IDLE_COMPACT_MS;
  // Online lookup (when on) sends only the question text; the prompt itself stays on the phone.
  const looked = await askWithLookup(
    question,
    !!image,
    (webPart) =>
      `${agenda}${person}${webPart}${notes}${seenText}${recallPart}${questionPart(fitQuestion(recall?.modelQuestion ?? (useClipboard ? withClipboard(question) : null) ?? question), new Date(), !!opts?.voiceAnswer)}`,
    async (prompt, t, o) => {
      // Would overflow the model's chat (compaction kept being interrupted): start fresh from
      // the summary and the last turns.
      if (keep && !offRecord && conv.fitOrRestart(prompt.length)) {
        console.log(`[chat] the model's chat is full: starting a fresh one`);
        keep = false;
      }
      if (!answerStopped()) reachedModel = true;
      const ask = () =>
        askLlm(prompt, image, t, { system, keepHistory: keep, undoable: o?.undoable, offRecord });
      let r: Awaited<ReturnType<typeof ask>>;
      try {
        r = await ask();
      } catch (e) {
        // Fuller than estimated: once more in a fresh chat, or every later question would fail.
        if (!keep || !isContextFull(e)) throw e;
        console.log(`[chat] model chat full (${String(e)}); asking again in a fresh one`);
        if (!offRecord) conv.restart();
        keep = false;
        r = await ask();
      }
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
    status,
    { force: lookupWanted, news: newsWanted },
  );
  const { stats, web, webQuery } = looked;
  let { text } = looked;
  // Stopped before a word of the answer: nothing is kept, so the question can be asked again
  // (Send now asks it together with the new message). The model's chat may hold the question
  // with no answer: the next question starts a fresh chat from the summary and the kept turns.
  if (answerStopped() && !text.trim()) {
    console.log(`[ask] stopped before the answer began${reachedModel ? '' : ' (not asked yet)'}`);
    if (reachedModel) {
      if (offRecord) offRecordStarted = false;
      else conv.restart();
    }
    return { text: '', usedPhoto: image, sources, ms: stats.totalMs, ttftMs: stats.ttftMs };
  }
  // A back-online run that still can't reach the internet: nothing to keep, it waits again.
  if (looked.offline && opts?.forceLookup)
    return {
      text,
      usedPhoto: image,
      sources,
      ms: stats.totalMs,
      ttftMs: stats.ttftMs,
      waitingOnline: true,
    };
  // Needed the internet but there was none: kept and answered once back online.
  if (looked.offline && !opts?.forceLookup && !offRecord && !answerStopped()) {
    text = `${text}\n\n${queueOnline('lookup', question)}`;
    onText(text);
  }
  lastQuestion = question;
  // Stopped part-way: LiteRT-LM fails every later turn of a chat whose answer was cancelled
  // ("Task cancelled" at once, phone check 28 Nov). The part-answer is kept below, and the next
  // question starts a fresh chat from the summary and the kept turns, this one included.
  if (answerStopped() && reachedModel) {
    if (offRecord) offRecordStarted = false;
    else conv.restart();
  }

  // Off the record: nothing is kept, and the main conversation never hears of it.
  let momentId: number | undefined;
  if (!offRecord) {
    conv.record(question, text, promptChars, Date.now());
    saveChatState(conv.state);
    const reason = idleBefore ? 'idle' : conv.compactReason(Date.now(), question);
    if (reason) compactChat(reason);
    scheduleIdleCompaction();
    if (saveHere)
      momentId =
        (await (
          photoNow
            ? rememberPhotoQuestion(photoNow, question, text)
            : rememberExchange(question, text)
        ).catch(() => undefined)) ?? undefined;
  }

  // An answer drawn from a heard line: that line's recording, to play. The model says which
  // line it used, if any (only lines that were in the prompt), after the answer is shown.
  if (!recall?.media && !wantsRecording && opts?.onFound) {
    const show = opts.onFound;
    void usedSpeechClip(question, text, notes ? sources : [], askUsedClip).then(
      (clip) => clip && show(clip),
    );
  }

  // Online lookup off, and nothing offered yet: if the answer couldn't give the facts asked for
  // ("I don't know"), the model says so in a short check and the browser link is offered. Not
  // when the sorter said the answer is in the owner's memories: no web search knows their life.
  if (
    opts?.onWebOffer &&
    webOfferCheckWanted({
      lookupOn: !!getSettings().webLookup,
      lookupWanted,
      memoryWanted,
      photo: !!image,
      queuedOffline: !!looked.offline,
      routine: !!opts.routine,
      stopped: answerStopped(),
      text,
    })
  ) {
    const offer = opts.onWebOffer;
    void askLlm(webOfferPrompt(question, text), null, () => {}, {
      system: WEB_OFFER_SYSTEM,
      maxTokens: WEB_OFFER_MAX_TOKENS,
      scratch: true,
    })
      .then((r) => {
        const yes = wantsWebOffer(r.text);
        console.log(`[lookup] offline answer: ${yes ? 'browser link offered' : 'answered'}`);
        if (yes) offer();
      })
      .catch(() => {});
  }

  return {
    text,
    usedPhoto: image,
    sources,
    ms: stats.totalMs,
    ttftMs: stats.ttftMs,
    web,
    webQuery,
    webLink:
      !looked.offline &&
      !image &&
      (getSettings().webLookup ? !!webQuery && !web.length : lookupWanted),
    waitingOnline: (looked.offline && !offRecord) || undefined,
    momentId,
    media: recall?.media
      ? [{ momentAt: recall.media.at, kind: recall.media.kind, path: recall.media.path }]
      : wantsRecording
        ? speechClipFor(sources)
        : undefined,
  };
}

/** The short throwaway check behind usedSpeechClip (speech-clip.ts). */
const askUsedClip = (prompt: string, system: string) =>
  askLlm(prompt, null, () => {}, { system, maxTokens: 3, scratch: true }).then((r) => r.text);
