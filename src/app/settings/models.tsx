import { useEffect, useState } from 'react';

import SidekickNative from '../../../modules/sidekick-native';
import { AppText, OptionItem, Page, Section } from '@/ui';
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
    <Page title="Model">
      {line ? <AppText tone="primary">{line}</AppText> : null}
      <Section title="Recommended">
        <Option
          title={`Recommended for this phone: ${catalogModel(rec).label}`}
          hint="Changes by itself if a better model for this phone comes out"
          on={choice === 'recommended'}
          onPress={() => pick('recommended')}
        />
      </Section>
      <Section title="Choose a model">
        {availableModels(d).map((m) => (
          <Option
            key={m.id}
            title={`${m.label}${m.id === active ? ' · in use' : ''}`}
            hint={`${m.summary} ${formatGB(bytesFor(m.id, d.soc))}. ${speedNote(m.id, tps)}.`}
            on={choice === m.id}
            onPress={() => pick(m.id)}
          />
        ))}
      </Section>
      <Section title="Model updates">
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
      </Section>
      <AppText variant="bodySmall" tone="muted">
        Models are downloaded once and then run on this phone with no internet. A switch only
        happens after the new model has been checked; the old one is deleted once the new one works.
      </AppText>
    </Page>
  );
}

function Option(p: { title: string; hint: string; on: boolean; onPress: () => void }) {
  return <OptionItem label={p.title} supporting={p.hint} selected={p.on} onPress={p.onPress} />;
}
