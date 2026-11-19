// Everything folder-shaped that touches Herdr: the saved tree, the folder rows,
// dragging, and the popups and dialog the sidebar opens as overlays of itself.
// The rules for where things may go live in tree.js.
//
// The popup row drawing and key handling (ItemsPopup) are adapted from Herdr's
// "menu" mod v0.1.15 (https://github.com/herdrdev/herdr-app, defaults/mods/menu,
// Apache 2.0; see LICENSE-APACHE and NOTICE). Changed from it: the items are
// objects, and a folder's items are added.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, spaces, openOverlay, closeOverlay, theme, shared, setShared, keys } from "herdr";
import {
  ROOT, DEFAULT_ICON, emptyTree, kindOf, nameOf, machineAt, isFolded, canMove, move, slotNear,
  newSpaceSlot, insertFolder, deleteFolder, updateFolder, setFolded, settle, rowsOf, isHex,
} from "./tree.js";
import { spaceMenuItems, folderMenuItems, iconOf, shortcutOf, stepSelection } from "./menu.js";

const MOD = "herdr-folders";
const STORE_KEY = "herdr-folders";
const PENDING_KEY = "herdr-folders.pending";
const NEW_FOLDER_NAME = "New folder";
const PENDING_SPACE_MS = 60000;
const FOLDER_ROW = 28;
const RAIL_CELL = 32; // as main.js: one cell of the narrow sidebar
const INDENT = 14;
const EDGE = 7; // px at a folder row's top or bottom that drop beside it, not into it
const SPACE_ROW_HALF = 15;
const SWATCHES_PER_ROW = 8;

// Theme names show these muted values on a folder's tile.
const THEME_COLORS = { ansi6: "#399a8f", ansi3: "#c67e57", ansi4: "#5d84cc", ansi5: "#8377cf", ansi2: "#4e9c6b", ansi1: "#bd6790" };

// "No color" shows the theme's dim grey with a cross, so it differs from the greys.
const NO_COLOR = null;

// 32 presets: 8 hues (red, orange, yellow, green, teal, blue, violet, pink)
// in three rows (vibrant, a little muted, more muted), then No color and 7
// greys, light to dark, none so light that the white icon vanishes.
const PRESETS = [
  "#e13e33", "#f86f25", "#eaa918", "#2bbf62", "#0dc6b1", "#2b75fe", "#664ff7", "#e4408e",
  "#ca524a", "#dc7741", "#ce9e34", "#3eac67", "#26ad9e", "#477de2", "#7665e1", "#ce568f",
  "#b8625c", "#c67e57", "#b8964a", "#4e9c6b", "#399a8f", "#5d84cc", "#8377cf", "#bd6790",
  NO_COLOR, "#a6a6a6", "#969696", "#858585", "#757575", "#656565", "#545454", "#444444",
];

const ICONS = ["folder", "layers", "archive", "files", "file-text", "server", "monitor", "terminal", "git-branch", "settings", "pin", "clock"];
const iconPath = (name) => `mods/workspace-chrome/${name}.svg`;

// ---- the saved tree ----

function loadTree() {
  return shared(STORE_KEY) ?? emptyTree();
}

function saveTree(tree) {
  setShared(STORE_KEY, tree);
}

function fillOf(color, t) {
  if (!color) return t.dim;
  if (color.startsWith("#")) return color;
  return THEME_COLORS[color] ?? t[color];
}

// A new folder in `ref`, with its dialog open to name it.
function newFolderIn(ref) {
  const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  saveTree(insertFolder(loadTree(), ref, id, NEW_FOLDER_NAME));
  openEditFolder(id);
}

// ---- opening the overlays ----

function openFolderMenu(key) {
  openOverlay({ mod: MOD, kind: "popup", width: 236, height: 330, props: { folderMenu: key } });
}

// `git` is "main", "linked" or null, for the worktree items.
export function openSpaceMenu(id, git) {
  openOverlay({ mod: MOD, kind: "popup", width: 236, height: 330, props: { spaceMenu: id, git } });
}

