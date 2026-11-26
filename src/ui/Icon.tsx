import { MaterialSymbols_400Regular } from '@expo-google-fonts/material-symbols/400Regular';
import { loadAsync } from 'expo-font';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';

/**
 * App icons: the same Material Symbols on Android and iPhone. Android draws them with
 * expo-symbols; on iPhone the same font is drawn here (expo-symbols would use SF Symbols there,
 * which look different). Add new ones here with their Material name and code point
 * (__tests__/icons-test.ts checks the code points against expo-symbols' list).
 */
export const ICONS = {
  menu: { name: 'menu', code: 0xe5d2 },
  settings: { name: 'settings', code: 0xe8b8 },
  mic: { name: 'mic', code: 0xe029 },
  send: { name: 'arrow_upward', code: 0xe5d8 },
  camera: { name: 'photo_camera', code: 0xe412 },
  cameraOff: { name: 'no_photography', code: 0xf1a8 },
  stop: { name: 'stop', code: 0xe047 },
  mute: { name: 'volume_off', code: 0xe04f },
  close: { name: 'close', code: 0xe5cd },
  offRecord: { name: 'visibility_off', code: 0xe8f5 },
  listen: { name: 'hearing', code: 0xe023 },
  shutter: { name: 'circle', code: 0xef4a },
  chevron: { name: 'chevron_right', code: 0xe5cc },
  check: { name: 'check', code: 0xe5ca },
  play: { name: 'play_arrow', code: 0xe037 },
  pause: { name: 'pause', code: 0xe034 },
  back5: { name: 'replay_5', code: 0xe05b },
  forward5: { name: 'forward_5', code: 0xe058 },
  share: { name: 'share', code: 0xe80d },
  save: { name: 'download', code: 0xf090 },
  delete: { name: 'delete', code: 0xe872 },
  edit: { name: 'edit', code: 0xe3c9 },
  info: { name: 'info', code: 0xe88e },
  warning: { name: 'warning', code: 0xe002 },
} as const;

export type IconName = keyof typeof ICONS;

const FONT = 'MaterialSymbols_400Regular';
let fontReady = false;
let fontLoad: Promise<void> | null = null;

function loadFont(): Promise<void> {
  fontLoad ??= loadAsync({ [FONT]: MaterialSymbols_400Regular })
    .then(() => {
      fontReady = true;
    })
    .catch(() => {});
  return fontLoad;
}

function IphoneIcon({ code, size, color }: { code: number; size: number; color: string }) {
  const [ready, setReady] = useState(fontReady);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void loadFont().then(() => live && setReady(fontReady));
    return () => {
      live = false;
    };
  }, [ready]);
  return (
    <View collapsable={false} style={{ width: size, height: size }}>
      {ready ? (
        <Text
          aria-hidden
          allowFontScaling={false}
          style={{ fontFamily: FONT, color, fontSize: size, lineHeight: size }}
        >
          {String.fromCharCode(code)}
        </Text>
      ) : null}
    </View>
  );
}

export function Icon({ name, size = 24, color }: { name: IconName; size?: number; color: string }) {
  const icon = ICONS[name];
  if (Platform.OS === 'ios') return <IphoneIcon code={icon.code} size={size} color={color} />;
  return <SymbolView name={{ android: icon.name, ios: 'circle' }} size={size} tintColor={color} />;
}
