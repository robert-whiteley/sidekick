import { useNetworkState } from 'expo-network';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { getSettings, onSettingsChange, updateSettings } from '@/engine/settings';
import { browserSearchQuery, type WebSource } from '@/web/lookup';
import { AppText, makeStyles, radius, space, Tappable } from '@/ui';

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
  const st = useStyles();
  return (
    <Tappable
      feedback="dim"
      onPress={() => updateSettings({ webLookup: !enabled })}
      hitSlop={12}
      style={[st.badge, online && st.on, online && used && st.used]}
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
      <AppText variant="badge" style={[st.badgeText, online && st.onText]}>
        {!online && enabled ? 'Offline · no internet' : label}
      </AppText>
    </Tappable>
  );
}

/** "Source: GDELT — Headline · reuters.com · 2026-11-23". */
export function sourceLabel(s: WebSource): string {
  const extra = [s.domain, s.date].filter(Boolean).join(' · ');
  return `Source: ${s.name} — ${s.title}${extra ? ` · ${extra}` : ''}${s.licence ? ` (${s.licence})` : ''}`;
}

/** "Searched the web · 3 sources": says plainly that this answer used the internet. */
export function searchedLabel(count: number): string {
  return `Searched the web · ${count} source${count === 1 ? '' : 's'}`;
}

/** Links to the pages an answer used, with their licence (Wikipedia: CC BY-SA 4.0). */
export function WebSources({ sources }: { sources: WebSource[] }) {
  if (!sources.length) return null;
  return (
    <View style={styles.sources}>
      <AppText variant="bodySmall" tone="muted" accessibilityRole="header">
        {searchedLabel(sources.length)}
      </AppText>
      {sources.map((s) => (
        <Tappable
          key={s.url || s.title}
          feedback="dim"
          hitSlop={4}
          accessibilityRole="link"
          disabled={!s.url}
          onPress={() => void Linking.openURL(s.url).catch(() => {})}
        >
          <AppText variant="bodySmall" tone="primary">
            {sourceLabel(s)}
          </AppText>
        </Tappable>
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
    <Tappable
      feedback="dim"
      style={styles.link}
      accessibilityRole="link"
      onPress={() => void onPress()}
    >
      <AppText variant="bodySmall" tone="primary">
        {opening ? 'Opening the browser…' : 'Search the web in your browser'}
      </AppText>
    </Tappable>
  );
}

const useStyles = makeStyles((c) => ({
  badge: {
    paddingVertical: space.xxs,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    backgroundColor: c.surfaceHigh,
  },
  on: { backgroundColor: c.primary },
  badgeText: { color: c.muted },
  onText: { color: c.onPrimary },
  used: { borderWidth: 2, borderColor: c.primaryContainer },
}));

const styles = StyleSheet.create({
  sources: { gap: space.sm, marginTop: space.sm },
  link: { alignSelf: 'flex-start', paddingVertical: space.xs },
});
