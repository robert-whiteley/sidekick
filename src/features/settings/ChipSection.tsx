import { useState } from 'react';
import { Text } from 'react-native';

import { resetBackendChoice, savedBackend, unloadLlm } from '@/engine/llm';
import { Button, Section, styles } from './ui';

export function ChipSection() {
  const [backend, setBackend] = useState(savedBackend());
  return (
    <Section title="AI chip">
      <Text style={styles.body}>
        Sidekick times each chip on this phone once and uses the fastest:{' '}
        {backend ? backend.toUpperCase() : 'not measured yet'}.
      </Text>
      <Button
        title="Measure again on next question"
        onPress={async () => {
          resetBackendChoice();
          await unloadLlm();
          setBackend(null);
        }}
      />
    </Section>
  );
}
