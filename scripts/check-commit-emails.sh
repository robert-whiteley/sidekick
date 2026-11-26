#!/usr/bin/env bash
# Commits in this public repo carry only GitHub noreply addresses (no personal email in history).
#   scripts/check-commit-emails.sh            # the commit about to be made (commit hook)
#   scripts/check-commit-emails.sh --history  # every commit (CI)
# Silent when fine.
set -euo pipefail
ok='(@users\.noreply\.github\.com|^noreply@github\.com|^noreply@anthropic\.com)$'

if [ "${1:-}" = "--history" ]; then
  bad=$({
    git log --format='%ae%n%ce'
    git log --format='%(trailers:key=Co-authored-by,valueonly)' | sed -nE 's/.*<([^>]+)>.*/\1/p'
  } | sort -u | grep -vE "$ok" || true)
  if [ -n "$bad" ]; then
    echo "✗ commits with non-noreply emails (author, committer or Co-authored-by):" >&2
    echo "$bad" | head -20 >&2
    exit 1
  fi
  exit 0
fi

for who in GIT_AUTHOR_IDENT GIT_COMMITTER_IDENT; do
  email=$(git var "$who" | sed -E 's/.*<([^>]*)>.*/\1/')
  if ! grep -qE "$ok" <<<"$email"; then
    echo "✗ commit email must be the GitHub noreply address (git -c user.email=<id>+<user>@users.noreply.github.com commit)" >&2
    exit 1
  fi
done
