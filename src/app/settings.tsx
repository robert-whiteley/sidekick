import { Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { ChipSection } from '@/features/settings/ChipSection';
import { DataSection } from '@/features/settings/DataSection';
import { type Fact, FactsSection } from '@/features/settings/FactsSection';
import { ListeningSection } from '@/features/settings/ListeningSection';
import { MemorySection } from '@/features/settings/MemorySection';
import { PeopleSection, type Person } from '@/features/settings/PeopleSection';
import { RetentionSection } from '@/features/settings/RetentionSection';
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

  useEffect(() => {
    // Loading from the database is async; state is set when the queries resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const changed = () => void reload();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ListeningSection />
      <RetentionSection onChanged={changed} />
      <PeopleSection people={people} onChanged={changed} />
      <FactsSection facts={facts} onChanged={changed} />
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
