/**
 * "Copy error details": a few lines the owner can paste into a message when something fails, so
 * the fault can be found without the phone. No personal content: only where it failed, the
 * error's code, its message and stack with quoted text, numbers longer than a year, paths, links
 * and email addresses taken out, and the app, phone and model versions. Pure; tested in
 * __tests__/error-details-test.ts.
 */

export type ErrorEnv = {
  app: string;
  build: string;
  os: string;
  osVersion: string;
  device: string;
  ramMb: number;
  chatModel: string;
  modelLoaded: boolean;
};

const MAX_MESSAGE = 400;
const MAX_STACK_LINES = 12;

/** Takes out anything that could be the user's own words or files. */
export function scrub(text: string): string {
  return (
    text
      // Quoted text: SQL values, the model's or the user's words.
      .replace(/'[^'\n]*'/g, "'…'")
      .replace(/"[^"\n]*"/g, '"…"')
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
      .replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, '<link>')
      // A path keeps only its file name (folders can carry names).
      .replace(/(?:\/[^\s/:()]+)+\/([^\s/:()]+)/g, '…/$1')
      // Long numbers (phone numbers, ids); line:column numbers and codes stay.
      .replace(/\d{5,}/g, '#')
  );
}

export function errorDetails(
  where: string,
  error: unknown,
  env: ErrorEnv,
  now: Date = new Date(),
): string {
  const e = error instanceof Error ? error : null;
  const code = (error as { code?: unknown } | null)?.code;
  const message = scrub(e ? e.message : String(error)).slice(0, MAX_MESSAGE);
  const stack = (e?.stack ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith(e?.name ?? 'Error'))
    .slice(0, MAX_STACK_LINES)
    .map((l) => `  ${scrub(l)}`);
  return [
    'Sidekick error details',
    `Where: ${where}`,
    `When: ${now.toISOString()}`,
    `Error: ${e?.name ?? typeof error}${code !== undefined ? ` (code ${String(code)})` : ''}`,
    `Message: ${message}`,
    ...(stack.length ? ['Stack:', ...stack] : []),
    `App: ${env.app} (${env.build})`,
    `Phone: ${env.device}, ${env.os} ${env.osVersion}, ${Math.round(env.ramMb / 1024)} GB`,
    `Chat model: ${env.chatModel}${env.modelLoaded ? ', loaded' : ', not loaded'}`,
  ].join('\n');
}
