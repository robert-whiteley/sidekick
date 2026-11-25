import { View } from 'react-native';

import { ListRow } from './ListRow';
import { Toggle } from './Toggle';

/** On/off setting: the whole row toggles (Android Settings pattern). */
export function SwitchRow(props: {
  title: string;
  supporting?: string | null;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <ListRow
      title={props.title}
      supporting={props.supporting}
      onPress={props.disabled ? undefined : () => props.onChange(!props.value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: props.value, disabled: props.disabled }}
      trailing={
        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Toggle value={props.value} onChange={props.onChange} disabled={props.disabled} />
        </View>
      }
    />
  );
}
