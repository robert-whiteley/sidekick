import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from './theme';

/**
 * The one touchable. Same feedback on Android and iOS (no platform ripple): rows get a soft
 * highlight while pressed, buttons dim. hitSlop keeps small visuals at a 48 pt target.
 */
export function Tappable({
  hitSlop = 8,
  feedback = 'highlight',
  style,
  ...rest
}: Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  feedback?: 'highlight' | 'dim' | 'none';
}) {
  const c = useColors();
  return (
    <Pressable
      hitSlop={hitSlop}
      style={({ pressed }) => [
        style,
        pressed && feedback === 'highlight' && { backgroundColor: c.ripple },
        pressed && feedback === 'dim' && { opacity: 0.6 },
      ]}
      {...rest}
    />
  );
}
