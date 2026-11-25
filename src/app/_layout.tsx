import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
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
    </Stack>
  );
}
