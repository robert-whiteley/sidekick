#!/usr/bin/env bash
# Claude Code PreToolUse hook: no auto-loaded rule files (CLAUDE.md, AGENTS.md, ...) in this repo.
# Rules live in docs/RULES.md (searched when needed); checkable ones are scripts.
path=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
case "$(basename "$path")" in
  CLAUDE.md | CLAUDE.local.md | AGENTS.md | AGENT.md | GEMINI.md)
    echo "Blocked: no auto-loaded rule files here. Put rules in docs/RULES.md or a check script." >&2
    exit 2 ;;
esac
exit 0
