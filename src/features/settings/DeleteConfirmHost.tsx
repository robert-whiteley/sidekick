import { useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  cancelDelete,
  confirmDelete,
  DELETE_WORD,
  type DeleteRequest,
  onDeleteRequest,
  pendingDelete,
  typedConfirms,
} from '@/engine/delete-confirm';
import { exportAllData } from '@/engine/data-export';
import { AppText, Button, Sheet, space, TextField } from '@/ui';

/**
 * The delete confirmation (engine/delete-confirm.ts), mounted once at the root: what is deleted,
 * that it can't be undone, Export first where it helps, and Delete enabled once DELETE is typed.
 */
export function DeleteConfirmHost() {
  const req = useSyncExternalStore(onDeleteRequest, pendingDelete);
  // A new request starts with an empty field.
  return req ? <DeleteSheet key={req.seq} req={req} /> : null;
}

function DeleteSheet({ req }: { req: DeleteRequest }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const ok = typedConfirms(typed);
  return (
    <Sheet
      visible
      title={req.title}
      onClose={cancelDelete}
      footer={
        <View style={styles.row}>
          <Button variant="text" title="Cancel" onPress={cancelDelete} />
          <Button
            variant="filled"
            danger
            title="Delete"
            disabled={!ok || busy}
            busy={busy}
            onPress={() => {
              setBusy(true);
              void confirmDelete(typed).finally(() => setBusy(false));
            }}
          />
        </View>
      }
    >
      <View style={styles.body}>
        {req.lines.map((l) => (
          <AppText key={l}>{l}</AppText>
        ))}
        <AppText tone="danger">This can’t be undone.</AppText>
        {req.exportFirst ? (
          <Button
            variant="outlined"
            title="Export everything first"
            onPress={() => {
              setNote('Choose a folder for the export…');
              void exportAllData()
                .then((r) => setNote(r ? `Exported ${r.files} files to "${r.folder}".` : ''))
                .catch((e: unknown) =>
                  setNote(`Export failed: ${e instanceof Error ? e.message : String(e)}`),
                );
            }}
          />
        ) : null}
        {note ? (
          <AppText variant="bodySmall" tone="muted">
            {note}
          </AppText>
        ) : null}
        <TextField
          label={`Type ${DELETE_WORD} to confirm`}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={DELETE_WORD}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.sm, paddingBottom: space.md },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
});
