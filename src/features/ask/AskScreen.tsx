import { onListeningByVoice } from '@/engine/quick-commands';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AppText,
  DARK_COLORS,
  ErrorDetailsButton,
  ForceScheme,
  IconButton,
  radius,
  space,
  Tappable,
  TextButton,
  useScheme,
} from '@/ui';

import SidekickNative from '../../../modules/sidekick-native';
import {
  answer as answerQuestion,
  DEFAULT_PHOTO_QUESTION,
  forgetLastExchange,
  leaveOffTheRecord,
} from '@/engine/assistant';
import {
  headphonesOn,
  listenMediaButton,
  openBestCamera,
  setAsking,
  watchDevices,
} from '@/engine/devices';
import {
  holdLiveCamera,
  liveCameraOn,
  onLiveCamera,
  startLiveCamera,
  stopLiveCamera,
  watchLiveCamera,
} from '@/engine/live-camera';
import { notices } from '@/engine/notices';
import { errorDetailsFor } from '@/engine/error-details';
import { AnswerWatch, STALL_MS, STALLED_PHOTO_TEXT, STALLED_TEXT } from './answer-watch';
import { takeIntroMessage } from '@/features/onboarding/after-setup';
import {
  captionOneFrame,
  describeOnePhoto,
  noteUserActive,
  yieldToQuestion,
} from '@/engine/describe-photos';
import {
  ASSIST_KEY,
  entryReady,
  type EntryRequest,
  HANDS_FREE_MAX_MS,
  parseScreenGrab,
  SCREEN_QUESTION,
  SHARED_QUESTION,
  type ScreenGrab,
  screenNote,
  screenQuestion,
} from '@/engine/entry-points';
import {
  configureListening,
  isListening,
  resumeListening,
  askMicPermission,
  startListening,
  stopListening,
} from '@/engine/listen';
import { inferFactsIfIdle, stopFactInference } from '@/engine/fact-inference';
import { inferFollowupsIfIdle, stopFollowupInference } from '@/engine/followup-inference';
import { inferNamesIfIdle, stopNameInference } from '@/engine/name-inference';
import { stopConversationNotes, updateConversationNotes } from '@/engine/conversation-notes';
import { stopTranslateHeard, translateHeardIfIdle } from '@/engine/translate-heard';
import { driveBackupIfDue } from '@/engine/drive-backup-schedule';
import {
  answerOver,
  cancelLlm,
  ensureLlm,
  holdBackground,
  releaseBackground,
  stopAnswer,
} from '@/engine/llm';
import { stopResearch } from '@/web/research';
import { stopPicture } from '@/engine/picture';
import { readBackDone } from '@/engine/actions';
import { startFollowupNotifications } from '@/engine/followup-notify';
import { setRoutineUi } from '@/engine/routines';
import { routineLabel } from '@/engine/routines-logic';
import {
  canSpeakNow,
  handsFreeOn,
  haptic,
  hapticsForDrafts,
  noteHeadsetAsk,
  watchIncoming,
} from '@/engine/hands-free';
import { READ_BACK_REPLY_MS } from '@/engine/readback-logic';
import { getSettings } from '@/engine/settings';
import { StreamingSpeaker } from '@/engine/speaker';
import { Conversation } from '@/engine/conversation';
import { IPHONE, onIphone } from '@/engine/platform-text';
import { asksAboutWhatIsInView, wantsCameraNow } from '@/memory/search-logic';
import { embedWhenIdle } from '@/memory/embed-idle';
import { indexPhotosWhenIdle } from '@/memory/gallery';
import { syncSourcesIfDue } from '@/memory/sources';
import {
  capturePhoto,
  forgetUnagreedVoices,
  ingestJournal,
  learnOwnerVoice,
  syncOwnerVoice,
} from '@/memory/store';
import { loadChatHistory } from './chat-history';
import {
  type ChatMedia,
  type ChatMessage,
  type Exchange,
  isMicTap,
  lastExchange,
  mediaForAnswer,
  partialStatus,
  patchMessage,
  quietAfterBargeIn,
  BARGE_WAIT_MS,
  shouldSpeak,
  withoutExchange,
  withoutOffRecord,
} from './chat-logic';
import {
  editQueued,
  enqueue,
  type QueuedMessage,
  type StopReason,
  takeNext,
  toFront,
  unansweredAfter,
  withoutQueued,
  withOwed,
} from './send-queue';
import { ChatHeader } from './ChatHeader';
import { LiveFrame } from './LiveFrame';
import { Composer } from './Composer';

import { LiveConversation } from './LiveConversation';
import { DraftCard } from './DraftCard';
import { type MessageAction, MessageBubble } from './MessageBubble';
import { NoticeItem, useNotices } from './NoticeLines';
import { QueuedMessages } from './QueuedMessages';
import { ScreenGrabBar } from './ScreenGrabBar';
import { DARK, LIGHT } from './theme';
import { useEntry } from './useEntry';
import { type SharedItem, sharedComposerText, sharedKind, watchShares } from '@/engine/share-in';
import {
  answerShared,
  attachmentFor,
  cancelRecording,
  finishRecording,
  pickAttachment,
  recordingStatus,
  resumeRecordings,
  shareSheet,
  watchRecordings,
} from '@/engine/shared-doc';
import type { Attachment } from '@/engine/shared-doc-logic';
import { integrationsNative } from '@/integrations/native';
import { AttachmentBar, TextResultActions } from './AttachmentBar';

type Phase = 'idle' | 'loading' | 'thinking' | 'answering';

/** How long a screenshot from the assist key is used for questions. */
const SCREEN_TTL_MS = 2 * 60_000;

