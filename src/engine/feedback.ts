/**
 * Feedback by voice or typing ("send feedback: the camera is slow"): an email draft card to the
 * support address with the user's words plus the app version, Android version and phone model
 * (nothing else), sent the usual way (Gmail when connected, else the mail app opens prefilled).
 */
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { feedbackBody } from '@/content/feedback';
import type { Intent } from '@/integrations/parse';

/** The support address from app.json expo.extra.support.email ('' if none). */
export function supportEmail(): string {
  const extra = Constants.expoConfig?.extra as { support?: { email?: string } } | undefined;
  return extra?.support?.email?.trim() ?? '';
}

function deviceInfo() {
  const c = Platform.constants as { Manufacturer?: string; Model?: string; Release?: string };
  const device = [c.Manufacturer, c.Model].filter(Boolean).join(' ') || null;
  const os = Platform.OS === 'android' ? `Android ${c.Release ?? Platform.Version}` : null;
  return { device, os };
}

const FEEDBACK =
  /^(?:please )?(?:(?:send|give|leave|submit|share) (?:some |my |this )?)?(?:feedback|a bug report|a suggestion)(?: (?:to|for) (?:the )?(?:makers|developers?|devs|team|sidekick)(?: of sidekick)?)?(?:\s*(?:[:,-]|that|saying)\s*|\s+)(.+)$/i;
const TELL_MAKERS =
  /^(?:please )?(?:tell|let) (?:the )?(?:makers|developers?|devs|sidekick team)(?: of sidekick)?(?: know)?(?: that)?[:,]?\s+(.+)$/i;
const BUG = /^(?:report (?:a )?(?:bug|problem|issue))\s*(?:[:,-]|that)?\s*(.+)$/i;

/** The feedback text in [q], or null when it isn't a feedback request. */
export function parseFeedback(q: string): string | null {
  const t = q.trim();
  const m = FEEDBACK.exec(t) ?? TELL_MAKERS.exec(t) ?? BUG.exec(t);
  const text = m?.[1]?.trim().replace(/^["“]|["”]$/g, '');
  return text && text.length >= 3 ? text : null;
}

/** The email intent for [text], or null when no support address is set. */
export function feedbackIntent(text: string): Intent | null {
  const to = supportEmail();
  if (!to) return null;
  const body =
    text.trim() +
    feedbackBody({
      version: Application.nativeApplicationVersion,
      build: Application.nativeBuildVersion,
      ...deviceInfo(),
    });
  return { type: 'email', name: to, subject: 'Sidekick feedback', body };
}
