import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import type { NamedPlace } from '@/engine/location-logic';
import { hasLocationPermission, refreshPlaces } from '@/engine/location-track';
import { askLocationPermission } from '@/engine/places';
import { platformText } from '@/engine/platform-text';
import { getSettings, type Settings, updateSettings } from '@/engine/settings';
import {
  clearTrack,
  deletePlace,
  namedPlaces,
  renamePlace,
  trackSize,
} from '@/memory/places-store';
import { Button, confirm, Row, Section, styles } from './ui';
import { AppText, TextButton, TextField } from '@/ui';

/** Location memory: the switch, the permission, places you named, and deleting the history. */
export function LocationSection() {
  const [s, setS] = useState<Settings>(getSettings());
  const [allowed, setAllowed] = useState(hasLocationPermission());
  const [places, setPlaces] = useState<NamedPlace[]>([]);
  const [count, setCount] = useState(0);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);

  const load = useCallback(() => {
    namedPlaces()
      .then(setPlaces)
      .catch(() => setPlaces([]));
    trackSize()
      .then(setCount)
      .catch(() => setCount(0));
  }, []);
  useEffect(load, [load]);

  const allow = async () => {
    setAllowed(await askLocationPermission().catch(() => false));
  };

  return (
    <Section title="Location">
      <Row
        label="Remember where I was"
        hint={platformText('locationHint')}
        value={s.locationMemory}
        onChange={(v) => setS(updateSettings({ locationMemory: v }))}
      />
      {!allowed ? (
        <>
          <AppText variant="bodySmall" tone="muted">
            Location isn&apos;t allowed for Sidekick yet.
          </AppText>
          <Button title="Allow location" onPress={allow} />
        </>
      ) : null}
      <AppText>Your places</AppText>
      <AppText variant="bodySmall" tone="muted">
        {places.length
          ? 'Named by saying "call this place …" or "this is home".'
          : 'None yet. Say "call this place the gym" or "this is home" where you are.'}
      </AppText>
      {places.map((p) =>
        editing?.id === p.id ? (
          <View key={p.id} style={styles.itemRow}>
            <TextField
              containerStyle={styles.flex}
              value={editing.name}
              onChangeText={(name) => setEditing({ id: p.id, name })}
              onEndEditing={async () => {
                const name = editing.name.trim();
                if (name) await renamePlace(p.id, name);
                setEditing(null);
                refreshPlaces();
                load();
              }}
              autoFocus
              accessibilityLabel={`New name for ${p.name}`}
            />
          </View>
        ) : (
          <View key={p.id} style={styles.itemRow}>
            <AppText style={styles.flex}>{p.name}</AppText>
            <TextButton
              title="Rename"
              onPress={() => setEditing({ id: p.id, name: p.name })}
              accessibilityLabel={`Rename ${p.name}`}
            />
            <TextButton
              title="Delete"
              danger
              accessibilityLabel={`Delete ${p.name}`}
              onPress={async () => {
                await deletePlace(p.id);
                refreshPlaces();
                load();
              }}
            />
          </View>
        ),
      )}
      <AppText variant="bodySmall" tone="muted">
        {count ? `${count} positions kept (same keep period as your memories).` : ''}
      </AppText>
      <Button
        title="Delete location history"
        danger
        onPress={() =>
          confirm(
            'Delete location history?',
            'Deletes every remembered position and the town names on your memories. Your named places stay.',
            async () => {
              await clearTrack();
              load();
            },
          )
        }
      />
    </Section>
  );
}
