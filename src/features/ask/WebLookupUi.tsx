import { useNetworkState } from 'expo-network';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { getSettings, onSettingsChange, updateSettings } from '@/engine/settings';
import { browserSearchQuery, type WebSource } from '@/web/lookup';

/**
 * Online/Offline button: tap to turn online lookup on or off (off by default). Shows "Offline"
 * whenever the phone has no internet (airplane mode, no signal), whatever the setting.
 */
export function onlineLabel(enabled: boolean, connected: boolean): 'Online' | 'Offline' {
  return enabled && connected ? 'Online' : 'Offline';
}

export function OnlineBadge({ used }: { used: boolean }) {
  const [enabled, setEnabled] = useState(getSettings().webLookup);
  useEffect(() => onSettingsChange((s) => setEnabled(s.webLookup)), []);
  const net = useNetworkState();
  const connected = net.isConnected !== false && net.isInternetReachable !== false;
  const label = onlineLabel(enabled, connected);
  const online = label === 'Online';
  return (
    <Pressable
      onPress={() => updateSettings({ webLookup: !enabled })}
      hitSlop={8}
      style={[styles.badge, online && styles.on, online && used && styles.used]}
      accessibilityRole="switch"
      accessibilityState={{ checked: enabled }}
      accessibilityLabel={
        online
          ? 'Online: questions may be looked up on Wikipedia and DuckDuckGo. Tap to go offline.'
          : enabled
            ? 'Offline: no internet. Answers come only from this phone.'
            : 'Offline: answers come only from this phone. Tap to allow online lookup.'
      }
    >
      <Text style={[styles.badgeText, online && styles.onText]}>
        {!online && enabled ? 'Offline · no internet' : label}
      </Text>
    </Pressable>
  );
}

/** "Source: GDELT — Headline · reuters.com · 2026-11-23". */
export function sourceLabel(s: WebSource): string {
  const extra = [s.domain, s.date].filter(Boolean).join(' · ');
  return `Source: ${s.name} — ${s.title}${extra ? ` · ${extra}` : ''}${s.licence ? ` (${s.licence})` : ''}`;
}

/** Links to the pages an answer used, with their licence (Wikipedia: CC BY-SA 4.0). */
export function WebSources({ sources }: { sources: WebSource[] }) {
  if (!sources.length) return null;
  return (
    <View style={styles.sources}>
      {sources.map((s) => (
        <Text
          key={s.url || s.title}
          style={styles.source}
          accessibilityRole="link"
          onPress={s.url ? () => void Linking.openURL(s.url).catch(() => {}) : undefined}
        >
          {sourceLabel(s)}
        </Text>
      ))}
    </View>
  );
}

/**
 * Full web results for free: opens the phone's browser with search words for the question
 * (nothing is sent until the user taps). Uses the lookup's words if one ran; otherwise they are
 * worked out on tap (Gemma, ≤1.5 s, else the rules), so the answer is never delayed. Known names
 * are taken out either way. No free, key-less web search API exists for apps (see ADR 6).
 */
export function WebSearchLink({
  question,
  query,
  getQuery = browserSearchQuery,
  open = (url: string) => Linking.openURL(url),
}: {
  question: string;
  query?: string;
  getQuery?: (question: string) => Promise<string>;
  open?: (url: string) => Promise<unknown>;
}) {
  const [opening, setOpening] = useState(false);
  if (!question.trim()) return null;
  const onPress = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const q = (query?.trim() || (await getQuery(question).catch(() => ''))).trim();
      if (q) await open(`https://duckduckgo.com/?q=${encodeURIComponent(q)}`).catch(() => {});
    } finally {
      setOpening(false);
    }
  };
  return (
    <Text style={styles.source} accessibilityRole="link" onPress={() => void onPress()}>
      {opening ? 'Opening the browser…' : 'Search the web in your browser'}
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#eee',
  },
  on: { backgroundColor: '#2f6fed' },
  badgeText: { fontSize: 12, color: '#555', fontWeight: '600' },
  onText: { color: '#fff' },
  used: { borderWidth: 2, borderColor: '#9db8f5' },
  sources: { gap: 4, marginTop: 8 },
  source: { fontSize: 13, color: '#2f6fed' },
});
