#!/usr/bin/env node
// Silent store check: App Store review, TestFlight processing, the release workflow run and the
// Google Play tracks. Does nothing unless .claude/store-pending.json (git-ignored) says something
// is outstanding; then prints only what changed or is wrong, and deletes the file once everything
// outstanding is approved or live. Offline or a missing key: prints nothing. Run by the
// SessionStart hook in .claude/settings.json.
//
//   node scripts/store-status.mjs                       check (silent when nothing changed)
//   node scripts/store-status.mjs --watch ios-review    after submitting for App Store review
//   node scripts/store-status.mjs --watch build --run <GitHub run id>
//                                                       after starting release.yml (both stores)
//   node scripts/store-status.mjs --watch play          after an Android-only Play upload
//   node scripts/store-status.mjs --show                print the full current state
//
// Keys, never printed or copied: the App Store Connect key from ASC_ENV_FILE (a fastlane .env)
// or ASC_KEY_* variables; the Play service account from GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
// ./google-service-account.json (as eas.json uses), or the sibling project's copy.
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MARKER = path.join(ROOT, '.claude/store-pending.json');
const SIBLING = path.join(os.homedir(), 'pocket_animals/frontend');
const PACKAGE = 'app.ondevice.sidekick';
const REPO = 'robert-whiteley/sidekick';
const DAY = 24 * 3600 * 1000;

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? (args[i + 1] ?? '') : null;
};

const readMarker = () => {
  try {
    return JSON.parse(fs.readFileSync(MARKER, 'utf8'));
  } catch {
    return null;
  }
};
const writeMarker = (m) => fs.writeFileSync(MARKER, JSON.stringify(m, null, 2) + '\n');

// ---------- --watch: add an outstanding item ----------
const watch = flag('--watch');
if (watch !== null) {
  const m = readMarker() ?? { since: new Date().toISOString(), watch: {}, last: {} };
  if (watch === 'ios-review') m.watch.iosReview = true;
  else if (watch === 'build') {
    m.watch.build = { run: flag('--run') || null, startedAt: new Date().toISOString() };
    m.watch.iosReview ??= false;
  } else if (watch === 'play') m.watch.play = true;
  else {
    console.error('usage: --watch ios-review | --watch build --run <id> | --watch play');
    process.exit(2);
  }
  writeMarker(m);
  process.exit(0);
}

const show = args.includes('--show');
const marker = readMarker();
if (!marker && !show) process.exit(0);

// ---------- App Store Connect ----------
if (!process.env.ASC_ENV_FILE && !process.env.ASC_KEY_ID) {
  const f = path.join(SIBLING, 'fastlane/.env');
  if (fs.existsSync(f)) process.env.ASC_ENV_FILE = f;
}

async function apple() {
  const { api, APP } = await import('./asc-api.mjs');
  const v = (await api('GET', `/v1/apps/${APP}/appStoreVersions?filter[platform]=IOS&limit=1`))
    .data[0];
  const b = (await api('GET', `/v1/builds?filter[app]=${APP}&sort=-uploadedDate&limit=1`)).data[0];
  return {
    version: v ? `${v.attributes.versionString} ${v.attributes.appStoreState}` : 'none',
    approved: !!v && APPROVED.has(v.attributes.appStoreState),
    rejected: !!v && REJECTED.has(v.attributes.appStoreState),
    build: b ? `${b.attributes.version} ${b.attributes.processingState}` : 'none',
    buildUploaded: b?.attributes.uploadedDate ?? null,
    buildValid: b?.attributes.processingState === 'VALID',
    buildBad: b ? ['FAILED', 'INVALID'].includes(b.attributes.processingState) : false,
  };
}
const APPROVED = new Set([
  'READY_FOR_SALE',
  'PENDING_DEVELOPER_RELEASE',
  'PROCESSING_FOR_DISTRIBUTION',
  'PENDING_APPLE_RELEASE',
  'READY_FOR_DISTRIBUTION',
]);
const REJECTED = new Set(['REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY']);

// ---------- Google Play (Android Publisher API) ----------
function playKeyFile() {
  const c = [
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
    path.join(ROOT, 'google-service-account.json'),
    path.join(SIBLING, 'google-service-account.json'),
  ];
  return c.find((f) => f && fs.existsSync(f));
}

