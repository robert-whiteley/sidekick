import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AppLockGate } from '@/features/lock/AppLockGate';
import { type Colors, DialogHost, useColors, useScheme } from '@/ui';

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
