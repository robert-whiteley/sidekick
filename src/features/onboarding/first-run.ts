/**
 * First run with zero taps (docs/PLAN-v2.md "First run"): check space, start the download by
 * itself on Wi-Fi, ask only before using mobile data, then an intro message in the chat and a
 * silent speed check. Pure decisions here (tested); FirstRun.tsx shows them.
 */

export type MobilePref = 'ask' | 'auto' | 'off';

export type FirstRunStep =
  /** Not enough free space: show what's needed and a link to the phone's storage settings. */
  | { step: 'short-space'; shortBy: number }
  /** Downloading (or queued for Wi-Fi when [wifiOnly]); nothing to ask. */
  | { step: 'download'; wifiOnly: boolean }
  /** On mobile data: ask "now on mobile data, or wait for Wi-Fi?" while queued for Wi-Fi. */
  | { step: 'ask-mobile'; wifiOnly: true };

export function firstRunStep(o: {
  neededBytes: number;
  freeBytes: number;
  reserveBytes: number;
  wifi: boolean;
  mobilePref: MobilePref;
  /** The user said "Download now" on the mobile-data card. */
  mobileAllowed: boolean;
}): FirstRunStep {
  const shortBy = o.neededBytes + o.reserveBytes - o.freeBytes;
  if (shortBy > 0) return { step: 'short-space', shortBy };
  if (o.wifi) return { step: 'download', wifiOnly: !o.mobileAllowed && o.mobilePref !== 'auto' };
  if (o.mobileAllowed || o.mobilePref === 'auto') return { step: 'download', wifiOnly: false };
  if (o.mobilePref === 'off') return { step: 'download', wifiOnly: true };
  return { step: 'ask-mobile', wifiOnly: true };
}

export type IntroMessage = { text: string; tries: string[] };

/** The first message in the chat once Sidekick is ready. Tries are tappable questions. */
export function introMessage(): IntroMessage {
  return {
    text:
      "Hi, I'm ready. I run entirely on this phone, so nothing you show me or say leaves it. " +
      'Point the camera at something and ask, or tell me something to remember.',
    tries: ['What am I looking at?', 'Remind me to call Mum at 6', 'What did I do yesterday?'],
  };
}

/** The explainer shown while the download runs, in plain words. */
export const EXPLAINER: { title: string; body: string }[] = [
  {
    title: 'What Sidekick does',
    body: 'An assistant that sees and hears what you do, remembers it, and answers questions about it.',
  },
  {
    title: 'Your data stays on your phone',
    body: 'No account, no cloud. Nothing you say, show or type is sent to anyone.',
  },
  {
    title: 'Works offline',
    body: 'Everything works with no internet, even in airplane mode. Only web search goes online, and only if you turn it on.',
  },
  {
    title: "What it's good at",
    body: "Remembering what you saw and heard, reminders, drafting messages and emails, and telling you about what's in front of you.",
  },
  {
    title: 'Its limits',
    body: "It's a small AI that runs on your phone, so it isn't an expert on deep specifics and can get things wrong. Check anything important.",
  },
];
