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
3. Copies every mod in `mods.txt` fresh from its GitHub repo (`main` branch unless the line names another).
4. Copies `keys.json`, `settings.json` and `layouts/gh44-herdr.json`, and switches to the layout. A different existing file is kept as `<name>.bak-<time>`.
5. Runs the installer of every mod in `plugins.txt`, then puts `tabbed-changes` back in the Changes slot.
6. Fails if `herdr-app status` reports errors.

Safe to run again. It replaces your keys and settings with mine.

## What's here

| Path | What |
|---|---|
| `layouts/gh44-herdr.json` | The layout, with its theme, panel widths and the plugins' changes |
| `keys.json`, `settings.json` | Keys and settings |
| `mods/` | My own mods: `hub` (GitHub and Linear work panel), `gh44-herdr-tabs` (tab bar), `auto-title` (names tabs; its popup on `cmd-alt-t` installs the herdr-auto-title service, from kryptamine/herdr-auto-title) |
| `plugins.txt` | Mods with their own installer: `<owner/repo> <mod prefix>` |
| `mods.txt` | Mods without an installer, copied from GitHub: `<owner/repo> <folder> <name> [branch]`. Now `tabbed-changes`, `revive` and `herdr-folders` |
| `install.sh` | Sets up this machine from the files here |
| `sync.sh` | Copies the live layout, keys and settings back here |
| `reload.sh` | Reloads the linked mods (hot reload does not follow symlinks) |

## Adding a mod

1. Install it into the `gh44-herdr` layout.
2. Record it:
   - your own mod: build it in `mods/<name>` and run `./install.sh` to link it;
   - a mod with its own installer: add `<owner/repo> <mod prefix>` to `plugins.txt`;
   - a mod without an installer: add `<owner/repo> <folder in the repo> <mod name>` to `mods.txt`.
3. Run `./sync.sh` until it passes, then commit.

`sync.sh` fails on a mod folder that is neither shipped by Herdr, linked from `mods/`, nor listed in `plugins.txt` or `mods.txt`.

## Removing a plugin

Run its installer with `--uninstall` (`curl -fsSL https://raw.githubusercontent.com/<owner/repo>/main/install.sh | sh -s -- --app --uninstall`), delete its line from `plugins.txt`, then run `./sync.sh` and commit.