function openEditFolder(id) {
  openOverlay({ mod: MOD, kind: "dialog", width: 460, props: { edit: id } });
}

// The view for a copy of the sidebar opened as an overlay, or null for the sidebar itself.
export function overlayFor(props, cx) {
  const p = props ?? {};
  if (p.folderMenu) return new FolderMenu(p.folderMenu, p.overlay, cx);
  if (p.spaceMenu) return new SpaceMenu(p.spaceMenu, p.git, p.overlay, cx);
  if (p.edit) return new EditFolderDialog(p.edit, p.overlay);
  return null;
}

// ---- the sidebar's side: rows, dragging, new spaces ----

export class Folders {
  constructor() {
    this.tree = emptyTree();
    this.known = { spaces: [], machines: [] };
    this.dragged = null; // the key under the pointer since the press
    this.drop = null; // { ref, index, over, side } where a release would put it
  }

  // The draw list for what exists now (see rowsOf). Keeps the settled tree for
  // the folder rows and for aiming a drag.
  nodes(known) {
    this.known = known;
    this.tree = settle(loadTree(), known);
    return rowsOf(this.tree, known);
  }

  foldedMachines() {
    const machines = loadTree().machines;
    return new Set(Object.keys(machines).filter((name) => machines[name].folded));
  }

  toggleFold(key) {
    const tree = loadTree();
    saveTree(setFolded(tree, key, !isFolded(tree, key)));
  }

  unfoldMachine(name) {
    saveTree(setFolded(loadTree(), `machine:${name}`, false));
  }

