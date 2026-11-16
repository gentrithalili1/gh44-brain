# Herdr

- Install a Herdr mod into the `gh44-herdr` layout.
- After any change in `~/.config/herdr-app` (a layout, keys, settings or a mod), record it in `gh44-brain/herdr`, so `herdr/install.sh` rebuilds the same setup on a new machine:
  - Own mod: build it in `herdr/mods/<name>`; `install.sh` links it.
  - Mod with its own installer: add `<owner/repo> <mod prefix>` to `herdr/plugins.txt`.
  - Run `herdr/sync.sh` until it passes, then commit and push.
