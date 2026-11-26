import * as Clipboard from 'expo-clipboard';
import { ScrollView, Share, StyleSheet, View } from 'react-native';

import { type Attachment, suggestions } from '@/engine/shared-doc-logic';
import {
  AppText,
  Button,
  ButtonRow,
  IconButton,
  makeStyles,
  ProgressBar,
  radius,
  space,
  TextButton,
} from '@/ui';

function title(a: Attachment): string {
  switch (a.kind) {
    case 'pdf':
      return `PDF · ${a.name}`;
    case 'audio':
      return `Recording · ${a.name}`;
    case 'page':
      return `Web page · ${a.name}`;
    case 'selection':
      return `Selected text · ${(a.text ?? '').replace(/\s+/g, ' ').trim()}`;
    default:
      return `Document · ${a.name}`;
  }
}

/**
 * What the next questions are about (a shared file, recording, web page or selected text), with
 * suggested questions to tap; typing anything else works too. Closing it goes back to the chat.
 */
export function AttachmentBar(props: {
  attachment: Attachment;
  busy: boolean;
  onAsk: (question: string) => void;
  onClose: () => void;
}) {
  const s = useStyles();
  const a = props.attachment;
  const reading = a.kind === 'audio' && !a.text && !a.error;
  return (
    <View style={s.bar}>
      <View style={styles.row}>
        <AppText variant="bodySmall" style={styles.text} numberOfLines={2}>
          {title(a)}
        </AppText>
        <IconButton
          name="close"
          size={20}
          onPress={props.onClose}
          accessibilityLabel="Stop asking about this"
        />
      </View>
      {a.error ? (
        <AppText variant="bodySmall" tone="muted">
          {a.error}
        </AppText>
      ) : reading ? (
        <View style={styles.progress}>
          <AppText variant="bodySmall" tone="muted">
            {`Turning it into text on this phone… ${Math.round((a.progress ?? 0) * 100)}%. You can leave the app; it carries on.`}
          </AppText>
          <ProgressBar fraction={a.progress ?? 0} label="Reading the recording" />
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <ButtonRow start>
            {suggestions(a).map((x) => (
              <Button
                key={x.label}
                title={x.label}
                variant="outlined"
                disabled={props.busy}
                onPress={() => props.onAsk(x.question)}
              />
            ))}
          </ButtonRow>
        </ScrollView>
      )}
    </View>
  );
}

/** Under an answer about selected text: put it back into the app, or copy / share it. */
export function TextResultActions(props: {
  text: string;
  canReplace: boolean;
  onReplace: () => void;
}) {
  return (
    <ButtonRow start>
      {props.canReplace ? (
        <Button title="Replace in the app" variant="tonal" onPress={props.onReplace} />
      ) : null}
      <TextButton title="Copy" onPress={() => void Clipboard.setStringAsync(props.text)} />
      <TextButton title="Share" onPress={() => void Share.share({ message: props.text })} />
    </ButtonRow>
  );
}

const useStyles = makeStyles((c) => ({
  bar: {
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: c.surface,
  },
}));

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  text: { flex: 1 },
  progress: { gap: space.xs },
});
