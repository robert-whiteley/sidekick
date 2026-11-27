import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

import { errorDetailsFor } from '@/engine/error-details';
import { AppLockGate } from '@/features/lock/AppLockGate';
import {
  AppText,
  Button,
  type Colors,
  DialogHost,
  ErrorDetailsButton,
  space,
  useColors,
  useScheme,
} from '@/ui';

/** Headers and screen backgrounds from the app tokens, light or dark with the phone. */
function navTheme(dark: boolean, c: Colors) {
  const base = dark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: c.primary,
      background: c.bg,
      card: c.bg,
      text: c.text,
      border: c.border,
      notification: c.danger,
    },
  };
}

export default function RootLayout() {
  const dark = useScheme() === 'dark';
  const c = useColors();
  return (
    <ThemeProvider value={navTheme(dark, c)}>
      {/* Every screen: icons readable on the app's own light or dark background. */}
      <StatusBar style={dark ? 'light' : 'dark'} />
      <AppLockGate>
        <Stack
          screenOptions={{
            // One look on Android and iOS: centred title, no shadow, back arrow without a label.
            headerTitleAlign: 'center',
            headerShadowVisible: false,
            headerBackButtonDisplayMode: 'minimal',
            headerTintColor: c.primary,
            headerTitleStyle: { color: c.text },
            contentStyle: { backgroundColor: c.bg },
          }}
        >
          {/* One home screen (one camera): links from the tile, widget and assistant reuse it. */}
          <Stack.Screen
            name="index"
            options={{ headerShown: false }}
            dangerouslySingular={() => 'home'}
          />
          <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
          <Stack.Screen name="memory/index" options={{ title: 'Memory' }} />
          <Stack.Screen name="bench" options={{ title: 'Speed test' }} />
          <Stack.Screen name="person/[id]" options={{ title: 'Person' }} />
          <Stack.Screen name="note/[id]" options={{ title: 'Conversation notes' }} />
        </Stack>
        <DialogHost />
      </AppLockGate>
    </ThemeProvider>
  );
}

/**
 * A screen that failed to draw: a plain message, Try again, and "Copy error details" (no personal
 * content) to paste into a message, instead of a blank or red screen.
 */
export function ErrorBoundary(props: { error: Error; retry: () => Promise<void> }) {
  const c = useColors();
  return (
    <View style={[boundary.page, { backgroundColor: c.bg }]}>
      <AppText variant="title">Something went wrong</AppText>
      <AppText>Sidekick hit a problem on this screen. Nothing you saved is lost.</AppText>
      <Button title="Try again" variant="filled" onPress={() => void props.retry()} />
      <ErrorDetailsButton details={() => errorDetailsFor('screen', props.error)} />
    </View>
  );
}

const boundary = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', gap: space.md, padding: space.lg },
});
