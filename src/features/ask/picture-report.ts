/**
 * "Report" under a picture Sidekick drew (Google Play requires in-app reporting for AI pictures;
 * ADR 0006). Picking a reason opens an email draft to the developer only when the user taps
 * "Email it": they read it, can change it, and send it themselves. Nothing is sent by Sidekick.
 */
import * as Application from 'expo-application';
import { Linking } from 'react-native';

import { supportEmail } from '@/engine/feedback';
import { REPORT_REASONS, reportMailto } from '@/engine/picture-logic';
import { showDialog } from '@/ui';

export function reportPicture(prompt: string) {
  showDialog('Report this picture', 'What is wrong with it?', [
    ...REPORT_REASONS.map((reason) => ({ text: reason, onPress: () => confirm(reason, prompt) })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}

function confirm(reason: string, prompt: string) {
  const to = supportEmail();
  const url = reportMailto(to, {
    reason,
    prompt,
    version: Application.nativeApplicationVersion,
  });
  showDialog(
    'Send the report?',
    'Opens your email app with a draft saying the reason and what was asked for. You can change ' +
      'it before sending; the picture isn’t attached. Reports help make the picture tool safer.',
    [
      { text: 'Email it', onPress: () => void Linking.openURL(url).catch(() => {}) },
      { text: 'Not now', style: 'cancel' },
    ],
  );
}
