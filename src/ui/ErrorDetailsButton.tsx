import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';

import { TextButton } from './Button';

/**
 * "Copy error details" under an error: puts the details (no personal content; see
 * src/engine/error-details-logic.ts) on the clipboard, to paste into a message.
 */
export function ErrorDetailsButton(props: { details: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <TextButton
      title={copied ? 'Copied' : 'Copy error details'}
      onPress={() => {
        void Clipboard.setStringAsync(props.details()).then(() => setCopied(true));
      }}
    />
  );
}
