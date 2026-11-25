import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { SavedSection } from '@/features/memory/SavedSection';
import { TimelineSection } from '@/features/memory/TimelineSection';
import { type Fact, FactsSection } from '@/features/settings/FactsSection';
import { FollowupsSection } from '@/features/settings/FollowupsSection';
import { Page } from '@/features/settings/Page';
import { PeopleSection, type Person } from '@/features/settings/PeopleSection';
import { NavRow, Section } from '@/features/settings/ui';
import { listSpeakers, type Moment, recentMoments, savedFacts } from '@/memory/store';
import { Tabs } from '@/ui';

const TABS = [
  { id: 'you', label: 'You' },
  { id: 'people', label: 'People' },
  { id: 'todos', label: 'To-dos' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'saved', label: 'Saved' },
  { id: 'storage', label: 'Storage' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const PAGE = 50;

/** Everything Sidekick remembers: open with ?tab=people etc. */
export default function MemoryScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(
    TABS.some((t) => t.id === params.tab) ? (params.tab as Tab) : 'you',
  );
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
      console.log(`[memory] unavailable: ${String(e)}`);
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
    <Page title="Memory">
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'you' && <FactsSection facts={facts} onChanged={changed} />}
      {tab === 'people' && <PeopleSection people={people} onChanged={changed} />}
      {tab === 'todos' && <FollowupsSection part="list" />}
      {tab === 'timeline' && (
        <TimelineSection
          moments={moments}
          hasMore={hasMore}
          onMore={() => setLimit((l) => l + PAGE)}
          onChanged={changed}
        />
      )}
      {tab === 'saved' && <SavedSection moments={moments} />}
      {tab === 'storage' && (
        <Section title="Storage">
          <NavRow label="Storage" hint="What uses space and how long it is kept" href="/storage" />
          <NavRow label="Export or delete" hint="In Settings → Privacy" href="/settings/privacy" />
        </Section>
      )}
    </Page>
  );
}
