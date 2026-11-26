// Submits the iPhone app for App Store review: attaches the newest processed build to the version in
// "Prepare for Submission" and sends it. Usage: ASC_ENV_FILE=~/pocket_animals/frontend/fastlane/.env node scripts/asc-submit.mjs
// (or set ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 in CI). Version texts: store.config.json (eas metadata:push).
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Key from the environment (ASC_KEY_ID, ASC_ISSUER_ID, and ASC_KEY_P8 or ASC_KEY_PATH), or from a fastlane
// .env file given as ASC_ENV_FILE (the team key Pocket Animals uses). Never printed.
let env = process.env;
if (env.ASC_ENV_FILE) {
  const dir = path.dirname(env.ASC_ENV_FILE);
  const file = Object.fromEntries(
    fs
      .readFileSync(env.ASC_ENV_FILE, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [
          l.slice(0, i).trim(),
          l
            .slice(i + 1)
            .trim()
            .replace(/^"|"$/g, ''),
        ];
      }),
  );
  env = { ...file, ASC_KEY_PATH: path.resolve(dir, file.ASC_KEY_PATH) };
}
const privateKeyPem = env.ASC_KEY_P8 || fs.readFileSync(env.ASC_KEY_PATH, 'utf8'); // gitleaks:allow (variable name, not a key)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const un =
  b64({ alg: 'ES256', kid: env.ASC_KEY_ID, typ: 'JWT' }) +
  '.' +
  b64({ iss: env.ASC_ISSUER_ID, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' });
const jwt =
  un +
  '.' +
  crypto
    .sign('sha256', Buffer.from(un), { key: privateKeyPem, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
async function api(method, p, body) {
  const r = await fetch('https://api.appstoreconnect.apple.com' + p, {
    method,
    headers: { authorization: 'Bearer ' + jwt, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = t;
  }
  if (!r.ok) {
    console.log(method, p, r.status, JSON.stringify(j).slice(0, 800));
    throw new Error('api');
  }
  return j;
}
const APP = '6838426860';

await api('PATCH', `/v1/apps/${APP}`, {
  data: {
    type: 'apps',
    id: APP,
    attributes: { contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT' },
  },
});
console.log('content rights set');
// Attach the newest processed build to the version being prepared.
const b = (
  await api(
    'GET',
    `/v1/builds?filter[app]=${APP}&filter[processingState]=VALID&sort=-uploadedDate&limit=1`,
  )
).data[0];
const v = (
  await api(
    'GET',
    `/v1/apps/${APP}/appStoreVersions?filter[platform]=IOS&filter[appStoreState]=PREPARE_FOR_SUBMISSION`,
  )
).data[0];
await api('PATCH', `/v1/appStoreVersions/${v.id}/relationships/build`, {
  data: { type: 'builds', id: b.id },
});
console.log('attached build', b.attributes.version);
const open = (
  await api(
    'GET',
    `/v1/reviewSubmissions?filter[app]=${APP}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW`,
  )
).data;
console.log('open drafts', open.length);
let rs = open[0];
if (!rs)
  rs = (
    await api('POST', '/v1/reviewSubmissions', {
      data: {
        type: 'reviewSubmissions',
        attributes: { platform: 'IOS' },
        relationships: { app: { data: { type: 'apps', id: APP } } },
      },
    })
  ).data;
await api('POST', '/v1/reviewSubmissionItems', {
  data: {
    type: 'reviewSubmissionItems',
    relationships: {
      reviewSubmission: { data: { type: 'reviewSubmissions', id: rs.id } },
      appStoreVersion: { data: { type: 'appStoreVersions', id: v.id } },
    },
  },
});
const done = await api('PATCH', `/v1/reviewSubmissions/${rs.id}`, {
  data: { type: 'reviewSubmissions', id: rs.id, attributes: { submitted: true } },
});
console.log('submitted; state', done.data.attributes.state);
