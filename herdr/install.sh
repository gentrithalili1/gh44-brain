#!/usr/bin/env bash
# Sets up the Herdr app as recorded here: gh44 themes, own mods, keys, settings,
# the gh44-herdr layout and every plugin in plugins.txt. Safe to run again.
# The Herdr app must be open.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
THEME_REPO="$HERE/../../gh44-theme"
LAYOUT=gh44-herdr
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

# 3. Keys, settings and the layout.
place "$HERE/keys.json" "$APP_HOME/keys.json"
place "$HERE/settings.json" "$APP_HOME/settings.json"
place "$HERE/layouts/$LAYOUT.json" "$APP_HOME/layouts/$LAYOUT.json"
herdr-app do layout.switch "{\"name\":\"$LAYOUT\"}" > /dev/null
echo "layout: $LAYOUT"

# 4. Plugins. Their installers patch the layout on screen, which is now gh44-herdr.
grep -v '^\s*#' "$HERE/plugins.txt" | awk 'NF { print $1 }' | while read -r repo; do
  echo "plugin: $repo"
  curl -fsSL "https://raw.githubusercontent.com/$repo/main/install.sh" | sh -s -- --app
done

# 5. Nothing left in error.
errors=$(herdr-app status | jq -c '.errors')
[ "$errors" = "[]" ] || die "herdr-app status reports errors: $errors"
for file in "$APP_HOME"/*.error "$APP_HOME"/layouts/*.error; do
  [ -e "$file" ] && die "$(basename "$file"): $(cat "$file")"
done
echo "herdr: done"
