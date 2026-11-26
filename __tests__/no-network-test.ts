// Fully on-device: only the listed places may reach the internet, each behind a user switch
// (model downloads, quick fixes, online lookup, the Google connections). A new network call
// fails here until it is added on purpose. Also: no analytics/crash SDKs, quick fixes never
// check on their own.
declare const __dirname: string;
const fs = jest.requireActual<{
  readFileSync: (p: string, e: string) => string;
  readdirSync: (
    p: string,
    o: { withFileTypes: true },
  ) => { name: string; isDirectory: () => boolean }[];
}>('fs');
const root = `${__dirname}/..`;

const ALLOWED = [
  'src/engine/downloads.ts', // model downloads (Wi-Fi only by default)
  'src/engine/quick-fixes.ts', // "Get quick fixes" switch
  'src/web/lookup.ts', // Online lookup (off by default)
  'src/web/page.ts', // Reads a web link the user shared or pasted (that page only)
  'src/web/rate-limit.ts', // Online lookup: the request wrapper (Wikimedia budget, one retry)
  'src/web/research.ts', // Online lookup (off by default): research reads result pages
  'src/web/weather.ts', // Online lookup (off by default)
  'src/integrations/google.ts', // Google connections the user signs in to
  'src/integrations/gmail.ts',
  'src/integrations/google-tasks.ts',
  'src/integrations/drive-backup.ts',
  'modules/sidekick-native/android/src/main/java/dev/sidekick/engine/Downloads.kt', // model downloads
].sort();

const NETWORK =
  /\bfetch\s*\(|[=:,(]\s*fetch\b|typeof fetch\b|XMLHttpRequest|new WebSocket|EventSource|createDownloadResumable|createDownloadTask|downloadFileAsync|uploadAsync|checkForUpdateAsync|fetchUpdateAsync|java\.net\.URL\b|HttpURLConnection|URLSession|OkHttp|\bSocket\(/;

function files(dir: string): string[] {
  return fs.readdirSync(`${root}/${dir}`, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return ['vendor', 'build', '.cxx', 'cpp'].includes(e.name) ? [] : files(p);
    return /\.(ts|tsx|kt|java|swift)$/.test(e.name) ? [p] : [];
  });
}
const code = (p: string) =>
  fs
    .readFileSync(`${root}/${p}`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('no network by default', () => {
  it('only the allowed files reach the internet', () => {
    const using = [...files('src'), ...files('modules/sidekick-native')]
      .filter((p) => NETWORK.test(code(p)))
      .sort();
    expect(using).toEqual(ALLOWED);
  });

  it('has no analytics, tracking or crash-reporting SDKs', () => {
    const lock = JSON.parse(fs.readFileSync(`${root}/package-lock.json`, 'utf8'));
    const names = Object.keys(lock.packages).map((p) => p.replace(/.*node_modules\//, ''));
    const telemetry = names.filter((n) =>
      /(^|[/@-])(sentry|firebase|amplitude|segment|mixpanel|posthog|bugsnag|datadog|newrelic|appcenter|instabug|logrocket|expo-insights|embrace|branch-sdk|appsflyer|adjust)([/-]|$)/i.test(
        n,
      ),
    );
    expect(telemetry).toEqual([]);
  });

  it('quick fixes never check on their own', () => {
    const app = JSON.parse(fs.readFileSync(`${root}/app.json`, 'utf8'));
    expect(app.expo.updates?.checkAutomatically ?? 'NEVER').toBe('NEVER');
  });
});
