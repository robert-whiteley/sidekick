import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState, Platform, View } from 'react-native';

import { Page } from '@/features/settings/Page';
import { useSettings } from '@/features/settings/useSettings';
import { Button, confirm, Row, Section, styles } from '@/features/settings/ui';
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

const n = (x: number) => x.toLocaleString();
const PACE =
  'New photos can be found by date and name at once. Their words and contents are read newest first: quickly while charging, a little at a time on battery (not under 30% or when warm), and at once when you ask about recent ones.';

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
    confirm(
      'Stop searching photos?',
      'What Sidekick read from your photos is deleted. Your photos are not touched.',
      () => run('Deleting the photo index', () => setPhotoSearch(false)),
    );
  };

  const toggleFolders = (on: boolean) => {
    if (on) return set({ sourceFolders: true });
    confirm(
      'Stop searching folders and files?',
      'What Sidekick read from them is deleted. Your files are not touched.',
      () => run('Deleting the file index', stopFolders),
    );
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
                  folder” at the bottom of the screen that opens. {PACE}
                </AppText>
                {s.photoFolderUris.map((uri) => (
                  <View key={uri} style={styles.itemRow}>
                    <AppText style={styles.flex} numberOfLines={1}>
                      {folderLabel(uri)}
                    </AppText>
                    <TextButton
                      title="Remove"
                      onPress={() =>
                        confirm(
                          'Remove this photo folder?',
                          'What Sidekick read from it is deleted. Your photos are not touched.',
                          () => run('Removing folder', () => removePhotoFolder(uri)),
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
                {ACCESS[access]} {PACE}
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
                confirm(
                  'Remove the photo index?',
                  'What Sidekick read from your photos is deleted and read again, newest first. Your photos are not touched.',
                  () => run('Removing', removePhotoIndex),
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
                    confirm(
                      'Remove this folder?',
                      'What Sidekick read from it is deleted. Your files are not touched.',
                      () => run('Removing folder', () => removeFolder(uri)),
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
                    confirm(
                      'Remove this file?',
                      'What Sidekick read from it is deleted. The file is not touched.',
                      () => run('Removing file', () => removePickedFile(uri)),
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
      </Section>
      {msg ? (
        <AppText variant="bodySmall" tone="muted">
          {msg}
        </AppText>
      ) : null}
    </Page>
  );
}
