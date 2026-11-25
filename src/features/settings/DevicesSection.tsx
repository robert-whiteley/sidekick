import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import {
  type DeviceChoice,
  listInputs,
  listOutputs,
  setAudioOverride,
  setCamera,
  watchDevices,
} from '@/engine/devices';
import { ChoiceRow, Section, styles } from './ui';

/** One row of devices: Recommended is the automatic pick; a tap pins another one. */
function DeviceRow(props: {
  label: string;
  hint: string;
  devices: DeviceChoice[];
  onChange: (key: string | null) => void;
}) {
  const usable = props.devices.filter((d) => d.available);
  const rec = usable.find((d) => d.recommended) ?? usable[0];
  if (!rec) return null;
  const active = usable.find((d) => d.active);
  const unavailable = props.devices.filter((d) => !d.available);
  return (
    <>
      <ChoiceRow
        label={props.label}
        hint={props.hint}
        options={usable.map((d) => ({ value: d.key, label: d.name }))}
        value={active && active.key !== rec.key ? active.key : null}
        recommended={rec.key}
        onChange={props.onChange}
      />
      {unavailable.map((d) => (
        <Text key={d.key} style={styles.hint}>
          {d.name}: {d.why ?? 'not available'}
        </Text>
      ))}
    </>
  );
}

/** Inputs and outputs, refreshed when something is plugged in or out. */
export function DevicesSection() {
  const [, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);
  useEffect(() => watchDevices(refresh), []);
  const safe = <T,>(f: () => T, fallback: T): T => {
    try {
      return f();
    } catch {
      return fallback;
    }
  };
  const inputs = safe(listInputs, { cameras: [], mics: [] });
  const outputs = safe(listOutputs, []);
  return (
    <Section title="Inputs and outputs">
      <DeviceRow
        label="Camera"
        hint="A plugged-in USB camera is used first, else the phone camera."
        devices={inputs.cameras}
        onChange={(k) => {
          setCamera(k);
          refresh();
        }}
      />
      <DeviceRow
        label="Microphone"
        hint="Camera or headphone microphone when connected, else the phone microphone."
        devices={inputs.mics}
        onChange={(k) => {
          setAudioOverride('input', k);
          refresh();
        }}
      />
      <DeviceRow
        label="Sound"
        hint="Headphones when connected, else the phone speaker."
        devices={outputs}
        onChange={(k) => {
          setAudioOverride('output', k);
          refresh();
        }}
      />
    </Section>
  );
}
