import { useState } from 'react';

import { resetBackendChoice, savedBackend, unloadLlm } from '@/engine/llm';
import { Button, Section } from './ui';
import { AppText } from '@/ui';

export function ChipSection() {
  const [backend, setBackend] = useState(savedBackend());
  return (
    <Section title="AI chip">
      <AppText>
        Sidekick times each chip on this phone once and uses the fastest:{' '}
        {backend ? backend.toUpperCase() : 'not measured yet'}.
      </AppText>
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
