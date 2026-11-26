#!/usr/bin/env bash
# Installs gh44-brain: links it into ~/.claude and registers its hooks. Safe to run again.
set -euo pipefail

BRAIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
SETTINGS="$CLAUDE_DIR/settings.json"
UPSTREAM="$BRAIN/upstream-skills.txt"
SKILLS_CLI="skills@1.7.2"
STEPS=5
changes=0

# Git Bash copies on `ln -s` by default; ask for real Windows symlinks so the brain stays linked.
windows=false
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*)
    windows=true
    export MSYS=winsymlinks:nativestrict CYGWIN=winsymlinks:nativestrict
    # Git Bash rewrites path-like arguments (/hooks/x.sh) for native programs, so jq gets them as written;
    # only the trailing file argument is turned into a C:/ path jq.exe can open.
    jq() {
      local args=("$@")
      [ "$#" -gt 0 ] && [ -f "${args[$# - 1]}" ] && args[$# - 1]="$(cygpath -m "${args[$# - 1]}")"
      MSYS2_ARG_CONV_EXCL='*' command jq "${args[@]}"
    }
    ;;
esac
# hook_command SCRIPT: the settings.json command for a hook, a C:/ path on Windows.
hook_command() {
  if [ "$windows" = true ]; then
    printf '%q' "$(cygpath -m "$BRAIN/hooks/$1")"
  else
    printf '%q' "$BRAIN/hooks/$1"
  fi
}
# Without Developer Mode or admin, Windows blocks symlinks: folders get junctions and files hard links instead.
# Hard links look like real files, so they are listed here for later runs and uninstall.sh.
HARDLINKS="$CLAUDE_DIR/.gh44-brain-hardlinks"
is_hardlink() { [ "$windows" = true ] && [ -f "$HARDLINKS" ] && grep -Fxq -- "$1" "$HARDLINKS"; }
# linked_to TARGET SOURCE: TARGET already points at SOURCE.
linked_to() {
  if [ -L "$1" ]; then
    [ "$(readlink "$1")" = "$2" ]
  else
    is_hardlink "$1" && [ "$1" -ef "$2" ]
  fi
}

if [ -t 1 ]; then
  bold=$'\033[1m' dim=$'\033[2m' green=$'\033[32m' red=$'\033[31m' reset=$'\033[0m'
else
  bold="" dim="" green="" red="" reset=""
fi
step() { printf '%s[%s/%s]%s %-8s ' "$dim" "$1" "$STEPS" "$reset" "$2"; }
ok() { printf '%s✓%s %s\n' "$green" "$reset" "$1"; }
failed() { printf '%s✗%s %s\n' "$red" "$reset" "$1"; }
changed() { [ "$1" -gt 0 ] && printf ' (%s changed)' "$1" || true; }

printf '\n%sgh44-brain%s %s· Gentrit'"'"'s personal agent brain%s\n\n' "$bold" "$reset" "$dim" "$reset"

step 1 Tools
missing=()
for tool in jq; do
  command -v "$tool" > /dev/null || missing+=("$tool")
done
if [ "${#missing[@]}" -eq 0 ]; then
  ok "jq"
elif [ "$windows" = true ]; then
  if ! command -v winget > /dev/null; then
    failed "missing ${missing[*]}"
    echo "install: missing ${missing[*]} and winget. Install jq (https://jqlang.org/download) and run this again." >&2
    exit 1
  fi
  winget install --exact --id jqlang.jq --silent --accept-source-agreements --accept-package-agreements > /dev/null 2>&1 || true
  # winget puts jq on the user PATH for new terminals; add that PATH for this run too.
  user_path="$(powershell.exe -NoProfile -Command '[Environment]::GetEnvironmentVariable("Path", "User")' | tr -d '\r')"
  PATH="$PATH:$(cygpath -p "$user_path")"
  if ! command -v jq > /dev/null; then
    failed "could not install ${missing[*]}"
    echo "install: \`winget install jqlang.jq\` failed. Install jq yourself, open a new terminal and run this again." >&2
    exit 1
  fi
  ok "installed ${missing[*]}"
  changes=$((changes + 1))
elif ! command -v brew > /dev/null; then
  failed "missing ${missing[*]}"
  echo "install: missing ${missing[*]}. Install Homebrew (https://brew.sh) and run this again, or install them yourself." >&2
  exit 1
else
  brew install "${missing[@]}" > /dev/null
  ok "installed ${missing[*]}"
  changes=$((changes + 1))
fi

step 2 Lint
if [ "$windows" = true ] && [ -f "$BRAIN/lint/package.json" ] && [ ! -d "$BRAIN/lint/node_modules" ] \
  && ! command -v pnpm > /dev/null && command -v npm > /dev/null; then
  npm install --global pnpm > /dev/null 2>&1 || true
  hash -r
fi
if [ ! -f "$BRAIN/lint/package.json" ]; then
  ok "nothing to install"
elif [ -d "$BRAIN/lint/node_modules" ]; then
  ok "packages ready"
elif command -v pnpm > /dev/null; then
  pnpm install --dir "$BRAIN/lint" --frozen-lockfile > /dev/null
  ok "packages installed"
  changes=$((changes + 1))
else
  failed "skipped, pnpm is missing"
  echo "install: pnpm is missing, so ESLint checks are skipped (install Node and pnpm, then run this again)" >&2
fi

step 3 Links
sources=("$BRAIN/CLAUDE.md" "$BRAIN/rules")
targets=("$CLAUDE_DIR/CLAUDE.md" "$CLAUDE_DIR/rules")
for skill in "$BRAIN"/skills/*/; do
  [ -d "$skill" ] || continue
  skill="${skill%/}"
  sources+=("$skill")
  targets+=("$CLAUDE_DIR/skills/$(basename "$skill")")
done
skill_count=$((${#targets[@]} - 2))
for agent in "$BRAIN"/agents/*.md; do
  [ -f "$agent" ] || continue
  sources+=("$agent")
  targets+=("$CLAUDE_DIR/agents/$(basename "$agent")")
done

# Check every target before linking anything, so a conflict never leaves a half install.
# A link whose target no longer exists (the brain moved) is replaced.
conflicts=()
for i in "${!targets[@]}"; do
  source="${sources[$i]}" target="${targets[$i]}"
  linked_to "$target" "$source" && continue
  if [ -L "$target" ]; then
    [ -e "$target" ] || continue
    conflicts+=("install: $target links to $(readlink "$target"), expected $source")
  elif [ -e "$target" ]; then
    # A hard link from an earlier run that git replaced (pull, checkout) is linked again.
    is_hardlink "$target" && continue
    conflicts+=("install: $target is a real file or folder; move it away first")
  fi
done
if [ "${#conflicts[@]}" -gt 0 ]; then
  failed "${#conflicts[@]} in the way"
  printf '%s\n' "${conflicts[@]}" >&2
  exit 1
fi

# Windows only creates symlinks with Developer Mode on (or as admin); otherwise fall back to junctions and hard links.
symlinks=true
if [ "$windows" = true ]; then
  probe="$(mktemp -d)"
  { ln -s "$BRAIN" "$probe/link" 2> /dev/null && [ -L "$probe/link" ]; } || symlinks=false
  rm -rf "$probe"
fi
make_link() {
  if [ "$symlinks" = true ]; then
    ln -s "$1" "$2"
  elif [ -d "$1" ]; then
    cmd //c mklink //J "$(cygpath -w "$2")" "$(cygpath -w "$1")" > /dev/null
  else
    ln "$1" "$2"
  fi
}

mkdir -p "$CLAUDE_DIR/skills" "$CLAUDE_DIR/agents"
linked=0
for i in "${!targets[@]}"; do
  source="${sources[$i]}" target="${targets[$i]}"
  linked_to "$target" "$source" && continue
  if [ -L "$target" ] || is_hardlink "$target"; then
    rm "$target"
  fi
  make_link "$source" "$target"
  linked=$((linked + 1))
done
for link in "$CLAUDE_DIR"/skills/* "$CLAUDE_DIR"/agents/*; do
  [ -L "$link" ] && [ ! -e "$link" ] || continue
  case "$(readlink "$link")" in
    "$BRAIN"/skills/* | "$BRAIN"/agents/*) rm "$link" && linked=$((linked + 1)) ;;
  esac
done
hardlinked=()
if [ "$windows" = true ]; then
  # Drop hard links whose source left the brain, then list the hard links in place now.
  if [ -f "$HARDLINKS" ]; then
    while IFS= read -r old; do
      printf '%s\n' "${targets[@]}" | grep -Fxq -- "$old" && continue
      if [ -f "$old" ] && [ ! -L "$old" ]; then
        rm "$old"
        linked=$((linked + 1))
      fi
    done < "$HARDLINKS"
  fi
  for i in "${!targets[@]}"; do
    target="${targets[$i]}"
    if [ ! -L "$target" ] && [ -f "$target" ] && [ "$target" -ef "${sources[$i]}" ]; then
      hardlinked+=("$target")
    fi
  done
  if [ "${#hardlinked[@]}" -gt 0 ]; then
    printf '%s\n' "${hardlinked[@]}" > "$HARDLINKS"
  else
    rm -f "$HARDLINKS"
  fi
fi
changes=$((changes + linked))
ok "CLAUDE.md, rules, $skill_count skills, $((${#targets[@]} - 2 - skill_count)) agents$(changed "$linked")"
if [ "${#hardlinked[@]}" -gt 0 ]; then
  echo "install: Windows blocked symlinks, so files are hard links. Run this again after git pull, or turn on Developer Mode (Settings > System > For developers) and run it again." >&2
fi

step 4 Upstream
upstream_total=0
missing_upstream=()
manual_upstream=()
if [ -f "$UPSTREAM" ]; then
  while read -r repo skill mode; do
    case "$repo" in "" | "#"*) continue ;; esac
    upstream_total=$((upstream_total + 1))
    [ "$mode" = manual ] && manual_upstream+=("$skill")
    [ -e "$CLAUDE_DIR/skills/$skill" ] || missing_upstream+=("$repo $skill")
  done < "$UPSTREAM"
fi
if [ "${#missing_upstream[@]}" -eq 0 ]; then
  ok "$upstream_total skills"
elif ! command -v npx > /dev/null; then
  failed "skipped, npx is missing"
  echo "install: npx is missing, so the skills in upstream-skills.txt are not installed (install Node, then run this again)" >&2
else
  installed=0 not_installed=0
  for entry in "${missing_upstream[@]}"; do
    read -r repo skill <<< "$entry"
    if npx -y "$SKILLS_CLI" add "$repo" -g -a claude-code --copy -y -s "$skill" > /dev/null 2>&1; then
      installed=$((installed + 1))
    else
      not_installed=$((not_installed + 1))
      echo "install: could not install $skill from $repo (check the network, then run this again)" >&2
    fi
  done
  changes=$((changes + installed))
  if [ "$not_installed" -gt 0 ]; then
    failed "$not_installed of $upstream_total skills not installed"
  else
    ok "$upstream_total skills$(changed "$installed")"
  fi
fi
# Manual skills only run when typed; set again every run, since `npx skills update` restores the original.
for skill in ${manual_upstream[@]+"${manual_upstream[@]}"}; do
  file="$CLAUDE_DIR/skills/$skill/SKILL.md"
  [ -f "$file" ] && [ "$(head -n 1 "$file")" = "---" ] || continue
  grep -qx 'disable-model-invocation: true' "$file" && continue
  awk 'NR == 1 { print; print "disable-model-invocation: true"; front = 1; next }
    front && /^---$/ { front = 0 }
    front && /^disable-model-invocation:/ { next }
    { print }' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
  changes=$((changes + 1))
done

step 5 Hooks
# inbox.md is gitignored, so a fresh clone needs one for capture-corrections to write to.
if [ ! -f "$BRAIN/inbox.md" ]; then
  printf '# Inbox\n\nPaste raw rules, notes and links below the marker. Run `/gh44-learn ingest` to sort them.\n\n<!-- items below -->\n' > "$BRAIN/inbox.md"
  changes=$((changes + 1))
fi
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
added=0
add_hook() {
  local event="$1" script="$2" matcher="${3:-}" command updated
  command="$(hook_command "$script")"
  if jq -e --arg command "$command" '[.. | objects | select(.command? == $command)] | length > 0' "$SETTINGS" > /dev/null; then
    return
  fi
  [ "$added" -gt 0 ] || cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
  # Drop this hook's entry from an earlier brain location before adding the current one.
  updated="$(jq --arg event "$event" --arg command "$command" --arg suffix "/hooks/$script" --arg matcher "$matcher" '
    .hooks[$event] = (
      ((.hooks[$event] // [])
        | map(.hooks |= map(select((.command // "") | endswith($suffix) | not)))
        | map(select(.hooks | length > 0)))
      + [(if $matcher == "" then {} else {matcher: $matcher} end) + {hooks: [{type: "command", command: $command}]}])' "$SETTINGS")"
  printf '%s\n' "$updated" > "$SETTINGS"
  added=$((added + 1))
}
add_hook SessionStart budget-check.sh
add_hook UserPromptSubmit capture-corrections.sh
add_hook UserPromptSubmit mark-turn.sh
add_hook PostToolUse check-code.sh "Edit|Write|MultiEdit"
add_hook Stop check-changed.sh
# Retired hooks: drop their entries so settings never point at a deleted script.
for script in load-structure.sh worktree-keyword.sh; do
  if jq -e --arg suffix "/hooks/$script" '[.. | objects | select((.command? // "") | endswith($suffix))] | length > 0' "$SETTINGS" > /dev/null; then
    [ "$added" -gt 0 ] || cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
    updated="$(jq --arg suffix "/hooks/$script" '.hooks |= with_entries(.value |= (map(.hooks |= map(select((.command // "") | endswith($suffix) | not))) | map(select(.hooks | length > 0)))) | .hooks |= with_entries(select(.value | length > 0))' "$SETTINGS")"
    printf '%s\n' "$updated" > "$SETTINGS"
    added=$((added + 1))
  fi
done
changes=$((changes + added))
ok "5 hooks$(changed "$added")"

if [ "$changes" -eq 0 ]; then
  printf '\n%sUp to date.%s\n\n' "$bold" "$reset"
else
  printf '\n%sDone.%s Open a new Claude Code session to use it.\n\n' "$bold" "$reset"
fi
