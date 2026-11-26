#!/usr/bin/env bash
# Claude Code PreToolUse hook (Bash). Store builds go only through the release workflow (both stores
# from one commit), and starting it always shows the owner an approval prompt in the chat.
# Matches only actual calls (start of a command, or after npx/bunx), not text in messages.
cmd=$(jq -r '.tool_input.command // empty')
start='(^|[;&|(]|\n|&&)[[:space:]]*'
eas="${start}((npx|bunx)[[:space:]]+(-y[[:space:]]+)?)?eas(-cli(@[^[:space:]]*)?)?[[:space:]]+(build|submit)([[:space:]]|$)"
if grep -qzE "$eas" <<<"$cmd" && ! grep -qE -- '--profile[ =](development|preview)([[:space:]]|$)' <<<"$cmd"; then
  echo "Blocked: store builds go through 'gh workflow run release.yml -f track=alpha' (both stores from one commit). Phone test builds: local gradle or --profile preview." >&2
  exit 2
fi
if grep -qzE "${start}gh[[:space:]]+workflow[[:space:]]+run[[:space:]]+release(\.yml)?([[:space:]]|$)" <<<"$cmd"; then
  jq -n '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask",
    permissionDecisionReason: "Store build for Google Play and the App Store: needs the owner'"'"'s OK."}}'
  exit 0
fi
exit 0