  newFolderButton(t) {
    return div().id("folder-new").size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => newFolderIn(ROOT))
      .child(svg("mods/workspace-chrome/folder-plus.svg").size(14));
  }

  // ---- new spaces in a folder ----

  // Unfolds the folder so the new space shows. `run` names no id back, so the
  // first space that appears on the folder's machine goes in the folder (see adoptNew).
  newSpaceIn(key) {
    const tree = setFolded(loadTree(), key, false);
    saveTree(tree);
    const machine = machineAt(tree, key);
    const before = spaces().map((s) => s.id);
    const pending = { ref: key, machine, before, until: Date.now() + PENDING_SPACE_MS };
    setShared(PENDING_KEY, pending);
    run("space.new", { machine: machine ?? "" });
  }

  // Called often with the spaces that exist: files the one waiting for a folder.
  adoptNew(current) {
    const pending = shared(PENDING_KEY);
    if (!pending) return;
    if (Date.now() > pending.until) {
      setShared(PENDING_KEY, null);
      return;
    }
    const fresh = current.find((s) => !pending.before.includes(s.id) && (s.machine ?? null) === pending.machine);
    if (!fresh) return;
    setShared(PENDING_KEY, null);
    const tree = loadTree();
    saveTree(move(tree, `space:${fresh.id}`, pending.ref, newSpaceSlot(tree, pending.ref)));
  }

  // ---- rows ----

  // `content` moved `depth` levels in; the narrow sidebar has no indent.
  indent(content, depth, collapsed) {
    return v_flex().pl(collapsed ? 0 : depth * INDENT).child(content);
  }

  folderRow(node, t, collapsed) {
    const id = nameOf(node.key);
    const folder = this.tree.folders[id];
    const tile = h_flex().size(18).flex_none().rounded(5).items_center().justify_center().bg(fillOf(folder.color, t))
      // 12 in 18 leaves 3 px on each side; 11 left 3.5 and the icon sat half a pixel off.
      .child(svg(folder.icon ?? DEFAULT_ICON).size(12).text_color("#ffffff"));
    const row = h_flex().id(`folder-${id}`).h(FOLDER_ROW).flex_none().px(collapsed ? 2 : 8).gap(9).items_center().rounded(8)
      .text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        this.toggleFold(node.key);
        cx.notify();
      });
    // The rail: the tile alone in a cell, named by its tooltip.
    if (collapsed) {
      return h_flex().flex_none().justify_center().child(row.w(RAIL_CELL).px(0).rounded(6).justify_center()
        .tooltip(node.folded ? `${folder.name} (folded)` : folder.name).child(tile));
    }
    return row
      .child(tile)
      .child(div().flex_1().min_w(0).truncate().font_medium().child(folder.name))
      // A drawn plus in a square: the text "+" took the row's line box and was cut at the top.
      .child(h_flex().id(`folder-add-${id}`).size(18).flex_none().items_center().justify_center().rounded(4).text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip("New space in this folder")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.newSpaceIn(node.key);
        }).child(svg("mods/workspace-chrome/plus.svg").size(12)))
      .child(svg(`mods/workspace-chrome/chevron-${node.folded ? "right" : "down"}.svg`).size(11).flex_none().text_color(t.dim));
  }

  // Makes a row of any kind indented, draggable, a drop target, and (for a
  // folder or machine) right-clickable.
  wrap(content, node, t, collapsed) {
    const aimed = this.drop?.over === node.key ? this.drop : null;
    const left = collapsed ? 0 : node.depth * INDENT;
    return v_flex().relative().id(`node-${node.key}`).flex_none()
      .when(aimed?.side === "into", (el) => el.bg(t.selected).rounded(8))
      .when(this.dragged === node.key && this.drop !== null, (el) => el.opacity(0.5))
      .when(aimed?.side === "before", (el) => el.child(this.dropLine(t, left).top(0)))
      .when(aimed?.side === "after", (el) => el.child(this.dropLine(t, left).bottom(0)))
      .on_mouse_down("left", () => this.press(node.key))
      .on_mouse_move((e, cx) => this.hover(node, e, cx))
      .on_mouse_up("left", (_e, cx) => this.release(cx))
      .when(node.kind !== "space", (el) => el.on_mouse_down("right", () => openFolderMenu(node.key)))
      .child(this.indent(content, node.depth, collapsed));
  }

  dropLine(t, left) {
    return div().absolute().left(left).right(0).h(2).bg(t.accent);
  }

  // ---- dragging ----

  press(key) {
    this.dragged = key;
    this.drop = null;
  }

  hover(node, event, cx) {
    if (!this.dragged || node.key === this.dragged) {
      this.aim(null, cx);
      return;
    }
    this.aim(this.dropAt(node, event.local_position?.y ?? 0), cx);
  }

  aim(drop, cx) {
    const same = this.drop?.over === drop?.over && this.drop?.side === drop?.side;
    if (same) return;
    this.drop = drop;
    cx.notify();
  }

  // Where a release over `node` at `y` px down would put the dragged key; null when that is not allowed.
  dropAt(node, y) {
    const tree = this.tree;
    const side = this.sideOf(node, y);
    const ref = side === "into" ? node.key : node.parent;
    if (!canMove(tree, this.dragged, ref)) return null;
    const index = side === "into" ? (tree.children[ref] ?? []).length : slotNear(tree, ref, this.dragged, node.key, side);
    return { ref, index, over: node.key, side };
  }

  // A folder or machine takes a drop in its middle; a space splits in halves.
  sideOf(node, y) {
    if (node.kind === "space") return y < SPACE_ROW_HALF ? "before" : "after";
    if (y < EDGE) return "before";
    const roomAfter = node.folded || node.empty;
    return roomAfter && y > FOLDER_ROW - EDGE ? "after" : "into";
  }

  release(cx) {
    const { dragged, drop } = this;
    this.cancel();
    if (dragged && drop) saveTree(move(settle(loadTree(), this.known), dragged, drop.ref, drop.index));
    cx.notify();
  }

  cancel() {
    this.dragged = null;
    this.drop = null;
  }
}

// ---- shared pieces of the overlays ----

function separator(t) {
  return div().mx(7).my(4).h(1).bg(t.border);
}

