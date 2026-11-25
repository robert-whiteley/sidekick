// USB (UVC) cameras: when one is plugged in, Android offers to open Sidekick and, if the user
// ticks "always", remembers the permission (no dialog next time). Adds the attach intent filter
// and the device filter (modules/sidekick-native res/xml/sidekick_usb_camera_filter.xml) to the
// main activity.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const ACTION = 'android.hardware.usb.action.USB_DEVICE_ATTACHED';

module.exports = function withUsbCamera(config) {
  return withAndroidManifest(config, (c) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(c.modResults);
    activity['intent-filter'] = activity['intent-filter'] || [];
    const has = activity['intent-filter'].some((f) =>
      (f.action || []).some((a) => a.$['android:name'] === ACTION),
    );
    if (!has) activity['intent-filter'].push({ action: [{ $: { 'android:name': ACTION } }] });
    activity['meta-data'] = (activity['meta-data'] || []).filter(
      (m) => m.$['android:name'] !== ACTION,
    );
    activity['meta-data'].push({
      $: { 'android:name': ACTION, 'android:resource': '@xml/sidekick_usb_camera_filter' },
    });
    return c;
  });
};
