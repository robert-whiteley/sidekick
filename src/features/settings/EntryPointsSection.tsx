import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Text } from 'react-native';

import SidekickNative from '../../../modules/sidekick-native';
import { Button, Section, styles } from './ui';

/** Android only: phone assistant ("ask about my screen"), Quick Settings tile, widget. */
export function EntryPointsSection() {
  const android =
    Platform.OS === 'android' && typeof SidekickNative.assistantIsDefault === 'function';
  const [isAssistant, setIsAssistant] = useState(false);
  const [note, setNote] = useState('');

  // Re-checked when coming back from the system settings page.
  useFocusEffect(
    useCallback(() => {
      if (android) setIsAssistant(SidekickNative.assistantIsDefault());
    }, [android]),
  );

  if (!android) return null;
  return (
    <Section title="Quick ways to ask">
      <Text style={styles.body}>
        {isAssistant
          ? 'Sidekick is your phone assistant: long-press home or swipe up from a bottom corner to ask about your screen.'
          : 'Make Sidekick your phone assistant to ask about whatever is on your screen.'}
      </Text>
      <Text style={styles.hint}>
        The screenshot stays on this phone. Save it from the Ask screen if you want to keep it.
      </Text>
      <Button
        title="Digital assistant app settings"
        onPress={() => {
          if (!SidekickNative.openAssistantSettings()) setNote("Couldn't open settings.");
        }}
      />
      <Button
        title="Add Quick Settings tile"
        onPress={() =>
          setNote(
            SidekickNative.requestAddTile()
              ? ''
              : 'Pull down Quick Settings, tap the pencil and drag "Ask Sidekick" in.',
          )
        }
      />
      <Button
        title="Add home-screen widget"
        onPress={() =>
          setNote(
            SidekickNative.requestAddWidget()
              ? ''
              : 'Long-press the home screen, tap Widgets and pick Sidekick.',
          )
        }
      />
      {note ? <Text style={styles.hint}>{note}</Text> : null}
    </Section>
  );
}
