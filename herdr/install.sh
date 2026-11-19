#!/usr/bin/env bash
# Sets up the Herdr app as recorded here: gh44 themes, own mods, gh44-files, the mods in mods.txt,
# keys, settings, the gh44-herdr layout and every plugin in plugins.txt. Safe to run again.
# The Herdr app must be open.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
THEME_REPO="$HERE/../../gh44-theme"
LAYOUT=gh44-herdr
# Other layouts, kept beside the main one; ctrl-shift-l switches to them.
EXTRA_LAYOUTS="gh44-herdr-groups"
STAMP=$(date +%Y%m%d-%H%M%S)

die() { echo "herdr: $*" >&2; exit 1; }

command -v herdr-app > /dev/null || die "herdr-app is not on PATH; install the Herdr app first"
command -v jq > /dev/null || die "jq is missing (brew install jq)"
herdr-app status > /dev/null 2>&1 || die "open the Herdr app first"

# A file that differs from ours is kept aside, never lost.
place() {
  local source=$1 target=$2
  if [ -f "$target" ] && ! cmp -s "$source" "$target"; then
    mv "$target" "$target.bak-$STAMP"
    echo "kept old $(basename "$target") as $(basename "$target").bak-$STAMP"
  fi
  cp "$source" "$target"
}

# 1. Themes, from the gh44-theme checkout beside gh44-brain.
if [ -d "$THEME_REPO/herdr" ]; then
  mkdir -p "$APP_HOME/themes"
  for theme in "$THEME_REPO"/herdr/*.json; do place "$theme" "$APP_HOME/themes/$(basename "$theme")"; done
  echo "themes: copied from gh44-theme"
else
  echo "themes: skipped, clone gh44-theme next to gh44-brain and run this again" >&2
fi

# 2. Own mods, linked so edits here are live.
for mod in "$HERE"/mods/*/; do
  mod="${mod%/}" target="$APP_HOME/mods/$(basename "$mod")"
  if [ -L "$target" ]; then
    [ "$(readlink "$target")" = "$mod" ] && continue
    rm "$target"
  elif [ -e "$target" ]; then
    die "$target exists and is not a link to this repo; move it away first"
  fi
  ln -s "$mod" "$target"
  herdr-app check "$target" > /dev/null || die "herdr-app check failed for $(basename "$mod")"
done
echo "mods: $(cd "$HERE/mods" && ls -d */ | tr -d / | tr '\n' ' ')"

# 2b. gh44-files: Herdr's files panel with gh44 code colors, rebuilt from the shipped
# mod on every run so it follows upstream. Without gh44-theme it keeps Herdr's colors.
FILES_MOD="$APP_HOME/mods/gh44-files"
rm -rf "$FILES_MOD"
herdr-app do mod.clone '{"name":"files","as":"gh44-files"}' > /dev/null || die "could not clone the files mod"
if [ -f "$THEME_REPO/herdr/gh44-syntax.js" ]; then
  cp "$THEME_REPO/herdr/gh44-syntax.js" "$FILES_MOD/"
  sed -i '' -e '1a\
import { gh44Syntax } from "./gh44-syntax.js";' -e 's/syntax: { keyword: t.ansi5/syntax: gh44Syntax(t) ?? { keyword: t.ansi5/' "$FILES_MOD/main.js"
  grep -q 'gh44Syntax(t)' "$FILES_MOD/main.js" || die "gh44-files: the files mod changed, update the patch in install.sh"
  echo "gh44-files: files panel with gh44 code colors"
else
  echo "gh44-files: Herdr's code colors, clone gh44-theme next to gh44-brain for gh44 ones" >&2
fi
herdr-app check "$FILES_MOD" > /dev/null || die "herdr-app check failed for gh44-files"

# 2c. Third-party mods without an installer (mods.txt), copied fresh from GitHub on every run.
awk '!/^[[:space:]]*#/ && NF' "$HERE/mods.txt" | while read -r repo path name branch; do
  tmp=$(mktemp -d)
  curl -fsSL "https://codeload.github.com/$repo/tar.gz/${branch:-main}" | tar -xz -C "$tmp" || die "could not download $repo"
  source=$(find "$tmp" -mindepth 1 -maxdepth 1 -type d)/$path
  [ -d "$source" ] || die "$repo has no $path"
  rm -rf "${APP_HOME:?}/mods/$name"
  cp -R "$source" "$APP_HOME/mods/$name"
  rm -rf "$tmp"
  herdr-app check "$APP_HOME/mods/$name" > /dev/null || die "herdr-app check failed for $name"
  echo "mod: $name from $repo"
done

# 2d. Revive remembers agent sessions through hooks in Claude, Codex and the shell's rc file.
# Its install is safe to run again.
if [ -f "$APP_HOME/mods/revive/revive.mjs" ]; then
  command -v node > /dev/null || die "node is missing; Revive needs it for its hooks"
  node "$APP_HOME/mods/revive/revive.mjs" install > /dev/null || die "revive: hook install failed"
  echo "revive: hooks installed"
fi

# 3. Keys, settings and the layout. They write the home folder as $HOME (Herdr does not
# expand ~ or $HOME), so it is filled in here.
place_with_home() {
  local tmp
  tmp=$(mktemp)
  sed "s#\$HOME#$HOME#g" "$1" > "$tmp"
  place "$tmp" "$2"
  rm "$tmp"
}
place_with_home "$HERE/keys.json" "$APP_HOME/keys.json"
place_with_home "$HERE/settings.json" "$APP_HOME/settings.json"
place_with_home "$HERE/layouts/$LAYOUT.json" "$APP_HOME/layouts/$LAYOUT.json"
for extra in $EXTRA_LAYOUTS; do place_with_home "$HERE/layouts/$extra.json" "$APP_HOME/layouts/$extra.json"; done
herdr-app do layout.switch "{\"name\":\"$LAYOUT\"}" > /dev/null
echo "layout: $LAYOUT"

# 4. Plugins. Their installers patch the layout on screen, which is now gh44-herdr.
awk '!/^[[:space:]]*#/ && NF { print $1 }' "$HERE/plugins.txt" | while read -r repo; do
  echo "plugin: $repo"
  curl -fsSL "https://raw.githubusercontent.com/$repo/main/install.sh" | sh -s -- --app
done

# 4b. A plugin above may claim the Changes slot; it shows tabbed-changes.
LAYOUT_FILE="$APP_HOME/layouts/$LAYOUT.json"
jq 'def fix: if type == "object" then (if .id == "changes" and .type == "block" then .content = {"mod": "tabbed-changes"} else . end) | with_entries(.value |= fix) elif type == "array" then map(fix) else . end; fix' \
  "$LAYOUT_FILE" > "$LAYOUT_FILE.tmp"
mv "$LAYOUT_FILE.tmp" "$LAYOUT_FILE"
echo "changes slot: tabbed-changes"

# 5. Nothing left in error.
errors=$(herdr-app status | jq -c '.errors')
[ "$errors" = "[]" ] || die "herdr-app status reports errors: $errors"
for file in "$APP_HOME"/*.error "$APP_HOME"/layouts/*.error; do
  [ -e "$file" ] && die "$(basename "$file"): $(cat "$file")"
done
echo "herdr: done"
