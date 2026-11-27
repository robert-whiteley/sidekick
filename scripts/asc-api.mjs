// App Store Connect API access shared by asc-submit.mjs, asc-review-notes.mjs and store-status.mjs.
// Key from the environment (ASC_KEY_ID, ASC_ISSUER_ID, and ASC_KEY_P8 or ASC_KEY_PATH), or from a
// fastlane .env file given as ASC_ENV_FILE (the team key Pocket Animals uses). Never printed.
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const APP = '6838426860';

function readEnv() {
  const env = process.env;
  if (!env.ASC_ENV_FILE) return env;
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
  return { ...file, ASC_KEY_PATH: path.resolve(dir, file.ASC_KEY_PATH) };
}

let jwt;
function token() {
  if (jwt) return jwt;
  const env = readEnv();
  const privateKeyPem = env.ASC_KEY_P8 || fs.readFileSync(env.ASC_KEY_PATH, 'utf8'); // gitleaks:allow (variable name, not a key)
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const un =
    b64({ alg: 'ES256', kid: env.ASC_KEY_ID, typ: 'JWT' }) +
    '.' +
    b64({ iss: env.ASC_ISSUER_ID, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' });
  jwt =
    un +
    '.' +
    crypto
      .sign('sha256', Buffer.from(un), { key: privateKeyPem, dsaEncoding: 'ieee-p1363' })
      .toString('base64url');
  return jwt;
}

/** Calls the API; throws with Apple's error text (never the token) when the call fails. */
export async function api(method, p, body) {
  const r = await fetch('https://api.appstoreconnect.apple.com' + p, {
    method,
    headers: { authorization: 'Bearer ' + token(), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = t;
  }
  if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${JSON.stringify(j).slice(0, 800)}`);
  return j;
}
