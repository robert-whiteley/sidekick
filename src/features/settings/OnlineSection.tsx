import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { getSettings, onSettingsChange, updateSettings } from '@/engine/settings';
import { normaliseSearxUrl } from '@/web/lookup-logic';
import { MAX_FEEDS, normaliseFeedUrl } from '@/web/news-logic';
import { Button, Row, Section, styles } from './ui';
import { AppText, TextField } from '@/ui';

/** Online lookup: off by default; what is sent and to whom is spelled out here and in PRIVACY.md. */
export function OnlineSection() {
  const [s, setS] = useState(getSettings());
  useEffect(() => onSettingsChange(setS), []);
  const [url, setUrl] = useState(s.searxngUrl);
  const bad = url.trim() !== '' && normaliseSearxUrl(url) === null;
  const [feed, setFeed] = useState('');
  const feedUrl = normaliseFeedUrl(feed);
  const feedBad = feed.trim() !== '' && feedUrl === null;
  const full = s.newsFeeds.length >= MAX_FEEDS;

  const addFeed = () => {
    if (!feedUrl || full) return;
    if (!s.newsFeeds.includes(feedUrl)) updateSettings({ newsFeeds: [...s.newsFeeds, feedUrl] });
    setFeed('');
  };

  return (
    <Section title="Online lookup">
      <Row
        label="Look things up online"
        hint={
          'For general or current facts Sidekick doesn’t know, it can search Wikipedia and ' +
          'DuckDuckGo Instant Answers, and for news GDELT and Wikipedia’s current events. Only a ' +
          'few search words for your question are sent (written on the phone), with the names of ' +
          'people you know taken out. Your memory, photos, voice, location and contacts are never ' +
          'sent. Questions about you, your day or people you know are never looked up. Free, no ' +
          'account. Off: everything stays on the phone.'
        }
        value={s.webLookup}
        onChange={(v) => updateSettings({ webLookup: v })}
      />
      {s.webLookup ? (
        <>
          <AppText variant="bodySmall" tone="muted">
            Optional: your own SearXNG server for full web results (https, with JSON output
            enabled). Your search words are also sent there. Leave empty to not use one.
          </AppText>
          <TextField
            value={url}
            onChangeText={setUrl}
            onEndEditing={() =>
              updateSettings({ searxngUrl: normaliseSearxUrl(url) === null ? '' : url.trim() })
            }
            placeholder="https://searx.example.org"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="SearXNG server address"
          />
          {bad ? (
            <AppText variant="bodySmall" tone="muted">
              Needs a full https:// address; not used.
            </AppText>
          ) : null}

          <AppText variant="bodySmall" tone="muted">
            Optional: news feeds (RSS or Atom, https) to read for news questions. The whole feed is
            downloaded and matched on the phone, so no question words are sent to it. Add only feeds
            whose terms allow your use; none are included.
          </AppText>
          {s.newsFeeds.map((f) => (
            <View key={f} style={styles.row}>
              <AppText variant="bodySmall" tone="muted" style={styles.flex} numberOfLines={1}>
                {f}
              </AppText>
              <Button
                title="Remove"
                danger
                onPress={() => updateSettings({ newsFeeds: s.newsFeeds.filter((x) => x !== f) })}
              />
            </View>
          ))}
          {full ? (
            <AppText variant="bodySmall" tone="muted">
              Up to {MAX_FEEDS} feeds.
            </AppText>
          ) : (
            <>
              <TextField
                value={feed}
                onChangeText={setFeed}
                onSubmitEditing={addFeed}
                placeholder="https://example.org/feed.xml"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel="News feed address"
              />
              {feedBad ? (
                <AppText variant="bodySmall" tone="muted">
                  Needs a full https:// address.
                </AppText>
              ) : feedUrl ? (
                <Button title="Add feed" onPress={addFeed} />
              ) : null}
            </>
          )}
          <AppText variant="bodySmall" tone="muted">
            Wikipedia text is CC BY-SA 4.0; news headlines from GDELT (gdeltproject.org) link to the
            publisher. Each answer links to what it used.
          </AppText>
        </>
      ) : null}
    </Section>
  );
}