// Color dots in rows; `current` has a ring and `pick(color, cx)` runs on a click.
function swatches(t, key, colors, current, pick) {
  const swatch = (color) => div().id(`${key}-color-${color ?? "default"}`).size(20).flex_none().rounded(10).cursor_pointer()
    .flex().items_center().justify_center().text_size(12).text_color(t.popover).child(color === NO_COLOR ? "×" : "")
    .bg(fillOf(color, t)).border_2().border_color(color === current ? t.foreground : t.popover)
    .hover((s) => s.border_color(t.muted))
    .on_click((_e, cx) => pick(color, cx));
  const lines = [];
  for (let at = 0; at < colors.length; at += SWATCHES_PER_ROW) lines.push(colors.slice(at, at + SWATCHES_PER_ROW));
  return v_flex().px(8).pt(6).pb(8).gap(6).children(
    lines.map((line, n) => h_flex().id(`${key}-colors-${n}`).gap(6).items_center().children(line.map(swatch))),
  );
}

// A popup of color swatches over a list of items (menu.js), drawn and driven
// as Herdr's own menu: icons, key hints, ↑/↓ to move, Enter to run, Esc to close.
class ItemsPopup {
  constructor(overlay, cx) {
    this.overlay = overlay;
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(item) {
    closeOverlay(this.overlay);
    this.run(item);
  }

  frame(t, id, items, top) {
    const bound = keys();
    return v_flex().id(id).track_focus(this.handle).size_full().p(5).gap(1).bg(t.popover).text_color(t.foreground).text_size(12.8)
      .on_key_down((e, cx) => {
        const next = stepSelection(this.at, items.length, e.key);
        if (next !== null) this.at = next;
        else if (e.key === "enter") this.choose(items[this.at]);
        else if (e.key === "escape") closeOverlay(this.overlay);
        else return;
        cx.notify();
      })
      .when(Boolean(top), (el) => el.child(top))
      .children(items.map((item, i) => v_flex()
        .when(Boolean(item.separated), (el) => el.child(separator(t)))
        .child(h_flex().id(item.id).h(31).px(8).gap(9).rounded(7).items_center().justify_between().cursor_pointer()
          .text_color(t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click(() => this.choose(item))
          .child(svg(iconOf(item.command)).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().child(item.label))
          .child(div().text_size(11).text_color(t.dim).child(shortcutOf(bound, item.command, item.args))))));
  }
}

// ---- overlay: a folder's or machine's menu ----

class FolderMenu extends ItemsPopup {
  constructor(key, overlay, cx) {
    super(overlay, cx);
    this.key = key;
  }

  run(item) {
    const id = nameOf(this.key);
    if (item.command === "folder.new") newFolderIn(this.key);
    else if (item.command === "folder.edit") openEditFolder(id);
    else if (item.command === "folder.delete") saveTree(deleteFolder(loadTree(), id));
  }

  render() {
    const t = theme();
    const tree = loadTree();
    const id = nameOf(this.key);
    const isFolder = kindOf(this.key) === "folder";
    const paint = (color) => {
      saveTree(updateFolder(loadTree(), id, { color }));
      closeOverlay(this.overlay);
    };
    const colors = isFolder ? swatches(t, "folder", PRESETS, tree.folders[id]?.color ?? null, paint) : null;
    return this.frame(t, "folder-menu", folderMenuItems(kindOf(this.key)), colors);
  }
}

// ---- overlay: a space's menu ----

// Herdr's own space menu has no colors, so this one adds the swatches to its items.
// The sidebar gives a missing color a new one, so "No color" is stored as "dim".
class SpaceMenu extends ItemsPopup {
  constructor(id, git, overlay, cx) {
    super(overlay, cx);
    this.id = id;
    this.git = git;
  }

  run(item) {
    const id = this.id;
    if (item.command !== "worktree") run(item.command, { id });
    else {
      const size = item.action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 };
      openOverlay({ mod: "worktree", kind: "dialog", ...size, props: { space: id, action: item.action } });
    }
  }

  render() {
    const t = theme();
    const id = this.id;
    const stored = (shared("space.colors") ?? {})[id] ?? null;
    const paint = (color) => {
      setShared("space.colors", { ...(shared("space.colors") ?? {}), [id]: color ?? "dim" });
      closeOverlay(this.overlay);
    };
    const items = spaceMenuItems(this.git).map((item) => ({ ...item, args: { id } }));
    return this.frame(t, "space-menu", items, swatches(t, "space", PRESETS, stored === "dim" ? NO_COLOR : stored, paint));
  }
}

// ---- overlay: Edit folder ----

class EditFolderDialog {
  constructor(id, overlay) {
    this.id = id;
    this.overlay = overlay;
    const folder = loadTree().folders[id] ?? { name: NEW_FOLDER_NAME, icon: DEFAULT_ICON, color: null };
    this.icon = folder.icon ?? DEFAULT_ICON;
    this.color = folder.color ?? null;
    this.name = InputState.new({ value: folder.name });
    this.hex = InputState.new({ value: isHex(this.color) ? this.color : "", placeholder: "#rrggbb" });
    this.name.on("submit", () => this.save());
    this.hex.on("change", (_e, cx) => {
      if (!isHex(this.hex.value())) return;
      this.color = this.hex.value();
      cx.notify();
    });
    this.name.set_selected_range({ start: 0, end: folder.name.length });
    this.name.focus();
  }

