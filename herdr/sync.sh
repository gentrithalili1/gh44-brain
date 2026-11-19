#!/usr/bin/env bash
# Copies the live Herdr setup into this folder: the gh44-herdr layout, keys and settings.
# Run after any change in ~/.config/herdr-app, then commit.
# Warns about mod folders that neither this repo nor plugins.txt knows about.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
LAYOUT=gh44-herdr
EXTRA_LAYOUTS=""
# Mods install.sh builds itself, so they need no recording.
BUILT_MODS="gh44-files"

# The home folder is recorded as $HOME, so the setup works for any user; install.sh fills it in.
copy_without_home() {
  sed -E "s#$HOME([/\"])#\$HOME\1#g" "$1" > "$2"
}

mkdir -p "$HERE/layouts"
copy_without_home "$APP_HOME/layouts/$LAYOUT.json" "$HERE/layouts/$LAYOUT.json"
for extra in $EXTRA_LAYOUTS; do copy_without_home "$APP_HOME/layouts/$extra.json" "$HERE/layouts/$extra.json"; done
copy_without_home "$APP_HOME/keys.json" "$HERE/keys.json"
copy_without_home "$APP_HOME/settings.json" "$HERE/settings.json"
echo "synced: layouts/$LAYOUT.json $EXTRA_LAYOUTS keys.json settings.json"

shipped=$(jq -r 'keys[]' "$APP_HOME/installed.json")
prefixes=$(awk '!/^[[:space:]]*#/ && NF { print $2 }' "$HERE/plugins.txt")
copied=$(awk '!/^[[:space:]]*#/ && NF { print $3 }' "$HERE/mods.txt")
unknown=()
for dir in "$APP_HOME"/mods/*/; do
  name=$(basename "$dir")
  [ -L "${dir%/}" ] && continue
  grep -qxF "$name" <<< "$shipped" && continue
  grep -qxF "$name" <<< "$(tr ' ' '\n' <<< "$BUILT_MODS")" && continue
  grep -qxF "$name" <<< "$copied" && continue
  match=
  for prefix in $prefixes; do
    case $name in "$prefix" | "$prefix"-*) match=1 ;; esac
  done
  [ -n "$match" ] || unknown+=("$name")
done
if [ "${#unknown[@]}" -gt 0 ]; then
  echo "not recorded: ${unknown[*]}" >&2
  echo "  your own mod: move it to herdr/mods/ and run install.sh to link it" >&2
  echo "  a plugin: add its repo to plugins.txt" >&2
  echo "  a mod without an installer: add <owner/repo> <folder> <name> to mods.txt" >&2
  exit 1
fi
