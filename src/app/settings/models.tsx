import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import SidekickNative from '../../../modules/sidekick-native';
import {
  availableModels,
  bytesFor,
  catalogModel,
  type ChatChoice,
  formatGB,
  recommendedModel,
  speedNote,
  type UpdatePolicy,
} from '@/engine/model-catalog';
import {
  activeChat,
  chatChoice,
  onUpdateState,
  setChatChoice,
  updateState,
  type UpdateState,
} from '@/engine/model-updates';
import { getSettings, updateSettings } from '@/engine/settings';

const POLICIES: { id: UpdatePolicy; label: string; hint: string }[] = [
  {
    id: 'auto',
    label: 'Automatic (Recommended)',
    hint: 'On Wi-Fi while charging; switches once it works',
  },
  { id: 'ask', label: 'Ask me', hint: 'Asks before downloading a better model' },
  { id: 'off', label: 'Off', hint: 'Keeps the current model' },
];

function stateLine(s: UpdateState): string | null {
  switch (s.phase) {
    case 'downloading':
      return `Downloading ${catalogModel(s.target).label}: ${Math.floor(s.fraction * 100)}%`;
    case 'waiting':
      return `${catalogModel(s.target).label} is available. ${s.why}.`;
    case 'off':
      return `${catalogModel(s.target).label} is available (updates are off).`;
    case 'switching':
      return `${catalogModel(s.target).label} is ready; it takes over next time Sidekick starts.`;
    case 'failed':
      return `Couldn't download ${catalogModel(s.target).label}: ${s.error}`;
    default:
      return null;
  }
}

/** Settings → Assistant → Model: Recommended by default; alternatives with size and speed. */
export default function ModelsScreen() {
  const d = SidekickNative.getDeviceInfo();
  const [choice, setChoice] = useState<ChatChoice>(chatChoice);
  const [policy, setPolicy] = useState<UpdatePolicy>(getSettings().modelUpdates ?? 'auto');
  const [st, setSt] = useState<UpdateState>(updateState);
  useEffect(() => onUpdateState(setSt), []);
  const active = activeChat().id;
  const rec = recommendedModel(d);
  const tps = getSettings().measuredTokPerSec ?? null;

  const pick = (c: ChatChoice) => {
    setChoice(c);
    setChatChoice(c);
  };

  const line = stateLine(st);
  return (
    <>
      <Stack.Screen options={{ title: 'Model' }} />
      <ScrollView contentContainerStyle={styles.page}>
        {line ? <Text style={styles.status}>{line}</Text> : null}
        <Option
          title={`Recommended for this phone: ${catalogModel(rec).label}`}
          hint="Changes by itself if a better model for this phone comes out"
          on={choice === 'recommended'}
          onPress={() => pick('recommended')}
        />
        <Text style={styles.heading}>Choose a model</Text>
        {availableModels(d).map((m) => (
          <Option
            key={m.id}
            title={`${m.label}${m.id === active ? ' · in use' : ''}`}
            hint={`${m.summary} ${formatGB(bytesFor(m.id, d.soc))}. ${speedNote(m.id, tps)}.`}
            on={choice === m.id}
            onPress={() => pick(m.id)}
          />
        ))}
        <Text style={styles.heading}>Model updates</Text>
        {POLICIES.map((p) => (
          <Option
            key={p.id}
            title={p.label}
            hint={p.hint}
            on={policy === p.id}
            onPress={() => {
              setPolicy(p.id);
              updateSettings({ modelUpdates: p.id });
            }}
          />
        ))}
        <Text style={styles.note}>
          Models are downloaded once and then run on this phone with no internet. A switch only
          happens after the new model has been checked; the old one is deleted once the new one
          works.
        </Text>
      </ScrollView>
    </>
  );
}

function Option(p: { title: string; hint: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={p.onPress}
      style={[styles.option, p.on && styles.optionOn]}
      accessibilityRole="radio"
      accessibilityState={{ selected: p.on }}
    >
      <View style={[styles.radio, p.on && styles.radioOn]} />
      <View style={styles.flex}>
        <Text style={styles.title}>{p.title}</Text>
        <Text style={styles.hint}>{p.hint}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 10 },
  status: { fontSize: 15, color: '#2f6fed' },
  heading: { fontSize: 17, fontWeight: '600', marginTop: 14 },
  option: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#f2f2f5',
    alignItems: 'center',
  },
  optionOn: { backgroundColor: '#e6eefc' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#999' },
  radioOn: { borderColor: '#2f6fed', backgroundColor: '#2f6fed' },
  flex: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 14, color: '#555', lineHeight: 19 },
  note: { fontSize: 14, color: '#666', lineHeight: 20, marginTop: 10 },
});
