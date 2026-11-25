// Release helper for the in-app changelog (src/content/changelog.ts) and Play "What's new".
//   node scripts/changelog.mjs add <version> <notes.txt> [--dry-run]
//       New entry at the top of changelog.ts (one line of notes.txt per item; "- " optional)
//       and app.json "version" set to <version>.
//   node scripts/changelog.mjs play <versionCode> [--dry-run]
//       Writes the newest entry to fastlane/metadata/android/en-GB/changelogs/<versionCode>.txt
//       (Play limit 500 characters) and default.txt.
//   node scripts/changelog.mjs top        Prints the newest entry's version.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = join(root, 'src/content/changelog.ts');
const APP = join(root, 'app.json');
const PLAY = join(root, 'fastlane/metadata/android/en-GB/changelogs');
const MARKER = '  // NEXT ENTRY (scripts/changelog.mjs inserts here)\n';
const PLAY_MAX = 500;

const [cmd, arg, notesPath] = process.argv.slice(2);
const dry = process.argv.includes('--dry-run');
const write = (path, text) => {
  if (dry) console.log(`[dry-run] would write ${path.replace(root + '/', '')}:\n${text}`);
  else writeFileSync(path, text);
};

async function entries() {
  // Node strips the type annotations; changelog.ts has no imports.
  return (await import(pathToFileURL(LOG).href)).CHANGELOG;
}

function playText(entry) {
  const lines = [];
  for (const item of entry.items) {
    if ([...lines, `• ${item}`].join('\n').length > PLAY_MAX) break;
    lines.push(`• ${item}`);
  }
  return lines.join('\n') + '\n';
}

if (cmd === 'add') {
  if (!/^\d+\.\d+\.\d+$/.test(arg ?? '') || !notesPath) {
    console.error('usage: add <x.y.z> <notes.txt>');
    process.exit(2);
  }
  const items = readFileSync(notesPath, 'utf8')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean);
  if (!items.length) throw new Error('notes file is empty');
  const log = await entries();
  if (log.some((e) => e.version === arg)) throw new Error(`${arg} is already in changelog.ts`);
  const src = readFileSync(LOG, 'utf8');
  if (!src.includes(MARKER)) throw new Error('marker line missing in changelog.ts');
  const date = new Date().toISOString().slice(0, 10);
  const entry =
    `  {\n    version: ${JSON.stringify(arg)},\n    date: ${JSON.stringify(date)},\n    items: [\n` +
    items.map((i) => `      ${JSON.stringify(i)},\n`).join('') +
    '    ],\n  },\n';
  write(LOG, src.replace(MARKER, MARKER + entry));
  const app = JSON.parse(readFileSync(APP, 'utf8'));
  app.expo.version = arg;
  write(APP, JSON.stringify(app, null, 2) + '\n');
} else if (cmd === 'play') {
  if (!/^\d+$/.test(arg ?? '')) {
    console.error('usage: play <versionCode>');
    process.exit(2);
  }
  const text = playText((await entries())[0]);
  write(join(PLAY, `${arg}.txt`), text);
  write(join(PLAY, 'default.txt'), text);
} else if (cmd === 'top') {
  console.log((await entries())[0].version);
} else {
  console.error('usage: changelog.mjs add|play|top …');
  process.exit(2);
}
