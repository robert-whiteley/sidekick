import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, ButtonRow } from './Button';
import { choiceChips, type Option } from './choice-logic';
import { ListRow } from './ListRow';
import { OptionItem } from './OptionItem';
import { Sheet } from './Sheet';
import { AppText } from './Text';
import { space } from './tokens';

/**
 * A setting with several options (the Settings pattern on both Android and iOS): the row shows the
 * current value; tapping opens a bottom sheet with a tick on the chosen option. This phone's Recommended value is marked. value null = following
 * Recommended; onChange(null) = back to Recommended.
 */
export function ChoiceRow<T extends string | number>(props: {
  label: string;
  hint?: string;
  options: Option<T>[];
  value: T | null;
  recommended: T;
  onChange: (v: T | null) => void;
  /** Label for a Recommended value that isn't one of the options. */
  format?: (v: T) => string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const chips = choiceChips(props.options, props.value, props.recommended, props.format);
  const current = chips.find((c) => c.selected);
  return (
    <>
      <ListRow
        title={props.label}
        supporting={current?.label ?? null}
        onPress={() => setOpen(true)}
        disabled={props.disabled}
        accessibilityHint="Opens the choices"
      />
      <Sheet
        visible={open}
        title={props.label}
        onClose={() => setOpen(false)}
        footer={
          <ButtonRow>
            <Button variant="text" title="Cancel" onPress={() => setOpen(false)} />
          </ButtonRow>
        }
      >
        {props.hint ? (
          <AppText variant="bodySmall" tone="muted" style={styles.hint}>
            {props.hint}
          </AppText>
        ) : null}
        {chips.map((c) => (
          <OptionItem
            key={String(c.value)}
            label={c.label}
            selected={c.selected}
            onPress={() => {
              setOpen(false);
              props.onChange(c.store);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}

/** A setting with several options and no Recommended value: row + bottom sheet. */
export function PickerRow<T extends string | number>(props: {
  label: string;
  hint?: string;
  options: { value: T; label: string; supporting?: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = props.options.find((o) => o.value === props.value);
  return (
    <>
      <ListRow
        title={props.label}
        supporting={current?.label ?? null}
        onPress={() => setOpen(true)}
        disabled={props.disabled}
        accessibilityHint="Opens the choices"
      />
      <Sheet
        visible={open}
        title={props.label}
        onClose={() => setOpen(false)}
        footer={
          <ButtonRow>
            <Button variant="text" title="Cancel" onPress={() => setOpen(false)} />
          </ButtonRow>
        }
      >
        {props.hint ? (
          <AppText variant="bodySmall" tone="muted" style={styles.hint}>
            {props.hint}
          </AppText>
        ) : null}
        {props.options.map((o) => (
          <OptionItem
            key={String(o.value)}
            label={o.label}
            supporting={o.supporting}
            selected={o.value === props.value}
            onPress={() => {
              setOpen(false);
              props.onChange(o.value);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  hint: { paddingBottom: space.sm },
});
