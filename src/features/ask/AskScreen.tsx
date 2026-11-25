import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import SidekickNative from '../../../modules/sidekick-native';
import {
  answer as answerQuestion,
  DEFAULT_PHOTO_QUESTION,
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
import { takeIntroMessage } from '@/features/onboarding/after-setup';
import { describeOnePhoto, yieldToQuestion } from '@/engine/describe-photos';
import {
  ASSIST_KEY,
  entryReady,
  type EntryRequest,
  HANDS_FREE_MAX_MS,
  parseScreenGrab,
  SCREEN_QUESTION,
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
import { cancelLlm, ensureLlm, holdBackground, releaseBackground } from '@/engine/llm';
import { readBackDone } from '@/engine/actions';
import { startFollowupNotifications, todaysBriefing } from '@/engine/followup-notify';
import {
  canSpeakNow,
  handsFreeOn,
  haptic,
  hapticsForDrafts,
  noteHeadsetAsk,
  watchIncoming,
} from '@/engine/hands-free';
import { briefingDue } from '@/engine/hands-free-logic';
import { READ_BACK_REPLY_MS } from '@/engine/readback-logic';
import { getSettings, updateSettings } from '@/engine/settings';
import { StreamingSpeaker } from '@/engine/speaker';
import { Conversation } from '@/engine/conversation';
import { asksAboutWhatIsInView } from '@/memory/search-logic';
import { embedWhenIdle } from '@/memory/embed-idle';
import { syncSourcesIfDue } from '@/memory/sources';
import { capturePhoto, ingestJournal, learnOwnerVoice, syncOwnerVoice } from '@/memory/store';
import { loadChatHistory } from './chat-history';
import {
  type ChatMedia,
  type ChatMessage,
  isMicTap,
  mediaForAnswer,
  partialStatus,
  patchMessage,
  shouldSpeak,
  withoutOffRecord,
} from './chat-logic';
import { ChatHeader } from './ChatHeader';
import { LiveFrame } from './LiveFrame';
import { Composer } from './Composer';
import { Icon } from './Icon';
import { LiveConversation } from './LiveConversation';
import { DraftCard } from './DraftCard';
import { MessageBubble } from './MessageBubble';
import { NoticeItem, useNotices } from './NoticeLines';
import { ScreenGrabBar } from './ScreenGrabBar';
import { DARK, LIGHT } from './theme';
import { useEntry } from './useEntry';

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
  const [live, setLive] = useState(liveCameraOn);
  const [useCamera, setUseCamera] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState('');
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
  // Spoken back-and-forth: follow-ups keep the chat; one heard mid-answer waits for it to stop.
  const conversation = useRef(new Conversation());
  const queuedRef = useRef<{ q: string; followUp: boolean } | null>(null);
  const [screen, setScreen] = useState<ScreenGrab | null>(null);
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
  const theme = offRecord ? DARK : LIGHT;

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
      });
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

  // The daily briefing, said on the first open after its time (Settings > Assistant).
  useEffect(() => {
    const check = () => {
      const s = getSettings();
      if (!s.followupDigest || !briefingDue(new Date(), s.digestHour * 60, s.lastBriefingAt))
        return;
      updateSettings({ lastBriefingAt: Date.now() });
      void todaysBriefing()
        .then((text) => {
          if (!text) return;
          const at = Date.now();
          setMessages((m) => [...m, { id: `b${at}`, role: 'assistant', text, at }]);
          if (canSpeakNow() && !busyRef.current)
            new StreamingSpeaker(true).finish(`Here's your day. ${text}`);
        })
        .catch(() => {});
    };
    check();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && check());
    return () => sub.remove();
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
    startFollowupNotifications();
    const subs = [
      SidekickNative.addListener('onWake', () => setStatus('Listening…')),
      // The words so far, live while the user talks; the final text replaces them.
      SidekickNative.addListener('onPartialTranscript', (e) => {
        if (!busyRef.current || e.source === 'question') setStatus(partialStatus(e.text));
      }),
      SidekickNative.addListener('onQuestion', (e) => askRef.current(e.text, e.followUp)),
      SidekickNative.addListener('onBargeIn', () => setStatus('Listening…')),
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
        void describeOnePhoto(busyRef.current);
        // Uses the model only if it is already loaded; a question cancels it.
        if (!busyRef.current) await inferFactsIfIdle();
        if (!busyRef.current) await inferFollowupsIfIdle();
        if (!busyRef.current) await inferNamesIfIdle();
      } catch (e) {
        console.log(`[memory] ingest failed: ${String(e)}`);
      }
    };
    const timer = setInterval(tick, 30_000);
    void tick();
    return () => {
      subs.forEach((s) => s.remove());
      clearInterval(timer);
    };
  }, []);

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

  const holdStart = async (free = false, maxMs = HANDS_FREE_MAX_MS) => {
    if (busyRef.current || handsFree.current) return;
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
    if (busyRef.current) return;
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

  const ask = async (spoken?: string, followUp = false, offRecordNow = offRecordRef.current) => {
    // A screenshot from the assist key is for questions asked soon after, not ones much later.
    const grab = screen && Date.now() - screen.at < SCREEN_TTL_MS ? screen : null;
    if (screen && !grab) setScreen(null);
    const q =
      (spoken ?? question).trim() ||
      (grab ? SCREEN_QUESTION : cameraOn ? DEFAULT_PHOTO_QUESTION : '');
    if (spoken && busyRef.current) {
      // Said over the answer (barge-in): the answer is being cancelled; ask once it has stopped.
      queuedRef.current = { q: spoken, followUp };
      return;
    }
    if (!q || busyRef.current) return;
    busyRef.current = true;
    holdBackground();
    awaitingVoiceRef.current = false;
    const keepHistory = conversation.current.keepHistory(followUp, Date.now());
    await yieldToQuestion();
    const at = Date.now();
    const userId = `u${at}`;
    const replyId = `a${at}`;
    setQuestion('');
    setMessages((m) => [
      ...m,
      {
        id: userId,
        role: 'user',
        text: q,
        at,
        spoken: spoken !== undefined,
        offRecord: offRecordNow,
      },
      { id: replyId, role: 'assistant', text: '', at, pending: true, offRecord: offRecordNow },
    ]);
    setPhase('thinking');
    speaker.current?.stop();
    const hf = handsFreeOn();
    const speak =
      shouldSpeak({
        spoken: spoken !== undefined || hf,
        headphones: headphonesOn(),
        enabled: getSettings().speakAnswers || hf,
      }) && canSpeakNow();
    const sp = new StreamingSpeaker(speak);
    speaker.current = sp;
    setSpeakingId(speak ? replyId : null);
    try {
      await Promise.all([stopFactInference(), stopFollowupInference(), stopNameInference()]);
      let imagePath: string | null = null;
      const visible = AppState.currentState === 'active';
      if (grab) imagePath = grab.shot;
      else if (cameraOn && visible && (q === DEFAULT_PHOTO_QUESTION || asksAboutWhatIsInView(q))) {
        const pic = await camera.current?.takePictureAsync({ quality: 0.6, shutterSound: false });
        imagePath = stripFile(pic?.uri);
      }
      if (imagePath) {
        const shown: ChatMedia[] = [{ momentAt: at, kind: 'photo', path: imagePath }];
        setMessages((m) => patchMessage(m, userId, { media: shown }));
      }
      setStatus(imagePath ? 'Looking…' : 'Thinking…');
      let answered = false;
      // offTheRecord: uses all memories, saves nothing (assistant.ts).
      const opts = {
        keepHistory,
        offTheRecord: offRecordNow,
        spoken: spoken !== undefined,
        // Progress as it happens, until the first words of the answer replace it.
        onStatus: (line: string) => {
          if (!answered) setStatus(line);
        },
        onFound: (media: ChatMedia[]) => setMessages((m) => patchMessage(m, replyId, { media })),
      } as Parameters<typeof answerQuestion>[3];
      holdLiveCamera(true);
      const r = await answerQuestion(
        grab ? screenQuestion(q, grab) : q,
        imagePath,
        (full) => {
          if (!answered) setStatus('');
          answered = true;
          setPhase('answering');
          setMessages((m) => patchMessage(m, replyId, { text: full }));
          sp.update(full);
        },
        opts,
      );
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
          webAsk:
            imagePath || grab || r.local ? { question: '' } : { question: q, query: r.webQuery },
          media: mediaForAnswer(r as typeof r & { media?: ChatMedia[] }),
          draftId: r.draftId,
        }),
      );
      if (!speak) conversation.current.answered(Date.now());
      setStatus('');
      const src = r.sources.length ? ` · ${r.sources.length} memories` : '';
      console.log(`[ask] ${imagePath ? 'photo' : 'text'} ${r.ms} ms ttft ${r.ttftMs} ms${src}`);
    } catch (e) {
      setSpeakingId(null);
      setMessages((m) => patchMessage(m, replyId, { pending: false }));
      setStatus(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      holdLiveCamera(false);
      busyRef.current = false;
      // Spoken answers release on onVoiceIdle; nothing spoken (or an error) releases now.
      if (!awaitingVoiceRef.current) releaseBackground();
      setPhase('idle');
      const next = queuedRef.current;
      queuedRef.current = null;
      if (next) setTimeout(() => askRef.current(next.q, next.followUp), 0);
    }
  };
  useEffect(() => {
    askRef.current = (q: string, followUp?: boolean) => void ask(q, followUp);
    holdEndRef.current = () => void holdEnd();
    holdStartRef.current = (free, maxMs) => void holdStart(free, maxMs);
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

  const stop = () => {
    cancelLlm();
    speaker.current?.stop();
    setSpeakingId(null);
    awaitingVoiceRef.current = false;
    releaseBackground();
  };

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

  const placeholder = screen ? SCREEN_QUESTION : cameraOn ? DEFAULT_PHOTO_QUESTION : 'Ask Sidekick';

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.bg }]}>
      <StatusBar style={offRecord ? 'light' : 'dark'} />
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
            <Text style={[styles.empty, { color: theme.faint }]}>
              {offRecord ? 'Nothing you say here is saved.' : 'Ask anything, or tap the camera.'}
            </Text>
          ) : null}
          {items.map((it) =>
            'm' in it && it.m ? (
              <View key={it.key}>
                <MessageBubble
                  m={it.m}
                  theme={theme}
                  speaking={speakingId === it.m.id}
                  onMute={mute}
                />
                {it.m.draftId ? <DraftCard id={it.m.draftId} theme={theme} /> : null}
              </View>
            ) : 'n' in it && it.n ? (
              <NoticeItem key={it.key} n={it.n} theme={theme} />
            ) : null,
          )}
          {status ? <Text style={[styles.status, { color: theme.faint }]}>{status}</Text> : null}
        </ScrollView>

        {screen ? (
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
            <Pressable
              style={[styles.liveToggle, live && styles.liveToggleOn]}
              onPress={() => void toggleLive()}
              accessibilityRole="switch"
              accessibilityState={{ checked: live }}
              accessibilityLabel="Live camera memory"
              hitSlop={8}
            >
              <Text style={styles.liveText}>{live ? '● Live' : 'Live'}</Text>
            </Pressable>
            <Pressable
              style={styles.cameraClose}
              onPress={() => void toggleCamera()}
              accessibilityRole="button"
              accessibilityLabel="Close camera"
              hitSlop={8}
            >
              <Icon name="close" size={22} color="#fff" />
            </Pressable>
            {live ? null : (
              <Pressable
                style={[styles.shutter, capturing && styles.shutterOn]}
                onPressIn={captureStart}
                onPressOut={captureEnd}
                accessibilityRole="button"
                accessibilityLabel="Capture photo, hold to add a voice note"
              />
            )}
          </View>
        ) : null}

        <Composer
          theme={theme}
          value={question}
          onChange={setQuestion}
          placeholder={placeholder}
          onSend={() => void ask()}
          onSendLong={() => {
            setOffRecord(true);
            void ask(undefined, false, true);
          }}
          busy={busy}
          answering={phase === 'thinking' || phase === 'answering'}
          onStop={stop}
          micOn={holding}
          onMicIn={micIn}
          onMicOut={micOut}
          cameraOn={cameraOn}
          onCamera={() => void toggleCamera()}
          large={handsFreeMode}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chat: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 14 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 15 },
  status: { fontSize: 13, textAlign: 'center' },
  // Shrinks (not overflows) when the keyboard takes space, so the composer stays above it.
  cameraBox: {
    height: '34%',
    flexShrink: 1,
    minHeight: 72,
    marginHorizontal: 12,
    borderRadius: 16,
    overflow: 'hidden',
  },
  cameraClose: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 16,
    padding: 4,
  },
  shutter: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 4,
    borderColor: '#fff',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  shutterOn: { backgroundColor: '#b00020' },
  liveToggle: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  liveToggleOn: { backgroundColor: '#b00020' },
  liveText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