async function play() {
  const file = playKeyFile();
  if (!file) return null;
  const key = JSON.parse(fs.readFileSync(file, 'utf8'));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const un =
    b64({ alg: 'RS256', typ: 'JWT' }) +
    '.' +
    b64({
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 600,
    });
  const assertion =
    un + '.' + crypto.sign('sha256', Buffer.from(un), key.private_key).toString('base64url');
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(20000),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error('Play: no access token');
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/edits`;
  const call = async (method, p = '') => {
    const r = await fetch(base + p, {
      method,
      headers: { authorization: 'Bearer ' + tok.access_token },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`Play ${method} ${r.status}`);
    return r.status === 204 ? null : r.json();
  };
  const edit = await call('POST');
  try {
    const { tracks = [] } = await call('GET', `/${edit.id}/tracks`);
    const out = {};
    for (const t of tracks)
      for (const r of t.releases ?? [])
        (out[t.track] ??= []).push(`${(r.versionCodes ?? []).join(',')} ${r.status}`);
    return out;
  } finally {
    await call('DELETE', `/${edit.id}`).catch(() => {});
  }
}

// ---------- The release workflow run ----------
function run(id) {
  if (!id) return null;
  try {
    const j = JSON.parse(
      execFileSync(
        'gh',
        ['run', 'view', String(id), '--repo', REPO, '--json', 'status,conclusion'],
        { timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] },
      ).toString(),
    );
    return {
      state: j.conclusion || j.status,
      done: j.status === 'completed',
      ok: j.conclusion === 'success',
    };
  } catch {
    return null;
  }
}

// ---------- Check ----------
// Each store on its own: a missing key or an outage for one still reports the other.
const [a, p] = await Promise.all([apple().catch(() => null), play().catch(() => null)]);
if (!a && !p) process.exit(0); // offline, or no key on this machine: say nothing
const now = { apple: a, play: p, run: run(marker?.watch?.build?.run) };

if (show) {
  console.log(JSON.stringify(now, null, 2));
  if (!marker) process.exit(0);
}

const w = marker.watch ?? {};
const last = marker.last ?? {};
const lines = [];
const changed = (k, v) => JSON.stringify(last[k]) !== JSON.stringify(v);

if (now.apple && changed('version', now.apple.version))
  lines.push(`App Store: version ${now.apple.version}`);
if (now.apple && changed('build', now.apple.build))
  lines.push(`TestFlight: newest build ${now.apple.build}`);
if (now.run && changed('run', now.run.state))
  lines.push(`Release run ${w.build.run}: ${now.run.state}`);
if (now.play && changed('play', now.play))
  lines.push(
    'Google Play: ' +
      Object.entries(now.play)
        .map(([t, rs]) => `${t} [${rs.join('; ')}]`)
        .join(', '),
  );

// Problems that haven't changed are repeated once a day.
const problems = [];
if (w.iosReview && now.apple?.rejected) problems.push(`App Store review: ${now.apple.version}`);
if (now.apple?.buildBad) problems.push(`TestFlight: build ${now.apple.build}`);
if (now.run?.done && !now.run.ok) problems.push(`Release run ${w.build.run} ${now.run.state}`);
if (problems.length && !lines.length && Date.now() - (marker.nagAt ?? 0) > DAY)
  lines.push(...problems.map((p) => 'Still: ' + p));

// Done when the review is approved, the build is processed and no Play draft is waiting. Without
// the App Store key (a cloud check with only the Play key) Apple's side is never called done.
const buildDone =
  !w.build ||
  ((now.run ? now.run.done && now.run.ok : true) &&
    !!now.apple?.buildValid &&
    !!now.apple.buildUploaded &&
    new Date(now.apple.buildUploaded) > new Date(w.build.startedAt));
const reviewDone = !w.iosReview || !!now.apple?.approved;
// Play uploads land as drafts; outstanding until the owner rolls them out (Play then reviews).
const playDone =
  !(w.build || w.play) ||
  !now.play ||
  !Object.values(now.play)
    .flat()
    .some((r) => r.endsWith(' draft'));

if (buildDone && reviewDone && playDone) {
  fs.rmSync(MARKER, { force: true });
  lines.push('Store: nothing outstanding any more (store-status stops checking).');
} else {
  writeMarker({
    ...marker,
    last: {
      version: now.apple?.version ?? last.version,
      build: now.apple?.build ?? last.build,
      run: now.run?.state,
      play: now.play,
    },
    nagAt: lines.length ? Date.now() : marker.nagAt,
  });
}
if (lines.length) console.log(lines.join('\n'));
