import { Stack } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { Explainer } from '@/features/onboarding/FirstRun';

/** "About Sidekick": the first-run explainer, from Settings. */
export default function About() {
  return (
    <>
      <Stack.Screen options={{ title: 'About Sidekick' }} />
      <ScrollView contentContainerStyle={styles.page}>
        <Explainer />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({ page: { padding: 24 } });
