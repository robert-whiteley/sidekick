import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { AutoPauseSection } from '@/features/settings/AutoPauseSection';
import { ChipSection } from '@/features/settings/ChipSection';
import { DataSection } from '@/features/settings/DataSection';
import { EntryPointsSection } from '@/features/settings/EntryPointsSection';
import { type Fact, FactsSection } from '@/features/settings/FactsSection';
import { FollowupsSection } from '@/features/settings/FollowupsSection';
import { ListeningSection } from '@/features/settings/ListeningSection';
import { MemorySection } from '@/features/settings/MemorySection';
import { OnlineSection } from '@/features/settings/OnlineSection';
import { PeopleSection, type Person } from '@/features/settings/PeopleSection';
import { RetentionSection } from '@/features/settings/RetentionSection';
import { SourcesSection } from '@/features/settings/SourcesSection';
import { ACCENT } from '@/features/settings/ui';
import { listSpeakers, type Moment, recentMoments, savedFacts } from '@/memory/store';

const PAGE = 50;

export default function SettingsScreen() {
  const [people, setPeople] = useState<Person[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [hasMore, setHasMore] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [p, f, m] = await Promise.all([listSpeakers(), savedFacts(), recentMoments(limit + 1)]);
      setPeople(p);
      setFacts(f);
      setHasMore(m.length > limit);
      setMoments(m.slice(0, limit));
    } catch (e) {
      console.log(`[settings] memory unavailable: ${String(e)}`);
    }
  }, [limit]);

  // Reload whenever the screen is shown again (e.g. back from a person's page).
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const changed = () => void reload();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ListeningSection />
      <EntryPointsSection />
      <AutoPauseSection />
      <RetentionSection onChanged={changed} />
      <PeopleSection people={people} onChanged={changed} />
      <FactsSection facts={facts} onChanged={changed} />
      <FollowupsSection />
      <SourcesSection onChanged={changed} />
      <OnlineSection />
      <MemorySection
        moments={moments}
        hasMore={hasMore}
        onMore={() => setLimit((l) => l + PAGE)}
        onChanged={changed}
      />
      <DataSection onChanged={changed} />
      <ChipSection />
      <Link href="/bench" style={styles.link}>
        Speed test (developer)
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12, paddingBottom: 48 },
  link: { fontSize: 16, color: ACCENT, marginTop: 12 },
});
