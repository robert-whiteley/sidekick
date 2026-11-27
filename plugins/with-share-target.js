// Share into Sidekick: text, links, images, documents, recordings, videos and other files from any app's share
// sheet open the chat with them (read by PhoneExtras.noteIntent; JS: src/engine/share-in.ts).
// Adds ACTION_SEND intent filters to the main activity.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const SEND = 'android.intent.action.SEND';
// Text and links, pictures, documents, spreadsheets, recordings, videos and any other file
// (src/files reads what it can and says plainly what the rest is). */* catches apps that send a
// file with no type.
const TYPES = ['text/*', 'image/*', 'application/*', 'audio/*', 'video/*', '*/*'];

module.exports = function withShareTarget(config) {
  return withAndroidManifest(config, (c) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(c.modResults);
    const filters = (activity['intent-filter'] || []).filter(
      (f) => !(f.action || []).some((a) => a.$['android:name'] === SEND),
    );
    for (const type of TYPES) {
      filters.push({
        action: [{ $: { 'android:name': SEND } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
        data: [{ $: { 'android:mimeType': type } }],
      });
    }
    activity['intent-filter'] = filters;
    return c;
  });
};