const stripFile = (uri?: string) => uri?.replace(/^file:\/\//, '') ?? null;

/** The main screen: one continuous chat; the camera opens only while it is in use. */
export function AskScreen({
  entry = null,
  onEntryHandled,
}: {
  /** Opened from the Quick Settings tile, widget or phone assistant. */
  entry?: EntryRequest | null;
  onEntryHandled?: () => void;
} = {}) {
  const [permission, requestPermission] = useCameraPermissions();
  // Live camera memory: runs natively (also with the view closed) until stopped.
  // Only the chat sets the status bar while it is on screen; other pages use the app-wide one.
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const [live, setLive] = useState(liveCameraOn);
  const [useCamera, setUseCamera] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  /** Edit: the last exchange whose question is back in the box; sending replaces it. */
  const [editing, setEditingState] = useState<Exchange | null>(null);
  const editingRef = useRef<Exchange | null>(null);
  const setEditing = (x: Exchange | null) => {
    editingRef.current = x;
    setEditingState(x);
  };
  const [status, setStatus] = useState('');
  /** After a failed or stopped answer: what "Copy error details" copies. */
  const [errorDetails, setErrorDetails] = useState<(() => string) | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [listening, setListening] = useState(isListening());
  const [holding, setHoldingState] = useState(false);
  const holdingRef = useRef(false);
  const setHolding = (v: boolean) => {
    holdingRef.current = v;
    setHoldingState(v);
  };
  const [capturing, setCapturing] = useState(false);
  const [offRecord, setOffRecordState] = useState(false);
  const offRecordRef = useRef(false);
  /** The answer being read out (its bubble shows a mute button). */
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [webUsed, setWebUsed] = useState(false);
  const captureRef = useRef<{
    photo: Promise<string | null>;
    at: number;
    mic: Promise<boolean>;
  } | null>(null);
  const camera = useRef<CameraView>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const speaker = useRef<StreamingSpeaker | null>(null);
  /** A spoken answer is still being said: background passes are held until the voice is idle. */
  const awaitingVoiceRef = useRef(false);
  const busyRef = useRef(true);
  const askRef = useRef<(q: string, followUp?: boolean) => void>(() => {});
  // A routine run shown like a question (routines.ts): its label and "routine" mode for ask().
  const routineRef = useRef<{ label: string } | null>(null);
  const routineAskRef = useRef<(q: string) => Promise<void>>(async () => {});
  // Spoken back-and-forth: follow-ups keep the chat; one heard mid-answer waits for it to stop.
  const conversation = useRef(new Conversation());
  // Sent while answering (typed, said or from the wake word): waits its turn (send-queue.ts).
  const [queue, setQueueState] = useState<QueuedMessage[]>([]);
  const queueRef = useRef<QueuedMessage[]>([]);
  const setQueue = (f: (q: QueuedMessage[]) => QueuedMessage[]) => {
    queueRef.current = f(queueRef.current);
    setQueueState(queueRef.current);
  };
  /** The queued message whose text is in the box: it doesn't start until the edit ends. */
  const [editingQueued, setEditingQueuedState] = useState<string | null>(null);
  const editingQueuedRef = useRef<string | null>(null);
  const setEditingQueued = (id: string | null) => {
    editingQueuedRef.current = id;
    setEditingQueuedState(id);
  };
  /** How the answer being written was stopped (Stop, or Send now on a queued message). */
  const stopReasonRef = useRef<StopReason>(null);
  /** Questions stopped by Send now before a word of their answer: asked with the next one. */
  const owedRef = useRef<string[]>([]);
  /** The owner talked over the answer: what they say goes first. */
  const bargedRef = useRef(false);
  /** The latest answer's bubble (the one a barge-in stops). */
  const lastReplyRef = useRef<string | null>(null);
  /**
   * After a barge-in, waiting for what is said next: if no question comes (cut off, too short,
   * not heard), the chat says so instead of leaving nothing.
   */
  const bargeWaitRef = useRef<{ timer: ReturnType<typeof setTimeout>; replyId: string | null }>(
    null,
  );
  const bargeQuietRef = useRef<() => void>(() => {});
  const clearBargeWait = useCallback(() => {
    if (bargeWaitRef.current) clearTimeout(bargeWaitRef.current.timer);
    bargeWaitRef.current = null;
  }, []);
  const armBargeWait = useCallback(
    (replyId: string | null) => {
      clearBargeWait();
      bargeWaitRef.current = {
        timer: setTimeout(() => bargeQuietRef.current(), BARGE_WAIT_MS),
        replyId,
      };
    },
    [clearBargeWait],
  );
  const pumpRef = useRef<() => void>(() => {});
  const stopRef = useRef<(why: 'stop' | 'now') => void>(() => {});
  const [screen, setScreen] = useState<ScreenGrab | null>(null);
  // A shared file, recording, web page or selected text the next questions are about.
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const attachmentRef = useRef<Attachment | null>(null);
  useEffect(() => {
    attachmentRef.current = attachment;
  }, [attachment]);
  const [cameraReady, setCameraReady] = useState(false);
  // Opened hands-free (tile, widget, assistant) or the mic was tapped: a tap, or a timeout, ends it.
  const handsFree = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdEndRef = useRef<() => void>(() => {});
  const holdStartRef = useRef<(free?: boolean, maxMs?: number) => void>(() => {});
  /** A draft read aloud: when the voice ends, its countdown starts and the mic opens for the answer. */
  const readBackRef = useRef<string | null>(null);
  // Driving / walking: bigger buttons, answers spoken, drafts read back.
  const [handsFreeMode, setHandsFreeMode] = useState(() => handsFreeOn());
  /** The current mic press: when it started, or that it ends hands-free listening. */
  const micPress = useRef<{ start: number } | 'end' | null>(null);
  const noticeList = useNotices();
  const dark = useScheme() === 'dark' || offRecord;
  const theme = dark ? DARK : LIGHT;

  const setOffRecord = (on: boolean) => {
    offRecordRef.current = on;
    setOffRecordState(on);
    // Off the record: what is heard isn't kept as audio either.
    try {
      SidekickNative.audioSaveEnabled(!on);
    } catch {
      // Older native build.
    }
    // What was said Off the record disappears with it.
    if (!on) {
      setMessages(withoutOffRecord);
      setQueue(withoutOffRecord);
      leaveOffTheRecord();
    }
  };

  // Warm the model up in the background so the first question is quicker.
  useEffect(() => {
    ensureLlm(setStatus)
      .then(() => setStatus(''))
      .catch((e) => setStatus(`Model failed to load: ${String(e)}`))
      .finally(() => {
        busyRef.current = false;
        setPhase('idle');
        // Sent while the model was loading.
        pumpRef.current();
      });
  }, []);

  // "Stop listening" / "start listening" said to Sidekick.
  useEffect(() => onListeningByVoice(setListening), []);
  // Listening can stop outside this screen (Stop in the notification, Android ending the service):
  // re-read the real state when the app comes back and every few seconds while it is open, so the
  // button never shows "on" for a microphone that is off. A cheap synchronous native read.
  useEffect(() => {
    const sync = () => {
      const on = isListening();
      setListening((was) => {
        // Stopped elsewhere: drop the "Listening for …" line too.
        if (was && !on) setStatus((st) => (st.startsWith('Listening for') ? '' : st));
        return on;
      });
    };
    const sub = AppState.addEventListener('change', (st) => st === 'active' && sync());
    const timer = setInterval(() => AppState.currentState !== 'background' && sync(), 3000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);

  // Listening stays on across the app being killed and reopened.
  useEffect(() => {
    resumeListening()
      .then((on) => on && setListening(true))
      .catch(() => {});
  }, []);

  // Plugged-in cameras, mics and headphones; the headset button asks a question (walk mode).
  useEffect(() => {
    openBestCamera();
    const stopWatch = watchDevices(() => setHandsFreeMode(handsFreeOn()));
    const stopButton = listenMediaButton((action) => {
      if (action !== 'ask') return;
      noteHeadsetAsk();
      setHandsFreeMode(handsFreeOn());
      if (holdingRef.current) return void holdEndRef.current();
      setAsking(true);
      holdStartRef.current(true);
    });
    const stopTicks = hapticsForDrafts();
    // New messages read aloud (Settings > Connections > Read incoming messages).
    const stopIncoming = watchIncoming((text) => {
      if (busyRef.current) return;
      const at = Date.now();
      setMessages((m) => [...m, { id: `in${at}`, role: 'assistant', text, at }]);
      new StreamingSpeaker(true).finish(text);
    });
    // The car connects / disconnects, or walk mode times out.
    const poll = setInterval(() => setHandsFreeMode(handsFreeOn()), 30_000);
    return () => {
      stopWatch();
      stopButton();
      stopTicks();
      stopIncoming();
      clearInterval(poll);
    };
  }, []);

  // Routines while the chat is open: shown and spoken like an answer (Settings › Routines).
  useEffect(() => {
    setRoutineUi(async (run) => {
      const label = `Routine: ${routineLabel(run.routine)}`;
      if (run.quick == null && !busyRef.current) {
        routineRef.current = { label: run.late ? `${label} ${run.late}` : label };
        await routineAskRef.current(run.question);
        return null;
      }
      const text =
        run.quick ?? (await answerQuestion(run.question, null, () => {}, { routine: true })).text;
      const shown = run.late ? `${text} ${run.late}` : text;
      const at = Date.now();
      setMessages((m) => [
        ...m,
        { id: `ru${at}`, role: 'user', text: label, at },
        { id: `ra${at}`, role: 'assistant', text: shown, at },
      ]);
      const speak =
        shouldSpeak({
          spoken: false,
          headphones: headphonesOn(),
          enabled: getSettings().speakAnswers,
        }) && canSpeakNow();
      if (speak && !busyRef.current) new StreamingSpeaker(true).finish(text);
      return shown;
    });
    return () => setRoutineUi(null);
  }, []);

  useEffect(() => {
    const stopWatch = watchLiveCamera();
    const stopLive = onLiveCamera(setLive);
    return () => {
      stopWatch();
      stopLive();
    };
  }, []);

  // The chat continues from where it was left.
  useEffect(() => {
    loadChatHistory()
      .then((h) => setMessages((now) => [...h, ...now]))
      .catch((e) => console.log(`[chat] history failed: ${String(e)}`))
      .finally(() => {
        // The first open after setup: a short hello with three things to try.
        const intro = takeIntroMessage();
        if (!intro) return;
        notices.post(
          {
            key: 'intro',
            kind: 'decision',
            text: intro.text,
            actions: intro.tries.map((t, i) => ({ label: t, id: String(i) })),
          },
          (id) => askRef.current(intro.tries[Number(id)]),
        );
      });
  }, []);

  // Wake word / background listening events, and moving what was heard into memory.
  useEffect(() => {
    configureListening();
    // Only the owner's voice (or the wake word) may interrupt an answer.
    void syncOwnerVoice().catch(() => {});
    // Consent mode: no voiceprint is kept for people who never agreed (older builds kept one).
    void forgetUnagreedVoices().catch(() => {});
    startFollowupNotifications();
    const subs = [
      SidekickNative.addListener('onWake', () => setStatus('Listening…')),
      // The words so far, live while the user talks; the final text replaces them.
      SidekickNative.addListener('onPartialTranscript', (e) => {
        if (!busyRef.current || e.source === 'question') setStatus(partialStatus(e.text));
        // Still talking after a barge-in: keep waiting for the question.
        if (bargeWaitRef.current) armBargeWait(bargeWaitRef.current.replyId);
      }),
      SidekickNative.addListener('onQuestion', (e) => {
        clearBargeWait();
        askRef.current(e.text, e.followUp);
      }),
      // Talking over the answer stops it (natively): what is said next is asked first.
      SidekickNative.addListener('onBargeIn', () => {
        setStatus('Listening…');
        console.log(`[ask] barge-in${busyRef.current ? ' while answering' : ''}`);
        armBargeWait(lastReplyRef.current);
        if (busyRef.current) {
          bargedRef.current = true;
          stopRef.current('now');
        }
      }),
      SidekickNative.addListener('onVoiceIdle', () => {
        conversation.current.answered(Date.now());
        setSpeakingId(null);
        if (awaitingVoiceRef.current) {
          awaitingVoiceRef.current = false;
          releaseBackground();
        }
        // Read back: the countdown starts now, and the mic listens for "yes / no / change it"
        // (with Listen on, its follow-up window hears the answer instead).
        const rb = readBackRef.current;
        readBackRef.current = null;
        if (rb) {
          readBackDone(rb);
          if (!isListening()) setTimeout(() => holdStartRef.current(true, READ_BACK_REPLY_MS), 150);
        }
      }),
      SidekickNative.addListener('onListenError', (e) =>
        setStatus(`Listening stopped: ${e.message}`),
      ),
      { remove: clearBargeWait },
    ];
    const tick = async () => {
      if (busyRef.current) return;
      try {
        await ingestJournal();
        // Enabled data sources (notifications, folders, calendar, contacts) when due.
        await syncSourcesIfDue();
        // New memories get vectors in batches, sooner while charging.
        await embedWhenIdle(() => busyRef.current);
        // Idle: read one saved photo's text into memory (only if the model is already loaded).
        // Else, charging and idle: caption one stored camera frame (a question or opening the app
        // stops it).
        void describeOnePhoto(busyRef.current).then((did) =>
          did || busyRef.current ? false : captionOneFrame(busyRef.current),
        );
        // Uses the model only if it is already loaded; a question cancels it.
        if (!busyRef.current) await inferFactsIfIdle();
        if (!busyRef.current) await inferFollowupsIfIdle();
        if (!busyRef.current) await inferNamesIfIdle();
        if (!busyRef.current) await translateHeardIfIdle();
        if (!busyRef.current) await updateConversationNotes();
        // Phone search (only what the user allowed): a few photos read on the charger.
        if (!busyRef.current) await indexPhotosWhenIdle(() => busyRef.current);
        void driveBackupIfDue();
      } catch (e) {
        console.log(`[memory] ingest failed: ${String(e)}`);
      }
    };
    const timer = setInterval(tick, 30_000);
    // Opening the app pauses frame captions for a while, so the phone is quick when picked up.
    const appState = AppState.addEventListener('change', (st) => {
      if (st === 'active') noteUserActive();
    });
    void tick();
    return () => {
      subs.forEach((s) => s.remove());
      appState.remove();
      clearInterval(timer);
    };
  }, [armBargeWait, clearBargeWait]);

  // The widget's Capture opens the camera for that one photo.
  const captureEntry = entry?.kind === 'capture';
  const cameraOn = (useCamera || captureEntry) && permission?.granted === true;
  const busy = phase !== 'idle';

  const toggleCamera = async () => {
    if (useCamera) {
      setUseCamera(false);
      setCameraReady(false);
      return;
    }
    if (!permission?.granted && !(await requestPermission()).granted) {
      setStatus('Camera permission is needed.');
      return;
    }
    setUseCamera(true);
  };

  const toggleLive = async () => {
    if (live) {
      stopLiveCamera();
      return;
    }
    if (!permission?.granted && !(await requestPermission()).granted) {
      setStatus('Camera permission is needed.');
      return;
    }
    // The preview hands the camera to the recorder: one app can't hold it twice.
    setCameraReady(false);
    if (!startLiveCamera()) setStatus("Couldn't start the live camera.");
  };

  const toggleListening = async () => {
    if (listening) {
      stopListening();
      setListening(false);
      setStatus('');
      return;
    }
    const err = await startListening();
    if (err) setStatus(err);
    else {
      setListening(true);
      setStatus(`Listening for "${getSettings().wakePhrase}"`);
    }
  };

  // Also while answering: what is said then waits its turn like a typed message.
  const holdStart = async (free = false, maxMs = HANDS_FREE_MAX_MS) => {
    if (handsFree.current) return;
    clearBargeWait();
    if (!(await askMicPermission())) {
      setStatus('Microphone permission is needed.');
      return;
    }
    speaker.current?.stop();
    setSpeakingId(null);
    SidekickNative.pttStart();
    haptic('listen');
    setHolding(true);
    if (free) {
      handsFree.current = setTimeout(() => holdEndRef.current(), maxMs);
      setStatus('Listening… tap the mic when done');
    } else if (!handsFree.current) setStatus('Listening… let go when done');
  };

  const holdEnd = async () => {
    setAsking(false);
    if (handsFree.current) clearTimeout(handsFree.current);
    handsFree.current = null;
    if (!holdingRef.current) return;
    setHolding(false);
    setStatus('Transcribing…');
    try {
      const { text, voice } = await SidekickNative.pttStop();
      if (voice && !offRecordRef.current) void learnOwnerVoice(voice).catch(() => {});
      if (!text) {
        setStatus("I didn't catch that.");
        return;
      }
      setStatus('');
      await ask(text);
    } catch (e) {
      setStatus(`Couldn't hear you: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Mic: hold to talk (let go = ask), or tap to talk and tap again when done.
  const micIn = () => {
    if (holdingRef.current || handsFree.current) {
      micPress.current = 'end';
      return;
    }
    micPress.current = { start: Date.now() };
    void holdStart();
  };
  const micOut = () => {
    const p = micPress.current;
    micPress.current = null;
    if (!p) return;
    if (p === 'end') return void holdEnd();
    if (isMicTap(p.start)) {
      handsFree.current = setTimeout(() => holdEndRef.current(), HANDS_FREE_MAX_MS);
      setStatus('Listening… tap the mic when done');
    } else void holdEnd();
  };

  const notSaved = () => {
    if (!offRecordRef.current) return false;
    setStatus('Off the record: nothing is saved. Leave it to save photos.');
    return true;
  };

  // Capture: tap saves a photo; hold to add a voice note (released = saved).
  const captureStart = () => {
    if (!cameraOn || captureRef.current || notSaved()) return;
    const at = Date.now();
    const photo = (async () => {
      const pic = await camera.current?.takePictureAsync({ quality: 0.8, shutterSound: false });
      return stripFile(pic?.uri);
    })();
    // Set synchronously so a quick tap's release always finds it.
    const mic = (async () => {
      if (holdingRef.current || !(await askMicPermission())) return false;
      SidekickNative.pttStart();
      return true;
    })();
    captureRef.current = { photo, at, mic };
    setCapturing(true);
    setStatus('Captured · keep holding to add a voice note');
  };

  const captureEnd = async () => {
    const c = captureRef.current;
    if (!c) return;
    captureRef.current = null;
    setCapturing(false);
    try {
      let note: string | null = null;
      if (await c.mic) {
        const { text, voice } = await SidekickNative.pttStop();
        // A quick tap records a fraction of a second of nothing: only keep real notes.
        if (Date.now() - c.at > 800 && text) note = text;
        if (note && voice) void learnOwnerVoice(voice).catch(() => {});
      }
      const path = await c.photo;
      if (!path) throw new Error('no photo');
      await capturePhoto(path, note, c.at);
      setStatus(note ? `Saved photo with note: "${note}"` : 'Saved photo');
    } catch (e) {
      setStatus(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Shared into Sidekick from another app, or attached with the paperclip: a picture to ask
  // about, text in the composer, or a file, recording, video, link or selected text as the
  // chat's attachment (shared-doc.ts).
  const openShared = useCallback((item: SharedItem) => {
    const kind = sharedKind(item);
    if (kind === 'image' || kind === 'text') {
      if (item.imagePath)
        setScreen({ shot: item.imagePath, text: '', at: Date.now(), shared: true });
      const text = sharedComposerText(item);
      if (text) setQuestion((cur) => (cur.trim() ? `${cur.trim()}\n${text}` : text));
      return;
    }
    if (!kind) return;
    setStatus('Opening the file…');
    void attachmentFor(item)
      .then((a) => {
        if (!a) return;
        if (a.kind === 'image' && a.path) {
          // A picture sent as a file: asked about like a shared picture (sight + text in it).
          setAttachment(null);
          setScreen({ shot: a.path, text: '', at: Date.now(), shared: true });
          return;
        }
        setScreen(null);
        setAttachment(a);
      })
      .catch((e) => console.log(`[share] ${String(e)}`))
      .finally(() => setStatus(''));
  }, []);
  useEffect(() => watchShares(openShared), [openShared]);
  const attachFile = () => {
    void pickAttachment()
      .then((item) => item && openShared(item))
      .catch((e) => {
        console.log(`[attach] ${String(e)}`);
        setStatus("Couldn't open the file picker.");
      });
  };

  // A recording being read: progress, then who said what (saved to memory) and a line in the chat.
  const recordingDone = useCallback((line: string, at = Date.now()) => {
    setMessages((m) => [...m, { id: `r${at}`, role: 'assistant', text: line, at }]);
  }, []);
  const recordingId =
    attachment?.recordingId &&
    !attachment.text &&
    !attachment.error &&
    (attachment.progress ?? 0) < 1
      ? attachment.recordingId
      : null;
  useEffect(() => {
    if (!recordingId) return;
    let finishing = false;
    const check = () => {
      const st = recordingStatus(recordingId);
      if (!st) return;
      if ((st.finished || st.error) && !finishing) {
        finishing = true;
        void finishRecording(recordingId, offRecordRef.current).then((r) => {
          if (!r) return;
          setAttachment((a) =>
            a?.recordingId === recordingId
              ? r.text
                ? { ...a, text: r.text, progress: 1 }
                : // A video with no speech still has its pictures.
                  a.kind === 'video' && a.frames?.length
                  ? { ...a, progress: 1 }
                  : { ...a, error: r.line }
              : a,
          );
          recordingDone(r.line);
        });
        return;
      }
      const progress = st.totalMs ? Math.min(0.99, st.doneMs / st.totalMs) : 0;
      setAttachment((a) => (a?.recordingId === recordingId ? { ...a, progress } : a));
    };
    check();
    const off = watchRecordings(check);
    const timer = setInterval(check, 5000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [recordingId, recordingDone]);
  // Recordings left reading when the app was closed carry on; finished ones are saved.
  useEffect(() => {
    void resumeRecordings(offRecordRef.current).then((done) => {
      for (const r of done) recordingDone(r.line);
    });
  }, [recordingDone]);

  const closeAttachment = () => {
    const a = attachmentRef.current;
    if (a?.recordingId && !a.text && !a.error && (a.progress ?? 0) < 1)
      cancelRecording(a.recordingId);
    a?.frames?.forEach((f) => SidekickNative.deleteFile(f.path));
    // Selected text: the other app gets nothing back, and its waiting step closes.
    if (a?.kind === 'selection' && a.replaceable) integrationsNative()?.finishProcessText?.(null);
    setAttachment(null);
  };

  const replaceInApp = (text: string) => {
    const ok = integrationsNative()?.finishProcessText?.(text) ?? false;
    setStatus(ok ? '' : 'That app is no longer waiting for the text. Copy it instead.');
    if (ok) setAttachment(null);
  };

  // Stop, or Send now ('now'): the answer ends cleanly with what it wrote (marked stopped); its
  // remaining steps (routing, tools, the lookup's second pass) get nothing (llm.ts stopAnswer).
  const stop = (why: 'stop' | 'now' = 'stop') => {
    if (busyRef.current) {
      stopReasonRef.current = why;
      stopAnswer();
    } else cancelLlm();
    stopResearch();
    stopPicture();
    speaker.current?.stop();
    setSpeakingId(null);
    awaitingVoiceRef.current = false;
    releaseBackground();
  };

  /** Queues a message sent while answering; `first` (Send now) stops the answer for it. */
  const queueMessage = (m: QueuedMessage, first: boolean) => {
    setQueue((qq) => (first ? toFront(enqueue(qq, m), m.id) : enqueue(qq, m)));
    if (first) stop('now');
  };

  const ask = async (
    spoken?: string,
    followUp = false,
    offRecordNow = offRecordRef.current,
    /** Try again: this text, replacing the last exchange (the composer is left as it is). */
    again?: { text: string; replace: Exchange },
    /** A message sent while busy, now answered in turn. */
    from?: QueuedMessage,
  ) => {
    const typed = spoken === undefined && !again && !from;
    // Something was asked after a barge-in: no "didn't catch that" for it.
    clearBargeWait();
    const voiced = from ? from.spoken : spoken !== undefined;
    if (from) [followUp, offRecordNow] = [from.followUp, from.offRecord];
    // Editing a queued message: the new text takes its place in the queue.
    const eq = editingQueuedRef.current;
    if (typed && eq) {
      setEditingQueued(null);
      if (queueRef.current.some((m) => m.id === eq)) {
        setQueue((qq) => editQueued(qq, eq, question));
        setQuestion('');
        pumpRef.current();
        return;
      }
    }
    // Sent while answering: queued, answered in turn.
    if (busyRef.current) {
      const text = typed ? question : (spoken ?? '');
      if (!text.trim() || again || from) return;
      if (typed) {
        setQuestion('');
        if (editingRef.current) setEditing(null);
      }
      const barged = !typed && bargedRef.current;
      bargedRef.current = false;
      const at = Date.now();
      queueMessage(
        { id: `q${at}`, text, at, spoken: !typed, followUp, offRecord: offRecordNow },
        barged,
      );
      return;
    }
    // A screenshot from the assist key is for questions asked soon after, not ones much later.
    const att = attachmentRef.current;
    const grab = !att && screen && Date.now() - screen.at < SCREEN_TTL_MS ? screen : null;
    if (screen && !grab) setScreen(null);
    const q =
      (from?.text ?? again?.text ?? spoken ?? question).trim() ||
      (att ? 'Summarise this.' : '') ||
      (grab
        ? grab.shared
          ? SHARED_QUESTION
          : SCREEN_QUESTION
        : cameraOn
          ? DEFAULT_PHOTO_QUESTION
          : '');
    if (!q) return;
    // Edit (the typed question sent from the box) or Try again: replaces the last exchange, if
    // it still is the last one. Anything else asked meanwhile ends the edit.
    const target = again?.replace ?? (typed ? editingRef.current : null);
    const replace =
      target && !offRecordNow && lastExchange(messagesRef.current)?.reply.id === target.reply.id
        ? target
        : null;
    if (editingRef.current) setEditing(null);
    // iPhone: no live camera to look through (ADR 0006). "What am I looking at?" with the camera
    // closed opens it instead of asking the model blind; the next send takes the photo.
    if (onIphone() && !grab && !cameraOn && wantsCameraNow(q)) {
      const at = Date.now();
      const allowed = permission?.granted || (await requestPermission()).granted;
      if (allowed) setUseCamera(true);
      setQuestion(q === DEFAULT_PHOTO_QUESTION ? '' : q);
      setMessages((m) => [
        ...m,
        { id: `u${at}`, role: 'user', text: q, at, spoken: voiced },
        {
          id: `a${at}`,
          role: 'assistant',
          text: allowed ? IPHONE.cameraOpened : IPHONE.takePhotoFirst,
          at,
        },
      ]);
      if (!allowed) setStatus('Camera permission is needed.');
      return;
    }
    if (typed) setQuestion('');
    busyRef.current = true;
    bargedRef.current = false;
    stopReasonRef.current = null;
    answerOver();
    // Questions a Send now stopped before their answer began: answered together with this one.
    const owed = owedRef.current;
    owedRef.current = [];
    const modelQ = withOwed(owed, q);
    let written = '';
    holdBackground();
    awaitingVoiceRef.current = false;
    const keepHistory = conversation.current.keepHistory(followUp, Date.now());
    await yieldToQuestion();
    const at = Date.now();
    const userId = `u${at}`;
    const replyId = `a${at}`;
    lastReplyRef.current = replyId;
    if (replace) {
      // Out of the model's chat, the saved chat and memory before it is asked again.
      await forgetLastExchange(replace.reply.text, replace.reply.momentId).catch((e) =>
        console.log(`[chat] forgetting the last exchange failed: ${String(e)}`),
      );
      setMessages((m) => withoutExchange(m, replace));
    }
    const routine = routineRef.current;
    routineRef.current = null;
    setMessages((m) => [
      ...m,
      {
        id: userId,
        role: 'user',
        text: routine?.label ?? q,
        at,
        spoken: voiced,
        offRecord: offRecordNow,
      },
      { id: replyId, role: 'assistant', text: '', at, pending: true, offRecord: offRecordNow },
    ]);
    setPhase('thinking');
    speaker.current?.stop();
    const hf = handsFreeOn();
    const speak =
      shouldSpeak({
        spoken: voiced || hf,
        headphones: headphonesOn(),
        enabled: getSettings().speakAnswers || hf,
      }) && canSpeakNow();
    const sp = new StreamingSpeaker(speak);
    speaker.current = sp;
    setSpeakingId(speak ? replyId : null);
    setErrorDetails(null);
    let tick: ReturnType<typeof setInterval> | undefined;
    try {
      await Promise.all([
        stopFactInference(),
        stopFollowupInference(),
        stopNameInference(),
        stopConversationNotes(),
        stopTranslateHeard(),
      ]);
      let imagePath: string | null = null;
      const visible = AppState.currentState === 'active';
      if (grab) imagePath = grab.shot;
      else if (
        !att &&
        cameraOn &&
        visible &&
        (q === DEFAULT_PHOTO_QUESTION || asksAboutWhatIsInView(q))
      ) {
        const pic = await camera.current?.takePictureAsync({ quality: 0.6, shutterSound: false });
        imagePath = stripFile(pic?.uri);
      }
      if (imagePath) {
        const shown: ChatMedia[] = [{ momentAt: at, kind: 'photo', path: imagePath }];
        setMessages((m) => patchMessage(m, userId, { media: shown }));
      }
      let answered = false;
      let webOffered = false;
      let shownFinal = false;
      // A slow step counts its seconds; nothing new for STALL_MS and the chat stops waiting
      // (answer-watch.ts).
      const watch = new AnswerWatch(Date.now());
      let gaveUp = false;
      const showStep = (line: string) => {
        if (answered || gaveUp) return;
        watch.step(line, Date.now());
        setStatus(line);
      };
      showStep(imagePath ? 'Looking…' : 'Thinking…');
      let giveUp: (r: 'stalled') => void = () => {};
      const stalled = new Promise<'stalled'>((res) => (giveUp = res));
      tick = setInterval(() => {
        const now = Date.now();
        if (watch.stalled(now)) giveUp('stalled');
        else if (!answered && !gaveUp) setStatus(watch.line(now));
      }, 1000);
      // offTheRecord: uses all memories, saves nothing (assistant.ts).
      const opts = {
        keepHistory,
        offTheRecord: offRecordNow,
        spoken: voiced,
        // Progress as it happens, until the first words of the answer replace it.
        onStatus: showStep,
        onFound: (media: ChatMedia[]) => setMessages((m) => patchMessage(m, replyId, { media })),
        routine: !!routine,
        voiceAnswer: speak,
        // Lookup off and the answer couldn't give the facts: the browser link, under it.
        onWebOffer: () => {
          webOffered = true;
          if (shownFinal && !imagePath && !grab)
            setMessages((m) => patchMessage(m, replyId, { webAsk: { question: q } }));
        },
      } as Parameters<typeof answerQuestion>[3];
      holdLiveCamera(true);
      const onAnswerText = (full: string) => {
        if (gaveUp) return;
        watch.alive(Date.now());
        if (!answered) setStatus('');
        answered = true;
        written = full;
        setPhase('answering');
        setMessages((m) => patchMessage(m, replyId, { text: full }));
        sp.update(full);
      };
      const aboutFile = (a: Attachment): Promise<Awaited<ReturnType<typeof answerQuestion>>> =>
        answerShared(a, modelQ, onAnswerText, showStep, offRecordNow).then((x) => {
          // A web page read once is kept for the next question about it; so are a video's
          // pictures once looked at, and a column added to a sheet.
          const page = x.page && a.kind === 'page' ? { text: x.page.text, name: x.page.title } : {};
          if (x.page || x.update)
            setAttachment((c) => (c?.at === a.at ? { ...c, ...page, ...x.update } : c));
          return { ...x, usedPhoto: null, sources: [], ttftMs: 0, local: true };
        });
      // With a file attached the model still sorts the request first: "turn off spoken answers"
      // changes the setting instead of being answered about the file.
      const answering: Promise<Awaited<ReturnType<typeof answerQuestion>>> = att
        ? answerQuestion(modelQ, null, onAnswerText, { ...opts, attached: true }).then((r) =>
            r.notTool ? aboutFile(att) : r,
          )
        : answerQuestion(
            grab ? screenQuestion(modelQ, grab) : modelQ,
            imagePath,
            onAnswerText,
            opts,
          );
      const first = await Promise.race([answering, stalled]);
      watch.finish();
      if (first === 'stalled') {
        // Nothing happened for minutes: stop it and say so, instead of a line that never ends.
        gaveUp = true;
        answering.catch(() => {});
        stopResearch();
        stopPicture();
        cancelLlm();
        const waitedOn = watch.status;
        console.log(`[ask] no progress for ${STALL_MS / 1000} s (${waitedOn}); stopped`);
        setMessages((m) =>
          patchMessage(m, replyId, {
            text: imagePath ? STALLED_PHOTO_TEXT : STALLED_TEXT,
            pending: false,
          }),
        );
        setStatus('');
        const stall = Object.assign(new Error(`No progress for ${STALL_MS / 1000} s`), {
          code: 'answer-timeout',
        });
        setErrorDetails(() => () => errorDetailsFor(imagePath ? 'photo answer' : 'answer', stall));
        return;
      }
      const r = first;
      written = r.text;
      const stopped = stopReasonRef.current ? true : undefined;
      // Android's voice says when it has finished (onVoiceIdle); background passes wait for that.
      // A read-back is always said (it asks "Send it?"), even when answers aren't spoken.
      const readBack = !!r.readBackId;
      awaitingVoiceRef.current =
        (speak || readBack) && Platform.OS === 'android' && r.text.trim().length > 0;
      readBackRef.current = readBack && Platform.OS === 'android' ? r.readBackId! : null;
      if (!awaitingVoiceRef.current) setSpeakingId(null);
      if (readBack && !speak) {
        const rb = new StreamingSpeaker(true);
        speaker.current = rb;
        if (awaitingVoiceRef.current) setSpeakingId(replyId);
        rb.finish(r.text);
      } else sp.finish(r.text);
      setWebUsed((r.web ?? []).length > 0);
      setMessages((m) =>
        patchMessage(m, replyId, {
          text: r.text,
          pending: false,
          web: r.web ?? [],
          webAsk: r.browserQuery
            ? { question: q, query: r.browserQuery }
            : (r.webLink || webOffered) && !imagePath && !grab
              ? { question: q, query: r.webQuery }
              : { question: '' },
          media: mediaForAnswer(r as typeof r & { media?: ChatMedia[] }),
          draftId: r.draftId,
          textResult: att?.kind === 'selection' || undefined,
          momentId: r.momentId,
          picture: r.picture,
          link: r.link,
          stopped,
        }),
      );
      shownFinal = true;
      if (r.momentId != null) setMessages((m) => patchMessage(m, userId, { momentId: r.momentId }));
      if (!speak) conversation.current.answered(Date.now());
      setStatus('');
      const src = r.sources.length ? ` · ${r.sources.length} memories` : '';
      console.log(`[ask] ${imagePath ? 'photo' : 'text'} ${r.ms} ms ttft ${r.ttftMs} ms${src}`);
    } catch (e) {
      setSpeakingId(null);
      const stopped = stopReasonRef.current ? true : undefined;
      setMessages((m) => patchMessage(m, replyId, { pending: false, stopped }));
      console.log(`[ask] ${stopped ? 'stopped' : 'failed'}: ${String(e)}`);
      // Stopped (Stop, Send now, talking over it): the cancelled pass is no failure to report.
      if (stopped) return;
      setStatus(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`);
      setErrorDetails(() => () => errorDetailsFor('answer', e));
    } finally {
      if (tick) clearInterval(tick);
      holdLiveCamera(false);
      owedRef.current = unansweredAfter(owed, {
        question: q,
        text: written,
        stopped: stopReasonRef.current,
      });
      stopReasonRef.current = null;
      answerOver();
      busyRef.current = false;
      // Spoken answers release on onVoiceIdle; nothing spoken (or an error) releases now.
      if (!awaitingVoiceRef.current) releaseBackground();
      setPhase('idle');
      setTimeout(() => pumpRef.current(), 0);
    }
  };

  /**
   * Nothing was asked after talking over the answer (the words were cut off or not heard): the
   * chat says so plainly, instead of an empty stopped answer and no reply. Questions it stopped
   * before a word stay owed and are answered with the next one.
   */
  const bargeQuiet = () => {
    const wait = bargeWaitRef.current;
    bargeWaitRef.current = null;
    if (!wait || busyRef.current || queueRef.current.length) return;
    console.log(
      `[ask] barge-in: no question heard within ${BARGE_WAIT_MS / 1000} s; ${owedRef.current.length} owed`,
    );
    setMessages((m) => quietAfterBargeIn(m, wait.replyId, Date.now()));
    setStatus('');
  };

  /** Idle: the next queued message is answered (one being edited waits). */
  const pump = () => {
    if (busyRef.current) return;
    const { next, rest } = takeNext(queueRef.current, editingQueuedRef.current);
    if (!next) return;
    setQueue(() => rest);
    void ask(undefined, next.followUp, next.offRecord, undefined, next);
  };

  /** Send now on a queued message (with the box's text, if it was being edited). */
  const sendQueuedNow = (id: string) => {
    if (editingQueuedRef.current === id) {
      setQueue((qq) => editQueued(qq, id, question));
      setQuestion('');
      setEditingQueued(null);
    }
    if (!queueRef.current.some((m) => m.id === id)) return;
    setQueue((qq) => toFront(qq, id));
    if (busyRef.current) stop('now');
    else pump();
  };

  const editQueuedMessage = (id: string) => {
    const m = queueRef.current.find((x) => x.id === id);
    if (!m) return;
    if (editingRef.current) setEditing(null);
    setQuestion(m.text);
    setEditingQueued(id);
  };

  const removeQueued = (id: string) => {
    setQueue((qq) => withoutQueued(qq, id));
    if (editingQueuedRef.current === id) {
      setEditingQueued(null);
      setQuestion('');
    }
  };

  /** Long-press send: while answering, Send now; otherwise Off the record. */
  const sendLong = () => {
    if (!busyRef.current || phase === 'loading') {
      setOffRecord(true);
      return void ask(undefined, false, true);
    }
    const text = question.trim();
    if (!text) return;
    setQuestion('');
    if (editingRef.current) setEditing(null);
    setEditingQueued(null);
    const at = Date.now();
    queueMessage(
      { id: `q${at}`, text, at, spoken: false, followUp: false, offRecord: offRecordRef.current },
      true,
    );
  };
  // Long-press on a message: Edit, Try again (last exchange only) or Read aloud.
  const onMessageAction = (m: ChatMessage, action: MessageAction) => {
    if (busyRef.current) return;
    if (action === 'read') {
      speaker.current?.stop();
      const sp = new StreamingSpeaker(true);
      speaker.current = sp;
      // Android says when the voice is done (onVoiceIdle clears the mute button).
      setSpeakingId(Platform.OS === 'android' ? m.id : null);
      sp.finish(m.text);
      return;
    }
    const x = lastExchange(messagesRef.current);
    if (!x || (x.question.id !== m.id && x.reply.id !== m.id)) return;
    if (action === 'edit') {
      setQuestion(x.question.text);
      setEditing(x);
      return;
    }
    const spokenText = x.question.spoken ? x.question.text : undefined;
    void ask(spokenText, false, offRecordRef.current, { text: x.question.text, replace: x });
  };
  const actionRef = useRef(onMessageAction);
  const messageAction = useCallback(
    (m: ChatMessage, a: MessageAction) => actionRef.current(m, a),
    [],
  );
  const redoable = useMemo(() => (busy ? null : lastExchange(messages)), [busy, messages]);

  useEffect(() => {
    actionRef.current = onMessageAction;
    askRef.current = (q: string, followUp?: boolean) => void ask(q, followUp);
    routineAskRef.current = (q: string) => ask(q);
    holdEndRef.current = () => void holdEnd();
    holdStartRef.current = (free, maxMs) => void holdStart(free, maxMs);
    pumpRef.current = pump;
    stopRef.current = stop;
    bargeQuietRef.current = bargeQuiet;
  });

  // Capture from the widget: one photo, no voice note; the camera closes again after.
  const quickCapture = async () => {
    if (!cameraOn) {
      setStatus('Allow the camera to capture.');
      return;
    }
    if (notSaved()) return;
    try {
      const at = Date.now();
      const pic = await camera.current?.takePictureAsync({ quality: 0.8, shutterSound: false });
      const path = stripFile(pic?.uri);
      if (!path) throw new Error('no photo');
      await capturePhoto(path, null, at);
      setStatus('Saved photo');
    } catch (e) {
      setStatus(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUseCamera(false);
      setCameraReady(false);
    }
  };

  const saveScreen = async () => {
    if (notSaved()) return;
    if (!screen?.shot) {
      setStatus('No screenshot to save (the app on screen may block them).');
      return;
    }
    try {
      await capturePhoto(screen.shot, screenNote(screen.text), screen.at);
      setStatus('Saved screenshot');
    } catch (e) {
      setStatus(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  useEntry(
    entry,
    (kind) => entryReady(kind, { idle: !busy && !busyRef.current, cameraOn, cameraReady }),
    (e) => {
      // App icon shortcuts: live camera, Listen on.
      if (e.kind === 'camera') return void (live ? undefined : toggleLive());
      if (e.kind === 'listenmode') return void (listening ? undefined : toggleListening());
      // iPhone App Intents: a question from Siri or Shortcuts, or "What am I looking at?" (on
      // iPhone that opens the camera; the next send takes the photo).
      if (e.kind === 'ask') return void (e.text ? ask(e.text) : undefined);
      if (e.kind === 'look') return void ask(DEFAULT_PHOTO_QUESTION);
      if (e.kind === 'capture') {
        // Stays open (the entry is cleared next) until the photo is saved.
        setUseCamera(true);
        return void quickCapture();
      }
      if (e.kind === 'screen') {
        const grab = parseScreenGrab(SidekickNative.kvGet(ASSIST_KEY));
        SidekickNative.kvSet(ASSIST_KEY, null);
        if (!grab) {
          setStatus("Couldn't read the screen (the app on screen may block it).");
          return;
        }
        setScreen(grab);
      }
      void holdStart(true);
    },
    onEntryHandled,
  );

  const mute = () => {
    speaker.current?.stop();
    setSpeakingId(null);
    conversation.current.answered(Date.now());
    if (awaitingVoiceRef.current) {
      awaitingVoiceRef.current = false;
      if (!busyRef.current) releaseBackground();
    }
  };

  // Messages and notices in time order: a notice sits where it happened.
  const items = useMemo(
    () =>
      [
        ...messages.map((m) => ({ at: m.at, key: m.id, m })),
        ...noticeList.map((n) => ({ at: n.at, key: `n:${n.key}`, n })),
      ].sort((a, b) => a.at - b.at),
    [messages, noticeList],
  );

  const placeholder = attachment
    ? 'Ask about it'
    : screen
      ? screen.shared
        ? SHARED_QUESTION
        : SCREEN_QUESTION
      : cameraOn
        ? DEFAULT_PHOTO_QUESTION
        : 'Ask Sidekick';

  return (
    <ForceScheme scheme={dark ? 'dark' : 'light'}>
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.bg }]}>
        {focused ? <StatusBar style={dark ? 'light' : 'dark'} /> : null}
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <ChatHeader
            theme={theme}
            offRecord={offRecord}
            onOffRecord={setOffRecord}
            listening={listening}
            onListen={() => void toggleListening()}
            webUsed={webUsed}
            live={live}
            onStopLive={stopLiveCamera}
          />

          <ScrollView
            ref={scroll}
            style={styles.flex}
            contentContainerStyle={styles.chat}
            onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
            keyboardShouldPersistTaps="handled"
          >
            {items.length === 0 && phase !== 'loading' ? (
              <AppText style={[styles.empty, { color: theme.faint }]}>
                {offRecord ? 'Nothing you say here is saved.' : 'Ask anything, or tap the camera.'}
              </AppText>
            ) : null}
            {items.map((it) =>
              'm' in it && it.m ? (
                <View key={it.key}>
                  <MessageBubble
                    m={it.m}
                    theme={theme}
                    speaking={speakingId === it.m.id}
                    onMute={speakingId === it.m.id ? mute : undefined}
                    redo={redoable?.question.id === it.m.id || redoable?.reply.id === it.m.id}
                    onAction={messageAction}
                  />
                  {it.m.draftId ? <DraftCard id={it.m.draftId} theme={theme} /> : null}
                  {it.m.textResult && !it.m.pending && it.m.text ? (
                    <TextResultActions
                      text={it.m.text}
                      canReplace={!!attachment?.replaceable}
                      onReplace={() => replaceInApp(it.m.text)}
                    />
                  ) : null}
                </View>
              ) : 'n' in it && it.n ? (
                <NoticeItem key={it.key} n={it.n} theme={theme} />
              ) : null,
            )}
            <QueuedMessages
              queue={queue}
              theme={theme}
              editingId={editingQueued}
              onSendNow={sendQueuedNow}
              onEdit={editQueuedMessage}
              onRemove={removeQueued}
            />
            {status ? (
              <AppText variant="bodySmall" style={[styles.status, { color: theme.faint }]}>
                {status}
              </AppText>
            ) : null}
            {errorDetails && phase === 'idle' ? (
              <View style={styles.errorDetails}>
                <ErrorDetailsButton details={errorDetails} />
              </View>
            ) : null}
          </ScrollView>

          {attachment ? (
            <AttachmentBar
              attachment={attachment}
              busy={phase !== 'idle'}
              onAsk={(q) => void ask(q)}
              onClose={closeAttachment}
              onSave={() =>
                void shareSheet(attachment).catch((e) => {
                  console.log(`[sheet] save failed: ${String(e)}`);
                  setStatus("Couldn't save the sheet.");
                })
              }
            />
          ) : screen ? (
            <ScreenGrabBar grab={screen} onSave={saveScreen} onClose={() => setScreen(null)} />
          ) : null}

          <LiveConversation listening={listening} />

          {cameraOn ? (
            <View style={styles.cameraBox}>
              {live ? (
                <LiveFrame />
              ) : (
                <CameraView
                  ref={camera}
                  style={styles.flex}
                  facing="back"
                  onCameraReady={() => setCameraReady(true)}
                />
              )}
              {/* Live camera memory films in the background: Android only (ADR 0006). */}
              {Platform.OS !== 'ios' && (
                <Tappable
                  feedback="dim"
                  style={[styles.liveToggle, live && styles.liveToggleOn]}
                  onPress={() => void toggleLive()}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: live }}
                  accessibilityLabel="Live camera memory"
                  hitSlop={12}
                >
                  {live ? <View style={styles.liveDot} /> : null}
                  <AppText variant="badge" tone="onMedia">
                    Live
                  </AppText>
                </Tappable>
              )}
              <IconButton
                name="close"
                size={22}
                color={MEDIA.onMedia}
                style={styles.cameraClose}
                onPress={() => void toggleCamera()}
                accessibilityLabel="Close camera"
              />
              {live ? null : (
                <Tappable
                  feedback="dim"
                  hitSlop={0}
                  style={[styles.shutter, capturing && styles.shutterOn]}
                  onPressIn={captureStart}
                  onPressOut={captureEnd}
                  accessibilityRole="button"
                  accessibilityLabel="Capture photo, hold to add a voice note"
                />
              )}
            </View>
          ) : null}

          {editingQueued ? (
            <View style={styles.editing}>
              <AppText variant="bodySmall" style={[styles.flex, { color: theme.faint }]}>
                Editing a queued message: it waits until you send.
              </AppText>
              <TextButton
                title="Cancel"
                onPress={() => {
                  setEditingQueued(null);
                  setQuestion('');
                  pump();
                }}
              />
            </View>
          ) : editing ? (
            <View style={styles.editing}>
              <AppText variant="bodySmall" style={[styles.flex, { color: theme.faint }]}>
                Editing your last question: sending replaces it and its answer.
              </AppText>
              <TextButton
                title="Cancel"
                onPress={() => {
                  setEditing(null);
                  setQuestion('');
                }}
              />
            </View>
          ) : null}

          <Composer
            theme={theme}
            value={question}
            onChange={setQuestion}
            placeholder={placeholder}
            onSend={() => void ask()}
            onSendLong={sendLong}
            answering={phase === 'thinking' || phase === 'answering'}
            onStop={() => stop()}
            micOn={holding}
            onMicIn={micIn}
            onMicOut={micOut}
            cameraOn={cameraOn}
            onCamera={() => void toggleCamera()}
            onAttach={attachFile}
            large={handsFreeMode}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ForceScheme>
  );
}

const MEDIA = DARK_COLORS;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chat: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    gap: space.lg,
  },
  empty: { textAlign: 'center', marginTop: space.xxxl },
  editing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  status: { textAlign: 'center' },
  errorDetails: { alignItems: 'center' },
  // Shrinks (not overflows) when the keyboard takes space, so the composer stays above it.
  cameraBox: {
    height: '34%',
    flexShrink: 1,
    minHeight: 72,
    marginHorizontal: space.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  cameraClose: {
    position: 'absolute',
    top: space.xs,
    right: space.xs,
    backgroundColor: MEDIA.mediaScrim,
    borderRadius: radius.full,
  },
  shutter: {
    position: 'absolute',
    bottom: space.md,
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 4,
    borderColor: MEDIA.onMedia,
    backgroundColor: MEDIA.mediaScrim,
  },
  shutterOn: { backgroundColor: MEDIA.recording },
  liveToggle: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: MEDIA.mediaScrim,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  liveToggleOn: { backgroundColor: MEDIA.recording },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: MEDIA.onMedia },
});
