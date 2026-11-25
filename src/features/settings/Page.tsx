import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

/** A settings / memory page: title in the header, scrolling content. */
export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Stack.Screen options={{ title }} />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12, paddingBottom: 48 },
});
