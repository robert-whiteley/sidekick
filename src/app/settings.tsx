import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { resetBackendChoice, savedBackend, unloadLlm } from '@/engine/llm';

export default function SettingsScreen() {
  const [backend, setBackend] = useState(savedBackend());
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.h}>AI chip</Text>
      <Text style={styles.body}>
        Sidekick times each chip on this phone once and uses the fastest:{' '}
        {backend ? backend.toUpperCase() : 'not measured yet'}.
      </Text>
      <Pressable
        style={styles.button}
        onPress={async () => {
          resetBackendChoice();
          await unloadLlm();
          setBackend(null);
        }}
      >
        <Text style={styles.buttonText}>Measure again on next question</Text>
      </Pressable>
      <Link href="/bench" style={styles.link}>
        Speed test (developer)
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12 },
  title: { fontSize: 26, fontWeight: '700' },
  h: { fontSize: 18, fontWeight: '600', marginTop: 12 },
  body: { fontSize: 16, lineHeight: 22 },
  button: { backgroundColor: '#f2f2f5', padding: 12, borderRadius: 12 },
  buttonText: { fontSize: 16, color: '#2f6fed' },
  link: { fontSize: 16, color: '#2f6fed', marginTop: 12 },
});
