// Sends the iPhone app to App Store review: sets the App Review notes (docs/store/app-review-notes.txt,
// with the screen-recording link filled in), attaches the newest processed build to the version being
// prepared (or the rejected one), and submits it (a resubmission after a rejection too).
//
//   ASC_ENV_FILE=~/pocket_animals/frontend/fastlane/.env node scripts/asc-submit.mjs --video <link>
//       notes with the link, newest build, submit (or resubmit)
//   ... --notes-only [--video <link>]   only set the notes
//   ... --attach-only [--video <link>]  set the notes and attach the newest build; no submit
//   ... --build <number>                that build instead of the newest (e.g. the one recorded on)
//
// Key: ASC_ENV_FILE (a fastlane .env), or ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_P8 / ASC_KEY_PATH in CI.
// Never printed. Version texts: store.config.json (eas metadata:push).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { api, APP } from './asc-api.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const video = opt('--video');
const notesOnly = args.includes('--notes-only');
const attachOnly = args.includes('--attach-only');
const buildNumber = opt('--build');
if (video !== undefined && !/^https:\/\/\S+$/.test(video)) {
  console.error('--video needs an https link');
  process.exit(2);
}
if (!notesOnly && !attachOnly && !video) {
  console.error(
    'Submitting needs the screen-recording link: --video <https link> (Apple asked for it)',
  );
  process.exit(2);
}

// Notes: Apple's limit for App Review notes is 4,000 characters.
const PLACEHOLDER = '{{RECORDING_LINK}}';
const notes = fs
  .readFileSync(path.join(ROOT, 'docs/store/app-review-notes.txt'), 'utf8')
  .trim()
  .replace(PLACEHOLDER, video ?? '[link to be added before resubmitting]');
if (notes.length > 4000) throw new Error(`review notes are ${notes.length} characters (max 4000)`);

// The version: being prepared, or rejected and waiting for a resubmission.
const EDITABLE = [
  'PREPARE_FOR_SUBMISSION',
  'REJECTED',
  'METADATA_REJECTED',
  'DEVELOPER_REJECTED',
  'INVALID_BINARY',
];
const v = (
  await api(
    'GET',
    `/v1/apps/${APP}/appStoreVersions?filter[platform]=IOS&filter[appStoreState]=${EDITABLE.join(',')}&include=appStoreReviewDetail,build`,
  )
).data[0];
if (!v) throw new Error('no iOS version is being prepared or waiting after a rejection');
console.log('version', v.attributes.versionString, v.attributes.appStoreState);

const rd = v.relationships.appStoreReviewDetail?.data;
if (rd)
  await api('PATCH', `/v1/appStoreReviewDetails/${rd.id}`, {
    data: { type: 'appStoreReviewDetails', id: rd.id, attributes: { notes } },
  });
else
  await api('POST', '/v1/appStoreReviewDetails', {
    data: {
      type: 'appStoreReviewDetails',
      attributes: { notes, demoAccountRequired: false },
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: v.id } } },
    },
  });
console.log(
  `review notes set (${notes.length} characters${video ? ', with the recording link' : ', link still to add'})`,
);
if (notesOnly) process.exit(0);

await api('PATCH', `/v1/apps/${APP}`, {
  data: {
    type: 'apps',
    id: APP,
    attributes: { contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT' },
  },
});

// Attach the newest processed build, or the one given with --build.
const b = (
  await api(
    'GET',
    `/v1/builds?filter[app]=${APP}&filter[processingState]=VALID&filter[expired]=false&filter[preReleaseVersion.platform]=IOS${buildNumber ? `&filter[version]=${encodeURIComponent(buildNumber)}` : ''}&sort=-uploadedDate&limit=1`,
  )
).data[0];
if (!b) throw new Error(`no processed build ${buildNumber ?? ''} in TestFlight`);
if (b.attributes.usesNonExemptEncryption === null)
  console.log('note: build', b.attributes.version, 'has no export-compliance answer yet');
if (v.relationships.build?.data?.id !== b.id)
  await api('PATCH', `/v1/appStoreVersions/${v.id}/relationships/build`, {
    data: { type: 'builds', id: b.id },
  });
console.log('build', b.attributes.version, 'attached');
if (attachOnly) process.exit(0);

// Submit. After a rejection the old submission (UNRESOLVED_ISSUES) is sent again; otherwise a
// draft submission gets the version and is sent.
const subs = (
  await api('GET', `/v1/reviewSubmissions?filter[app]=${APP}&filter[platform]=IOS&include=items`)
).data;
const submit = async (rs) =>
  (
    await api('PATCH', `/v1/reviewSubmissions/${rs.id}`, {
      data: { type: 'reviewSubmissions', id: rs.id, attributes: { submitted: true } },
    })
  ).data.attributes.state;

let state;
const unresolved = subs.find((s) => s.attributes.state === 'UNRESOLVED_ISSUES');
if (unresolved) {
  try {
    state = await submit(unresolved);
    console.log('resubmitted the rejected submission');
  } catch (e) {
    console.log(
      'resubmitting the old submission failed, using a new one:',
      e.message.slice(0, 300),
    );
  }
}
if (!state) {
  let rs = subs.find((s) => s.attributes.state === 'READY_FOR_REVIEW');
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
  if (!rs.relationships?.items?.data?.length)
    await api('POST', '/v1/reviewSubmissionItems', {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: rs.id } },
          appStoreVersion: { data: { type: 'appStoreVersions', id: v.id } },
        },
      },
    });
  state = await submit(rs);
}
console.log('submitted; state', state);

// The SessionStart store check reports the review result.
try {
  execFileSync(process.execPath, [
    path.join(ROOT, 'scripts/store-status.mjs'),
    '--watch',
    'ios-review',
  ]);
} catch {
  /* the check is a convenience */
}
