#!/usr/bin/env bash
# Start of every Claude Code session (.claude/settings.json SessionStart), on the laptop or in a
# cloud container. Never fails the session: every step is optional and the exit code is always 0.
#   1. brings main up to date (fast-forward only);
#   2. cloud (CLAUDE_CODE_REMOTE=true): installs the packages when node_modules is missing or
#      package-lock.json changed since the last install;
#   3. the silent store check when a store build or review is outstanding (scripts/store-status.mjs).
cd "$(dirname "$0")/.." 2>/dev/null || exit 0

timeout 15 git fetch -q origin 2>/dev/null
git merge --ff-only -q origin/main 2>/dev/null

# Node from PATH (cloud images, CI); on a laptop without it on PATH, the newest nvm one.
if ! command -v node >/dev/null 2>&1; then
  nvm_bin=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | tail -1)
  [ -n "$nvm_bin" ] && PATH="$nvm_bin:$PATH"
fi
command -v node >/dev/null 2>&1 || exit 0

if [ "${CLAUDE_CODE_REMOTE:-}" = true ] && [ -f package-lock.json ]; then
  stamp=node_modules/.sidekick-lock-sha
  sum=$(sha256sum package-lock.json 2>/dev/null | cut -d' ' -f1)
  if [ -n "$sum" ] && [ "$(cat "$stamp" 2>/dev/null)" != "$sum" ]; then
    if timeout 480 npm ci --no-audit --no-fund >/tmp/sidekick-npm-ci.log 2>&1; then
      echo "$sum" >"$stamp"
    else
      echo "npm ci failed (log: /tmp/sidekick-npm-ci.log); run it before the checks."
    fi
  fi
fi

[ -f .claude/store-pending.json ] && timeout 60 node scripts/store-status.mjs 2>/dev/null
exit 0
