// expo-notifications always links Firebase Cloud Messaging (push), even with remote notifications
// off. Sidekick only schedules local reminders and must not talk to Google's push servers, so drop
// the library, its service and the transitive Firebase/Play Services pieces from the Android app.
const {
  withAppBuildGradle,
  withAndroidManifest,
  withDangerousMod,
  AndroidConfig,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const GRADLE_MARK = '// sidekick: without-firebase-messaging';
const GRADLE = `
${GRADLE_MARK}
configurations.all {
    exclude group: 'com.google.firebase', module: 'firebase-messaging'
}
`;

const PROGUARD_MARK = '# sidekick: without-firebase-messaging';
const PROGUARD = `
${PROGUARD_MARK}
# Only expo-notifications' push code refers to these; it never runs (no push service is declared).
-dontwarn com.google.firebase.messaging.**
`;

const REMOVED_SERVICES = ['expo.modules.notifications.service.ExpoFirebaseMessagingService'];

module.exports = function withoutFirebaseMessaging(config) {
  config = withAppBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes(GRADLE_MARK)) c.modResults.contents += GRADLE;
    return c;
  });

  config = withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.service = app.service || [];
    for (const name of REMOVED_SERVICES) {
      if (!app.service.some((s) => s.$['android:name'] === name)) {
        app.service.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
      }
    }
    return c;
  });

  return withDangerousMod(config, [
    'android',
    (c) => {
      const file = path.join(c.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (!text.includes(PROGUARD_MARK)) fs.writeFileSync(file, text + PROGUARD);
      return c;
    },
  ]);
};
