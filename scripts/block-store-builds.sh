#!/usr/bin/env bash
# Claude Code PreToolUse hook (Bash): store builds and uploads only through the release workflow,
# which builds both stores from one commit and waits for the owner's approval in GitHub.
# Matches only an actual EAS build/submit call (start of a command, or after npx/bunx), not text.
cmd=$(jq -r '.tool_input.command // empty')
run='(^|[;&|(]|\n|&&)[[:space:]]*((npx|bunx)[[:space:]]+(-y[[:space:]]+)?)?eas(-cli(@[^[:space:]]*)?)?[[:space:]]+(build|submit)([[:space:]]|$)'
if grep -qzE "$run" <<<"$cmd" && ! grep -qE -- '--profile[ =](development|preview)([[:space:]]|$)' <<<"$cmd"; then
  echo "Blocked: store builds go through 'gh workflow run release.yml -f track=alpha' (both stores, owner approves in GitHub). Phone test builds: local gradle or --profile preview." >&2
  exit 2
fi
exit 0