  save() {
    const tree = loadTree();
    const name = this.name.value().trim() || tree.folders[this.id]?.name;
    saveTree(updateFolder(tree, this.id, { name, icon: this.icon, color: this.color }));
    closeOverlay(this.overlay);
  }

  chooseColor(color, cx) {
    this.color = color;
    this.hex.set_value(isHex(color) ? color : "");
    cx.notify();
  }

  render() {
    const t = theme();
    return v_flex().id("folder-edit").w_full().p(20).gap(16).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        closeOverlay(this.overlay);
        cx.stop_propagation();
      })
      .child(div().text_size(15).font_semibold().child("Edit folder"))
      .child(this.field(t, "Name", Input.new(this.name).w_full().text_size(13).text_color(t.foreground)))
      .child(this.labeled(t, "Icon", this.iconRow(t)))
      .child(this.labeled(t, "Color", swatches(t, "edit", PRESETS, this.color, (color, cx) => this.chooseColor(color, cx))))
      .child(this.hexRow(t))
      .child(h_flex().pt(4).gap(8).justify_end()
        .child(this.button(t, "folder-cancel", "Cancel", false, () => closeOverlay(this.overlay)))
        .child(this.button(t, "folder-save", "Save", true, () => this.save())));
  }

  labeled(t, label, content) {
    return v_flex().gap(6).child(div().text_size(12).font_medium().text_color(t.muted).child(label)).child(content);
  }

  field(t, label, input) {
    return this.labeled(t, label, this.inputBox(t, input).w_full());
  }

  inputBox(t, input) {
    return div().h(34).px(10).flex().items_center().rounded(8).border_1().border_color(t.input).bg(t.background).child(input);
  }

  iconRow(t) {
    return h_flex().gap(4).children(ICONS.map((name) => {
      const path = iconPath(name);
      return h_flex().id(`edit-icon-${name}`).size(30).flex_none().items_center().justify_center().rounded(8).cursor_pointer()
        .when(path === this.icon, (el) => el.bg(t.selected).border_1().border_color(t.accent))
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          this.icon = path;
          cx.notify();
        })
        .child(svg(path).size(15).text_color(t.foreground));
    }));
  }

  // A preview of the color, and the hex field.
  hexRow(t) {
    const preview = div().size(34).flex_none().rounded(8).border_1().border_color(t.input).bg(fillOf(this.color, t));
    const hexBox = this.inputBox(t, Input.new(this.hex).w_full().text_size(13).text_color(t.foreground)).flex_1().min_w(0);
    return h_flex().gap(8).child(preview).child(hexBox);
  }

  button(t, key, label, primary, action) {
    return h_flex().id(key).h(32).px(14).flex_none().items_center().rounded(8).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground)
      .text_size(12.5).font_medium().cursor_pointer().hover((s) => s.opacity(0.88))
      .on_click(action).child(label);
  }
}
