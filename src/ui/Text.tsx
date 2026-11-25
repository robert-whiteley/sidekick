import { Text, type TextProps } from 'react-native';

import { useColors } from './theme';
import { type Colors, type, type TypeVariant } from './tokens';

export type Tone =
  | 'default'
  | 'muted'
  | 'faint'
  | 'primary'
  | 'danger'
  | 'onPrimary'
  | 'onMedia'
  | 'success'
  | 'warning';

const toneColor = (c: Colors, t: Tone) =>
  ({
    default: c.text,
    muted: c.muted,
    faint: c.faint,
    primary: c.primary,
    danger: c.danger,
    onPrimary: c.onPrimary,
    onMedia: c.onMedia,
    success: c.success,
    warning: c.warning,
  })[t];

/** All text in the app: a type-scale variant and a colour role. */
export function AppText({
  variant = 'body',
  tone = 'default',
  style,
  ...rest
}: TextProps & { variant?: TypeVariant; tone?: Tone }) {
  const c = useColors();
  return <Text {...rest} style={[type[variant], { color: toneColor(c, tone) }, style]} />;
}
