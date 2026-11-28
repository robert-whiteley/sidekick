import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState, Platform, View } from 'react-native';

import { askToDelete } from '@/engine/delete-plans';
import { DEFAULTS } from '@/engine/settings';
import { BATTERY_FLOORS } from '@/engine/setting-options';
import { Page } from '@/features/settings/Page';
import { useSettings } from '@/features/settings/useSettings';
import { Button, ChoiceRow, Row, Section, styles } from '@/features/settings/ui';
import {
  addPhotoFolder,
  chooseMorePhotos,
  PHOTO_FOLDERS,
  removePhotoFolder,
  galleryStats,
  type GalleryStats,
  photoAccess,
  type PhotoAccess,
  removePhotoIndex,
  setPhotoSearch,
} from '@/memory/gallery';
import { BYTES_PER_PHOTO } from '@/memory/gallery-logic';
import {
  countKind,
  fileLabel,
  folderLabel,
  PICK_START,
  pickFiles,
  pickFolder,
  removeFolder,
  removePickedFile,
  stopFolders,
  syncNow,
} from '@/memory/sources';
import { AppText, TextButton } from '@/ui';

const isAndroid = Platform.OS === 'android';

const ACCESS: Record<PhotoAccess, string> = {
  all: 'All photos allowed.',
  limited: 'Only the photos you chose are allowed.',
  none: 'Not allowed.',
};

const MIN_BATTERY = DEFAULTS.indexMinBattery;
const n = (x: number) => x.toLocaleString();
const pace = (onBattery: boolean, floor: number) =>
  `New photos can be found by date and name at once. Their words and contents are read newest first: quickly while charging, ${onBattery ? `a little at a time on battery (not under ${floor}% or when warm)` : 'not on battery'}, and at once when you ask about recent ones.`;

const mb = (n: number) => `${Math.max(1, Math.round((n * BYTES_PER_PHOTO) / 1e6))} MB`;

/**
 * Settings → Phone search: which photos and files Sidekick may search. Nothing is searched until
 * the user allows it here; turning a part off or removing a folder deletes what was read from it.
 */
