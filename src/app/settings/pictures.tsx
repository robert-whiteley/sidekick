import { useEffect, useState } from 'react';

import { PICTURE_TERMS_MD } from '@/content/legal';
import { MarkdownView } from '@/features/about/MarkdownView';
import { Page } from '@/features/settings/Page';
import { PICTURE_FILES } from '@/engine/models';
import {
  deletePictureModel,
  downloadPictureModel,
  onPictureDownload,
  pictureAvailability,
  pictureDownload,
  pictureFilesReady,
  type PictureDownload,
} from '@/engine/picture';
import { AppText, Button, ProgressBar, Section, showDialog } from '@/ui';

const SIZE_GB = ((PICTURE_FILES.model.bytes + PICTURE_FILES.decoder.bytes) / 1e9).toFixed(1);

/**
 * Settings → Assistant → Make pictures: the optional picture model. Its licence terms are shown
 * in full and agreed to by downloading (the model's licence requires users to accept them).
 */
export default function PicturesScreen() {
  const offer = pictureAvailability();
  const [ready, setReady] = useState(pictureFilesReady);
  const [d, setD] = useState<PictureDownload>(pictureDownload);
  useEffect(
    () =>
      onPictureDownload((x) => {
        setD(x);
        if (!x.busy) setReady(pictureFilesReady());
      }),
    [],
  );

  return (
    <Page title="Make pictures">
      <AppText>
        Ask Sidekick to draw something (“draw a fox reading a book”) and it makes a 512 × 512
        picture on this phone, in about 40 seconds on a 2020 phone. Nothing is sent anywhere.
      </AppText>
      {offer.note ? <AppText tone="muted">{offer.note}</AppText> : null}
      {!offer.offer ? null : ready ? (
        <Section title="Downloaded">
          <AppText variant="bodySmall" tone="muted">
            The picture model is on this phone ({SIZE_GB} GB).
          </AppText>
          <Button
            title="Delete the picture model"
            variant="outlined"
            danger
            onPress={() =>
              showDialog(
                'Delete the picture model?',
                `Frees ${SIZE_GB} GB. Pictures already made stay.`,
                [
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () =>
                      void deletePictureModel().then(() => setReady(pictureFilesReady())),
                  },
                  { text: 'Cancel', style: 'cancel' },
                ],
              )
            }
          />
        </Section>
      ) : (
        <Section title="Download">
          {d.busy ? (
            <>
              <ProgressBar fraction={d.fraction} label="Downloading the picture model" />
              <AppText variant="bodySmall" tone="muted">
                {d.text}
              </AppText>
            </>
          ) : (
            <Button
              title={`Agree and download (${SIZE_GB} GB)`}
              variant="filled"
              onPress={() => void downloadPictureModel()}
            />
          )}
          {d.error ? <AppText tone="danger">{d.error}</AppText> : null}
          <AppText variant="bodySmall" tone="muted">
            By downloading you agree to the terms below. Large downloads wait for Wi-Fi unless you
            allowed mobile data.
          </AppText>
        </Section>
      )}
      <Section title="Terms">
        <MarkdownView md={PICTURE_TERMS_MD} skipTitle />
      </Section>
    </Page>
  );
}
