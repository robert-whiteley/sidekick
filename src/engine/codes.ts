import * as Clipboard from 'expo-clipboard';
import { Linking, Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import {
  type CodeButton,
  type CodeContent,
  copyText,
  describeCode,
  parseCode,
  type ScannedCode,
} from './codes-logic';
import { notices } from './notices';

/**
 * QR codes and barcodes: read on the phone (ZXing, native) from a photo or the latest camera
 * frame; the result goes in the chat as a card. Nothing is opened, joined or saved without a tap.
 */

/** The codes in a JPEG; empty when none, or on phones without the scanner. */
export async function scanCodes(path: string): Promise<CodeContent[]> {
  if (Platform.OS !== 'android' || !SidekickNative.scanCodes) return [];
  try {
    const list = JSON.parse(
      await SidekickNative.scanCodes(path.replace(/^file:\/\//, '')),
    ) as ScannedCode[];
    return list.map(parseCode);
  } catch {
    return [];
  }
}

const LABELS: Record<CodeButton, string> = {
  open: 'Open link',
  wifi: 'Join Wi-Fi',
  contact: 'Add contact',
  call: 'Call',
  email: 'Email',
  copy: 'Copy',
};

/** Shows a card for each code with its buttons (Open link etc. only run on tap). */
export function postCodeCards(codes: CodeContent[], now = Date.now()) {
  codes.slice(0, 3).forEach((c, i) => {
    const { text, buttons } = describeCode(c);
    notices.post(
      {
        key: `code:${now}:${i}`,
        kind: 'decision',
        text,
        actions: buttons.map((b) => ({ id: b, label: LABELS[b] })),
      },
      (id) => void runCodeAction(c, id as CodeButton),
    );
  });
}

export async function runCodeAction(c: CodeContent, b: CodeButton): Promise<void> {
  switch (b) {
    case 'open':
      if (c.kind === 'url') await Linking.openURL(c.url).catch(() => {});
      return;
    case 'copy':
      await Clipboard.setStringAsync(copyText(c));
      return;
    case 'call':
      if (c.kind === 'phone')
        await Linking.openURL(`tel:${c.number.replace(/[^\d+]/g, '')}`).catch(() => {});
      return;
    case 'email':
      if (c.kind === 'email')
        await Linking.openURL(
          `mailto:${c.to}${c.subject ? `?subject=${encodeURIComponent(c.subject)}` : ''}`,
        ).catch(() => {});
      return;
    case 'wifi': {
      if (c.kind !== 'wifi') return;
      const sec = c.security === 'nopass' ? 'OPEN' : c.security === 'SAE' ? 'WPA3' : c.security;
      const shown = SidekickNative.wifiAddNetwork?.(c.ssid, c.password, sec) ?? false;
      if (!shown) {
        // Older Android: copy the password and open Wi-Fi settings to pick the network there.
        if (c.password) await Clipboard.setStringAsync(c.password);
        await Linking.sendIntent('android.settings.WIFI_SETTINGS').catch(() => {});
        notices.post({
          key: 'code:wifi-help',
          kind: 'info',
          text: `Pick "${c.ssid}" in Wi-Fi settings${c.password ? ' and paste the password (copied)' : ''}.`,
        });
      }
      return;
    }
    case 'contact': {
      if (c.kind !== 'contact') return;
      // Loaded on use (as elsewhere): the module needs the native side at import time.
      const Contacts = await import('expo-contacts');
      const parts = c.name.split(' ');
      await Contacts.presentFormAsync(null, {
        contactType: Contacts.ContactTypes.Person,
        name: c.name,
        firstName: parts[0],
        lastName: parts.slice(1).join(' ') || undefined,
        company: c.org,
        phoneNumbers: c.phone ? [{ label: 'mobile', number: c.phone }] : undefined,
        emails: c.email ? [{ label: 'work', email: c.email }] : undefined,
      } as NonNullable<Parameters<typeof Contacts.presentFormAsync>[1]>).catch(() => {});
      return;
    }
  }
}
