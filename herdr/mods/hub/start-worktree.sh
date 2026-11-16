#!/usr/bin/env bash
# First tab of a ticket's worktree space, which Herdr's New worktree dialog created and
# opened in the worktree. With --prepare, make it runnable with gh44's prepare-worktree.sh
# (env files, dependencies; gh44 itself is not changed), then start Claude.
# Usage: start-worktree.sh <claude prompt> [--prepare]
set -u

prompt="$1"
worktree="$PWD"
# The main checkout: the folder holding the shared .git.
main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

if [ "${2:-}" = "--prepare" ]; then
  prepare="$(dirname "$(readlink "$HOME/.claude/CLAUDE.md")")/hooks/prepare-worktree.sh"
  if [ -x "$prepare" ]; then
    "$prepare" "$worktree" "$main" || echo "→ setup failed; Claude starts anyway"
  else
    echo "→ gh44 prepare-worktree.sh not found; skipping setup"
  fi
fi

exec claude "$prompt"
