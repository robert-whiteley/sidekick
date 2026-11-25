#!/usr/bin/env bash
# Blocks anything personal or generated from entering the public repo. Runs in the pre-commit
# hook (staged files) and in CI (every tracked file), so a miss on one machine is caught on push.
#   scripts/check-privacy.sh            # all tracked files
#   scripts/check-privacy.sh --staged   # staged files only
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [ "${1:-}" = "--staged" ]; then
  files=$(git diff --cached --name-only --diff-filter=ACMR)
else
  files=$(git ls-files)
fi
[ -z "$files" ] && exit 0
fail=0

# 1. Generated, binary or secret files never belong in the repo.
bad_paths=$(echo "$files" | grep -E \
  '(^|/)(build|\.gradle|\.cxx|\.kotlin|node_modules|\.expo|coverage)/|\.(apk|aab|keystore|jks|p12|p8|pem|key|wav|mp4|ogg)$|(^|/)(google-service-account\.json|local\.properties|client_secret[^/]*\.json|\.env)$' \
  | grep -vE '^assets/' || true)
if [ -n "$bad_paths" ]; then
  echo "✗ generated/secret files must not be committed:" >&2
  echo "$bad_paths" | head -20 >&2
  fail=1
fi

# 2. Large files (models, recordings) stay out; assets are reviewed by hand.
while IFS= read -r f; do
  [ -f "$f" ] || continue
  size=$(wc -c <"$f")
  if [ "$size" -gt 5000000 ] && ! grep -qxF "$f" .privacy-allow-large 2>/dev/null; then
    echo "✗ $f is $((size / 1000000)) MB (over 5 MB; add it to .privacy-allow-large if intended)" >&2
    fail=1
  fi
done <<<"$files"

# 3. Personal details in text: home folders, private IPs, emails other than the public ones.
text=$(echo "$files" | grep -vE '\.(png|jpg|jpeg|gif|webp|ico|bin|ttf|otf|jar|onnx|tflite|litertlm)$' \
  | grep -vE '^(package-lock\.json|scripts/check-privacy\.sh)$' \
  | grep -vxFf <(grep -v '^#' .privacy-allow-files 2>/dev/null || true) || true)
if [ -n "$text" ]; then
  # shellcheck disable=SC2086
  hits=$(echo "$text" | tr '\n' '\0' | xargs -0 grep -nIE \
    -e '/home/[a-z_][a-z0-9_-]+/' \
    -e '/Users/[A-Za-z][A-Za-z0-9._-]+/' \
    -e '[Cc]:\\\\?Users\\\\?[A-Za-z]' \
    -e '/mnt/c/Users/' \
    -e '\b(192\.168|10\.[0-9]{1,3})\.[0-9]{1,3}\.[0-9]{1,3}\b' \
    -e '[A-Za-z0-9._%+-]+@(gmail|googlemail|outlook|hotmail|yahoo|icloud)\.com' \
    2>/dev/null | grep -v 'privacy-allow' || true)
  if [ -n "$hits" ]; then
    echo "✗ personal details found (home paths, private IPs or personal emails):" >&2
    echo "$hits" | head -20 >&2
    echo "  (if a line is a harmless example, add 'privacy-allow' to it)" >&2
    fail=1
  fi
fi

[ "$fail" -eq 0 ] && echo "✓ privacy check passed"
exit "$fail"
