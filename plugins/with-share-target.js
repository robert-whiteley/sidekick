// Share into Sidekick: text, links, images, PDFs, documents and recordings from any app's share
// sheet open the chat with them (read by PhoneExtras.noteIntent; JS: src/engine/share-in.ts).
// Adds ACTION_SEND intent filters to the main activity.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const SEND = 'android.intent.action.SEND';
// Text and links, pictures, PDFs, text documents and audio recordings (voice memos, meetings).
const TYPES = ['text/*', 'image/*', 'application/pdf', 'audio/*'];

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
