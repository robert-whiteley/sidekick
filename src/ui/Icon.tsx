import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';

type Names = NonNullable<Extract<ComponentProps<typeof SymbolView>['name'], object>>;

/** App icons: Material Symbols on Android, SF Symbols on iOS. Add new ones here. */
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
  chevron: { android: 'chevron_right', ios: 'chevron.right' },
  check: { android: 'check', ios: 'checkmark' },
  play: { android: 'play_arrow', ios: 'play.fill' },
  pause: { android: 'pause', ios: 'pause.fill' },
  back5: { android: 'replay_5', ios: 'gobackward.5' },
  forward5: { android: 'forward_5', ios: 'goforward.5' },
  share: { android: 'share', ios: 'square.and.arrow.up' },
  save: { android: 'download', ios: 'square.and.arrow.down' },
  delete: { android: 'delete', ios: 'trash' },
  edit: { android: 'edit', ios: 'pencil' },
  info: { android: 'info', ios: 'info.circle' },
  warning: { android: 'warning', ios: 'exclamationmark.triangle' },
} as const satisfies Record<string, Names>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 24, color }: { name: IconName; size?: number; color: string }) {
  return <SymbolView name={ICONS[name]} size={size} tintColor={color} />;
}
