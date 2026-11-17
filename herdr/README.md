# Herdr

My setup for the [Herdr app](https://herdr.dev): the `gh44-herdr` layout, keys, settings, my own mods and the third-party mods I use. Installing gh44-brain does not touch Herdr; run `install.sh` here when you want this setup.

## Install

With the Herdr app open:

```sh
./install.sh
```

It:

1. Copies the `gh44-dark` and `gh44-light` Herdr themes from your `gh44-theme` repo (`gh44-theme/herdr/`). Clone it next to `gh44-brain`, or this step is skipped. The layout picks `gh44-dark` for dark mode and `paper` for light.
2. Links the mods in `mods/` into `~/.config/herdr-app/mods`, so edits here are live. Then builds `gh44-files`: a fresh clone of Herdr's `files` panel with the gh44 code colors from `gh44-theme/herdr/gh44-syntax.js`.
3. Copies `keys.json`, `settings.json` and `layouts/gh44-herdr.json`, and switches to the layout. A different existing file is kept as `<name>.bak-<time>`.
4. Runs the installer of every mod in `plugins.txt`.
5. Installs [herdr-annotator](https://github.com/jakub-tucek/herdr-annotator) (code review) from a clone at `../../herdr-annotator`, cloned if missing, and puts it in the Changes slot. Needs `cargo` (`brew install rust`).
6. Fails if `herdr-app status` reports errors.

Safe to run again. It replaces your keys and settings with mine.

## What's here

| Path | What |
|---|---|
| `layouts/gh44-herdr.json` | The layout, with its theme, panel widths and the plugins' changes |
| `keys.json`, `settings.json` | Keys and settings |
| `mods/` | My own mods: `hub` (GitHub and Linear work panel), `my-tabs` (tab bar) |
| `plugins.txt` | Mods with their own installer: `<owner/repo> <mod prefix>` |
| `install.sh` | Sets up this machine from the files here |
| `sync.sh` | Copies the live layout, keys and settings back here |
| `reload.sh` | Reloads the linked mods (hot reload does not follow symlinks) |

## Adding a mod

1. Install it into the `gh44-herdr` layout.
2. Record it:
   - your own mod: build it in `mods/<name>` and run `./install.sh` to link it;
   - a mod with its own installer: add `<owner/repo> <mod prefix>` to `plugins.txt`.
3. Run `./sync.sh` until it passes, then commit.

`sync.sh` fails on a mod folder that is neither shipped by Herdr, linked from `mods/`, nor listed in `plugins.txt`.

## Removing a plugin

Run its installer with `--uninstall` (for gitview: `curl -fsSL https://raw.githubusercontent.com/ChmaraX/herdr-gitview/main/install.sh | sh -s -- --app --uninstall`), delete its line from `plugins.txt`, then run `./sync.sh` and commit.