export default function PhoneSearchScreen() {
  const { s, set } = useSettings();
  const [access, setAccess] = useState<PhotoAccess>('none');
  const [stats, setStats] = useState<GalleryStats>({ photos: 0, read: 0, done: 0, failed: 0 });
  const [passages, setPassages] = useState(0);
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [a, g, f] = await Promise.all([photoAccess(), galleryStats(), countKind('file')]);
      setAccess(a);
      setStats(g);
      setPassages(f);
    } catch (e) {
      console.log(`[phone-search] settings: ${String(e)}`);
    }
  }, []);

  // Coming back from the phone's settings or a picker.
  useFocusEffect(
    useCallback(() => {
      void refresh();
      const sub = AppState.addEventListener('change', (st) => {
        if (st === 'active') void refresh();
      });
      return () => sub.remove();
    }, [refresh]),
  );

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setMsg(`${label}…`);
    try {
      await fn();
      setMsg('');
    } catch (e) {
      setMsg(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    await refresh();
  };

  const togglePhotos = (on: boolean) => {
    if (on && isAndroid)
      // No Photos permission on Android: start with the camera folder in the system picker.
      return void run('Adding photos', async () => {
        await setPhotoSearch(true);
        await addPhotoFolder(PHOTO_FOLDERS.camera);
      });
    if (on)
      return void run('Asking for photos', async () => {
        if ((await setPhotoSearch(true)) === 'none') throw new Error('permission was not given');
      });
    void askToDelete({ kind: 'photos', again: false }, () =>
      run('Deleting the photo index', () => setPhotoSearch(false)),
    );
  };

  const toggleFolders = (on: boolean) => {
    if (on) return set({ sourceFolders: true });
    void askToDelete({ kind: 'folderSource' }, () => run('Deleting the file index', stopFolders));
  };

  const addFolder = (start?: string) =>
    void run('Adding folder', async () => {
      if (await pickFolder(start)) await syncNow('folders');
    });

  const photoHint =
    stats.photos > 0
      ? `${n(stats.done)} of ${n(stats.photos)} photos ready, ${n(stats.read)} searchable by their words (${mb(stats.photos)}).${stats.failed ? ` ${n(stats.failed)} couldn't be read.` : ''}`
      : 'Finds photos and screenshots by what they show and the words in them.';

  return (
    <Page title="Phone search">
      <AppText>
        Ask for things on your phone: “find my latest invoice from Acme and tell me the cost”, “the
        photo of the parking sign last week”. Sidekick only searches what you allow here, reads it
        on this phone, and keeps only an encrypted index. Nothing is sent anywhere.
      </AppText>

      <Section title="Photos">
        <Row
          label="Search my photos"
          hint={photoHint}
          value={s.sourceGallery}
          onChange={togglePhotos}
        />
        {s.sourceGallery ? (
          <>
            {isAndroid ? (
              <>
                <AppText variant="bodySmall" tone="muted">
                  Sidekick reads only the photo folders you add. Tap a button, then “Use this
                  folder” at the bottom of the screen that opens.{' '}
                  {pace(s.indexOnBattery, s.indexMinBattery)}
                </AppText>
                {s.photoFolderUris.map((uri) => (
                  <View key={uri} style={styles.itemRow}>
                    <AppText style={styles.flex} numberOfLines={1}>
                      {folderLabel(uri)}
                    </AppText>
                    <TextButton
                      title="Remove"
                      onPress={() =>
                        void askToDelete({ kind: 'photoFolder', label: folderLabel(uri) }, () =>
                          run('Removing folder', () => removePhotoFolder(uri)),
                        )
                      }
                      accessibilityLabel={`Remove photo folder ${folderLabel(uri)}`}
                      danger
                    />
                  </View>
                ))}
                <Button
                  title="Add camera photos"
                  onPress={() =>
                    void run('Adding photos', () => addPhotoFolder(PHOTO_FOLDERS.camera))
                  }
                />
                <Button
                  title="Add screenshots"
                  onPress={() =>
                    void run('Adding screenshots', () => addPhotoFolder(PHOTO_FOLDERS.screenshots))
                  }
                />
                <Button
                  title="Add another photo folder"
                  onPress={() => void run('Adding photos', () => addPhotoFolder())}
                />
              </>
            ) : (
              <AppText variant="bodySmall" tone="muted">
                {ACCESS[access]} {pace(s.indexOnBattery, s.indexMinBattery)}
              </AppText>
            )}
            {!isAndroid && access !== 'none' ? (
              <Button
                title={access === 'limited' ? 'Choose which photos' : 'Allow only some photos'}
                onPress={() => void run('Choosing photos', chooseMorePhotos)}
              />
            ) : null}
            <Button
              danger
              title="Remove the photo index"
              onPress={() =>
                void askToDelete({ kind: 'photos', again: true }, () =>
                  run('Removing', removePhotoIndex),
                )
              }
            />
          </>
        ) : null}
      </Section>

      <Section title="Folders and files">
        <Row
          label="Search folders I choose"
          hint={`${isAndroid ? 'Text, PDFs and photos' : 'Text files and photos'} in folders and files you pick. ${passages} passages read.`}
          value={s.sourceFolders}
          onChange={toggleFolders}
        />
        {s.sourceFolders ? (
          <>
            {s.folderUris.map((uri) => (
              <View key={uri} style={styles.itemRow}>
                <AppText style={styles.flex} numberOfLines={1}>
                  {folderLabel(uri)}
                </AppText>
                <TextButton
                  title="Remove"
                  onPress={() =>
                    void askToDelete({ kind: 'folder', label: folderLabel(uri) }, () =>
                      run('Removing folder', () => removeFolder(uri)),
                    )
                  }
                  accessibilityLabel={`Remove folder ${folderLabel(uri)}`}
                  danger
                />
              </View>
            ))}
            {s.fileUris.map((uri) => (
              <View key={uri} style={styles.itemRow}>
                <AppText style={styles.flex} numberOfLines={1}>
                  {fileLabel(uri)}
                </AppText>
                <TextButton
                  title="Remove"
                  onPress={() =>
                    void askToDelete({ kind: 'pickedFile', label: fileLabel(uri) }, () =>
                      run('Removing file', () => removePickedFile(uri)),
                    )
                  }
                  accessibilityLabel={`Remove file ${fileLabel(uri)}`}
                  danger
                />
              </View>
            ))}
            {isAndroid ? (
              <Button title="Add Documents" onPress={() => addFolder(PICK_START.documents)} />
            ) : null}
            <Button
              title={isAndroid ? 'Add files from Downloads' : 'Add files'}
              onPress={() => void run('Adding files', () => pickFiles(PICK_START.downloads))}
            />
            <Button title="Add another folder" onPress={() => addFolder()} />
            {s.folderUris.length + s.fileUris.length > 0 ? (
              <Button
                title="Read them again now"
                onPress={() => void run('Reading', () => syncNow('folders'))}
              />
            ) : null}
          </>
        ) : null}
      </Section>

      <Section title="Reading">
        <Row
          label="Pause reading"
          hint="Stops reading new photos and files. What's already read can still be found."
          value={s.searchPaused}
          onChange={(v) => set({ searchPaused: v })}
        />
        <Row
          label="Read photos on battery"
          hint="Off: new photos are read only while charging."
          value={s.indexOnBattery}
          onChange={(v) => set({ indexOnBattery: v })}
        />
        {s.indexOnBattery ? (
          <ChoiceRow
            label="Lowest battery for reading"
            hint="No reading on battery below this level."
            options={BATTERY_FLOORS.map((v) => ({ value: v, label: `${v}%` }))}
            value={s.indexMinBattery === MIN_BATTERY ? null : s.indexMinBattery}
            recommended={MIN_BATTERY}
            onChange={(v) => set({ indexMinBattery: v ?? MIN_BATTERY })}
          />
        ) : null}
      </Section>
      {msg ? (
        <AppText variant="bodySmall" tone="muted">
          {msg}
        </AppText>
      ) : null}
    </Page>
  );
}
