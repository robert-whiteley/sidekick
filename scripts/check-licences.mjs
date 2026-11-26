#!/usr/bin/env node
// Every package the app ships (npm, non-dev, with everything it pulls in) has a commercial-safe
// licence, and every direct dependency (npm and the native module's Gradle libraries) is named in
// THIRD_PARTY_NOTICES.md. Silent when fine. Runs in the commit hook and CI.
import { readFileSync, existsSync } from 'node:fs';

const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'Python-2.0',
  'CC-BY-4.0',
  'Zlib',
  'OFL-1.1',
  'MPL-2.0',
]);
// Names in the notices that cover a package under another wording.
const ALIASES = {
  expo: 'Expo',
  react: 'React',
  'react-dom': 'React',
  'react-native': 'React Native',
  'litertlm-android': 'LiteRT-LM',
  'commons-compress': 'Apache Commons Compress',
  'core-ktx': 'AndroidX Core',
  'react-android': 'React Native',
  'camera-core': 'CameraX',
  'camera-camera2': 'CameraX',
  'camera-lifecycle': 'CameraX',
  core: 'ZXing',
  'work-runtime-ktx': 'WorkManager',
  'play-services-auth': 'play-services-auth',
};

const read = (p) => readFileSync(p, 'utf8');
const notices = read('THIRD_PARTY_NOTICES.md').toLowerCase();
const problems = [];

// An SPDX expression passes if any OR branch has only allowed licences.
const ok = (expr) =>
  !!expr &&
  expr
    .replace(/[()]/g, '')
    .split(/\s+OR\s+/i)
    .some((branch) => branch.split(/\s+AND\s+/i).every((l) => ALLOWED.has(l.trim())));

const lock = JSON.parse(read('package-lock.json'));
for (const [path, info] of Object.entries(lock.packages ?? {})) {
  if (!path || info.dev || !path.includes('node_modules/')) continue;
  let lic = info.license;
  if (!lic && existsSync(`${path}/package.json`))
    lic = JSON.parse(read(`${path}/package.json`)).license;
  if (typeof lic === 'object' && lic) lic = lic.type;
  if (!ok(lic))
    problems.push(
      `${path.replace(/.*node_modules\//, '')}: licence "${lic ?? 'none'}" is not on the commercial-safe list`,
    );
}

const named = (name) =>
  notices.includes(name.toLowerCase()) ||
  (ALIASES[name] && notices.includes(ALIASES[name].toLowerCase()));
for (const name of Object.keys(JSON.parse(read('package.json')).dependencies ?? {}))
  if (!named(name)) problems.push(`${name}: add it (with its licence) to THIRD_PARTY_NOTICES.md`);

const gradle = 'modules/sidekick-native/android/build.gradle';
if (existsSync(gradle))
  for (const m of read(gradle).matchAll(
    /^\s*(?:implementation|api)\s*\(?\s*["']([^:"']+):([^:"']+)/gm,
  ))
    if (!named(m[2]))
      problems.push(
        `${m[1]}:${m[2]} (Gradle): add it (with its licence) to THIRD_PARTY_NOTICES.md`,
      );

if (problems.length) {
  console.error('✗ licences:\n  ' + problems.join('\n  '));
  process.exit(1);
}
