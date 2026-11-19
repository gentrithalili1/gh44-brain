# Herdr

- Install a Herdr mod into the `gh44-herdr` layout.
- After any change in `~/.config/herdr-app` (a layout, keys, settings or a mod), record it in the `gh44-herdr` repo (beside gh44-brain), so its `install.sh` rebuilds the same setup on a new machine:
  - Own mod: build it in `mods/<name>`; `install.sh` links it.
  - Mod with its own installer: add `<owner/repo> <mod prefix>` to `plugins.txt`.
  - Run `sync.sh` until it passes, then commit and push.
