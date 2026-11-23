import SidekickNative from '../../modules/sidekick-native';

/** Big re-downloadable model files (app-private external storage when available). */
export function modelsDir(): string {
  const d = SidekickNative.getDeviceInfo();
  return `${d.externalFilesDir ?? d.filesDir}/models`;
}

/** Personal data (photos, audio, database) — always internal, app-private storage. */
export function dataDir(): string {
  return `${SidekickNative.getDeviceInfo().filesDir}/data`;
}
