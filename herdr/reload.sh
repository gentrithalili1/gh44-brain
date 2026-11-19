#!/bin/sh
# Herdr's hot reload does not follow the symlinks into this repo.
# Check the mods, then switch layouts away and back so they load fresh.
set -e
for mod in hub gh44-herdr-tabs auto-title; do herdr-app check "$HOME/.config/herdr-app/mods/$mod"; done
herdr-app do layout.switch '{"name":"main"}' >/dev/null
herdr-app do layout.switch '{"name":"gh44-herdr"}' >/dev/null
echo "reloaded"
