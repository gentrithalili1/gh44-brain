// The items of the menus Folders opens, as data, so `node --test` covers them.
// Pure: no Herdr calls. The space items, their icons, the key hint and the
// arrow keys follow Herdr's "menu" mod v0.1.15 (https://github.com/herdrdev/herdr-app,
// defaults/mods/menu, Apache 2.0; see LICENSE-APACHE and NOTICE). Changed from
// it: the items are objects, and a folder's items are added.
//
// An item: { id, label, command, action?, separated? }. `command` is a Herdr
// command, "worktree" (the worktree dialog, with `action`), or "folder.*" for
// the items folders.js runs itself. `separated` draws a line above it.

const ICONS = "mods/workspace-chrome";

// `git` is "main", "linked" or null: the space's checkout.
export function spaceMenuItems(git) {
  return [
    { id: "space-rename", label: "Rename", command: "space.rename" },
    ...(git
      ? [
          { id: "space-worktree-new", label: "New worktree", command: "worktree", action: "new" },
          { id: "space-worktree-open", label: "Open worktree", command: "worktree", action: "open" },
        ]
      : []),
    ...(git === "linked" ? [{ id: "space-worktree-remove", label: "Remove worktree", command: "worktree", action: "remove" }] : []),
    { id: "space-close", label: "Close", command: "space.close", separated: true },
  ];
}

// `kind` is "folder" or "machine": a machine is Herdr's, so it takes folders only.
export function folderMenuItems(kind) {
  return [
    { id: "folder-new-here", label: "New folder here", command: "folder.new" },
    ...(kind === "folder"
      ? [
          { id: "folder-edit", label: "Edit folder…", command: "folder.edit" },
          { id: "folder-delete", label: "Delete folder", command: "folder.delete", separated: true },
        ]
      : []),
  ];
}

export function iconOf(command) {
  const name = command === "folder.new" ? "folder-plus"
    : command === "folder.edit" ? "square-pen"
    : command === "folder.delete" ? "x"
    : command.endsWith(".close") ? "x"
    : command.endsWith(".rename") ? "square-pen"
    : command.endsWith(".new") ? "plus"
    : command === "worktree" ? "git-branch"
    : "terminal";
  return `${ICONS}/${name}.svg`;
}

// The global key bound to a command, for the hint on the right; `keys` is
// Herdr's keys(). "pane.split:right" binds pane.split with { direction: "right" }.
export function shortcutOf(keys, command, args) {
  const value = args && Object.values(args)[0];
  const bound = keys.find((k) => k.section === "global" && (k.action === command || k.action === `${command}:${value}`));
  return bound ? bound.keys : "";
}

// The item ↑ or ↓ moves to from `at`, wrapping; null for any other key.
export function stepSelection(at, length, key) {
  if (length === 0) return null;
  if (key === "down") return (at + 1) % length;
  if (key === "up") return (at + length - 1) % length;
  return null;
}
