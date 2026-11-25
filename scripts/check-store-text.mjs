// Checks Google Play listing text against Play's limits (characters, trailing newline ignored).
//   node scripts/check-store-text.mjs        exit 1 if anything is too long or empty
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = join(root, 'fastlane/metadata/android');
const LIMITS = { 'title.txt': 30, 'short_description.txt': 80, 'full_description.txt': 4000 };
const CHANGELOG_MAX = 500;

let bad = 0;
const check = (path, max) => {
  const text = readFileSync(path, 'utf8').replace(/\n+$/, '');
  const n = [...text].length;
  const ok = n > 0 && n <= max;
  if (!ok) bad++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${String(n).padStart(4)}/${max}  ${path.replace(root + '/', '')}`,
  );
};

for (const locale of readdirSync(base)) {
  const dir = join(base, locale);
  for (const [file, max] of Object.entries(LIMITS)) {
    const p = join(dir, file);
    if (existsSync(p)) check(p, max);
    else {
      bad++;
      console.log(`FAIL missing  ${p.replace(root + '/', '')}`);
    }
  }
  const logs = join(dir, 'changelogs');
  if (existsSync(logs))
    for (const f of readdirSync(logs).filter((f) => f.endsWith('.txt')))
      check(join(logs, f), CHANGELOG_MAX);
}
process.exit(bad ? 1 : 0);
