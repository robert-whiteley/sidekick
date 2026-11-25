#!/usr/bin/env bash
# Sidekick release to Google Play. Dry run by default: prints what it would do and changes
# nothing outside the checks. Add --real to actually bump, build, upload or promote.
#
#   scripts/release.sh check                                   tsc, eslint, jest, store text, secrets
#   scripts/release.sh bump --version 1.0.1 --notes notes.txt  changelog entry + app.json version
#   scripts/release.sh ship [--track internal]                 check, EAS cloud build, eas submit,
#                                                              Play "What's new" for that build
#   scripts/release.sh metadata [--images]                     listing text (and images) to Play
#   scripts/release.sh promote --from internal --to alpha [--rollout 0.2]
#                                                              move a release between tracks
#
# Tracks: internal, alpha (closed testing), beta (open testing), production. Every upload lands
# as a draft on the internal track unless --track says otherwise; promotion is a separate step.
# Flow and owner steps: docs/RELEASE.md. Needs ./google-service-account.json (gitignored) for
# submit/metadata/promote, and `bundle install` (fastlane) for metadata/promote/changelogs.
set -euo pipefail
cd "$(dirname "$0")/.."

export NODE_NO_WARNINGS=1
REAL=0 CMD="${1:-}" VERSION="" NOTES="" TRACK="internal" FROM="" TO="" ROLLOUT="" IMAGES=0
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --real) REAL=1 ;;
    --version) VERSION="$2"; shift ;;
    --notes) NOTES="$2"; shift ;;
    --track) TRACK="$2"; shift ;;
    --from) FROM="$2"; shift ;;
    --to) TO="$2"; shift ;;
    --rollout) ROLLOUT="$2"; shift ;;
    --images) IMAGES=1 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

KEY=./google-service-account.json
say() { printf '\n== %s\n' "$*"; }
# Side-effect commands go through run: printed in a dry run, executed with --real.
run() {
  if [[ $REAL == 1 ]]; then echo "+ $*"; "$@"; else echo "[dry-run] $*"; fi
}
need_key() {
  git check-ignore -q "$KEY" || { echo "$KEY must be gitignored" >&2; exit 1; }
  if [[ $REAL == 1 && ! -f $KEY ]]; then
    echo "Missing $KEY (Play service-account key; see docs/RELEASE.md)" >&2; exit 1
  fi
}
valid_track() {
  case "$1" in internal|alpha|beta|production) ;; *) echo "bad track: $1" >&2; exit 2 ;; esac
}
# eas.json submit profiles, one per track (all upload as drafts).
submit_profile() {
  case "$1" in internal) echo production ;; alpha) echo closed ;; beta) echo open ;; production) echo store ;; esac
}

check() {
  say "Checks"
  if git ls-files --error-unmatch "$KEY" google-services.json .env local.properties >/dev/null 2>&1; then
    echo "A secret file is tracked by git" >&2; exit 1
  fi
  if git ls-files | grep -E '\.(jks|keystore|p12|pem)$' >/dev/null; then
    echo "A key/keystore file is tracked by git" >&2; exit 1
  fi
  node scripts/build-legal.mjs >/dev/null
  git diff --quiet -- src/content/legal.ts || echo "note: src/content/legal.ts refreshed from the docs; commit it"
  npx tsc --noEmit
  npx expo lint
  npx jest --silent
  node scripts/check-store-text.mjs
  grep -q '"checkAutomatically": "NEVER"' app.json || { echo "app.json: updates must not check automatically" >&2; exit 1; }
}

case "$CMD" in
  check)
    check
    ;;

  bump)
    [[ -n $VERSION && -f $NOTES ]] || { echo "bump needs --version x.y.z --notes file" >&2; exit 2; }
    say "Changelog $VERSION"
    if [[ $REAL == 1 ]]; then
      node scripts/changelog.mjs add "$VERSION" "$NOTES"
      npx prettier --write src/content/changelog.ts app.json >/dev/null
      echo "Now commit the version bump, merge it, and run: scripts/release.sh ship --real"
    else
      node scripts/changelog.mjs add "$VERSION" "$NOTES" --dry-run
    fi
    ;;

  ship)
    valid_track "$TRACK"; need_key; check
    say "Release $(node scripts/changelog.mjs top) → Play $TRACK (draft)"
    APP_VERSION=$(node -p "require('./app.json').expo.version")
    [[ $(node scripts/changelog.mjs top) == "$APP_VERSION" ]] || {
      echo "changelog.ts has no entry for $APP_VERSION; run bump first" >&2; exit 1; }
    if [[ $REAL == 1 && -n $(git status --porcelain) ]]; then
      echo "Working tree not clean; commit first so the build matches git" >&2; exit 1
    fi
    if [[ $REAL == 1 ]]; then
      echo "+ eas build (cloud; waits for the build)"
      OUT=$(npx eas-cli build -p android --profile production --non-interactive --wait --json)
      BUILD_ID=$(node -e 'const b=JSON.parse(process.argv[1])[0];console.log(b.id)' "$OUT")
      CODE=$(node -e 'const b=JSON.parse(process.argv[1])[0];console.log(b.appBuildVersion)' "$OUT")
      echo "build $BUILD_ID, versionCode $CODE"
    else
      echo "[dry-run] npx eas-cli build -p android --profile production --non-interactive --wait --json"
      BUILD_ID="<build id>" CODE="<versionCode>"
    fi
    run npx eas-cli submit -p android --profile "$(submit_profile "$TRACK")" --id "$BUILD_ID" --non-interactive --wait
    say "Play \"What's new\" for versionCode $CODE"
    if [[ $REAL == 1 ]]; then
      node scripts/changelog.mjs play "$CODE"
      node scripts/check-store-text.mjs
    else
      echo "[dry-run] node scripts/changelog.mjs play $CODE"
    fi
    run bundle exec fastlane android upload_to_track track:"$TRACK" version_code:"$CODE" status:draft
    [[ $REAL == 1 ]] && echo "Uploaded as a draft. Review and roll it out in Play Console, or: scripts/release.sh promote …"
    ;;

  metadata)
    need_key
    node scripts/check-store-text.mjs
    if [[ $IMAGES == 1 ]]; then
      ls fastlane/metadata/android/en-GB/images/icon.png fastlane/metadata/android/en-GB/images/featureGraphic.png >/dev/null \
        || { echo "Store images missing (fastlane/IMAGES.md)" >&2; exit 1; }
      export UPLOAD_IMAGES=1
    fi
    run bundle exec fastlane android upload_metadata
    ;;

  promote)
    [[ -n $FROM && -n $TO ]] || { echo "promote needs --from and --to" >&2; exit 2; }
    valid_track "$FROM"; valid_track "$TO"; need_key
    ARGS=(from:"$FROM" to:"$TO")
    [[ -n $ROLLOUT ]] && ARGS+=(rollout:"$ROLLOUT")
    run bundle exec fastlane android promote "${ARGS[@]}"
    ;;

  *)
    sed -n '2,16p' "$0"; exit 2
    ;;
esac

[[ $REAL == 1 ]] || printf '\nDry run: nothing was changed. Add --real to do it.\n'
