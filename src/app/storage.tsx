import { Stack } from 'expo-router';

import { StorageScreen } from '@/features/storage/StorageScreen';

export default function Storage() {
  return (
    <>
      <Stack.Screen options={{ title: 'Storage' }} />
      <StorageScreen />
    </>
  );
}
