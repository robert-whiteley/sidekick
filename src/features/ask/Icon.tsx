import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';

type Names = NonNullable<Extract<ComponentProps<typeof SymbolView>['name'], object>>;

/** The few icons the chat uses: Material Symbols on Android, SF Symbols on iOS. */
const ICONS = {
  menu: { android: 'menu', ios: 'line.3.horizontal' },
  settings: { android: 'settings', ios: 'gearshape' },
  mic: { android: 'mic', ios: 'mic' },
  send: { android: 'arrow_upward', ios: 'arrow.up' },
  camera: { android: 'photo_camera', ios: 'camera' },
  cameraOff: { android: 'no_photography', ios: 'camera.badge.ellipsis' },
  stop: { android: 'stop', ios: 'stop.fill' },
  mute: { android: 'volume_off', ios: 'speaker.slash' },
  close: { android: 'close', ios: 'xmark' },
  offRecord: { android: 'visibility_off', ios: 'eye.slash' },
  listen: { android: 'hearing', ios: 'ear' },
  shutter: { android: 'circle', ios: 'circle.inset.filled' },
} as const satisfies Record<string, Names>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 24, color }: { name: IconName; size?: number; color: string }) {
  return <SymbolView name={ICONS[name]} size={size} tintColor={color} />;
}
