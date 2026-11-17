// Kanso's layout writers, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Herdr's layout.set replaces the whole tree and a set that hasn't landed still reads as the old one, so every writer keeps its piece in shared state and each write puts them all back.
// Herdr loads a mod's files from its own folder only, so this file is copied byte for byte into each mod; `npm run sync:share` copies it and a test fails when a copy differs.
import { layout, run, shared, setShared, window } from "herdr";

export const LAYOUT_INTENT = "kanso.layout";
export const STRIP_INTENT = "kanso.layout.strip";

// Right after layout.switch, layout() can still read the previous tree, so only Kanso's tree (the one with the strip map) is ever written.
export const isKansoTree = (n) => n?.id === "strip-map" || (n?.children ?? []).some(isKansoTree);

export function walkLayout(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = walkLayout(child, id);
    if (found) return found;
  }
  return null;
}

export function pathTo(node, id) {
  if (node?.id === id) return [];
  return (node?.children ?? []).reduce((found, child, i) => found ?? (() => {
    const rest = pathTo(child, id);
    return rest && [i, ...rest];
  })(), null);
}

const changedAt = (node, path, fn, depth = 0) => (depth === path.length ? fn(node)
  : { ...node, children: node.children.with(path[depth], changedAt(node.children[path[depth]], path, fn, depth + 1)) });

export function changeLayout(tree, id, fn) {
  const path = pathTo(tree, id);
  return path ? changedAt(tree, path, fn) : tree;
}

export function paintLayout(tree, { preserveSizes = true, nodes = true } = {}) {
  if (!tree) return tree;
  const intent = { ...(shared(LAYOUT_INTENT) ?? {}), ...(shared(STRIP_INTENT) ?? {}) };
  const withColumns = nodes && intent.nodes ? paintColumns(tree, intent, preserveSizes) : tree;
  const withPanel = "panel" in intent ? paintPanel(withColumns, intent.panel) : withColumns;
  const withRail = intent.rail ? paintRail(withPanel, intent.rail) : withPanel;
  return edgeBesidePanel(withRail);
}

// The strip's columns in work-body, where "main" or the strip's own were.
function paintColumns(tree, intent, preserveSizes) {
  const body = walkLayout(tree, "work-body");
  if (!body?.children) return tree;
  const mine = (n) => n.id === "main" || String(n.id).startsWith("strip-");
  const at = body.children.findIndex(mine);
  const rest = body.children.filter((n) => !mine(n));
  const i = Math.max(0, at);
  const columns = JSON.parse(JSON.stringify(intent.nodes));
  // Keep the px sizes native dividers left, but not sizes from the tree a pending strip write was based on: replaying those would undo an explicit width command.
  const keepSize = (node) => {
    const before = intent.sizesBefore?.[node.id], live = walkLayout(body, node.id);
    const sized = before !== undefined && live?.size?.px !== undefined
      && JSON.stringify(live.size) !== JSON.stringify(before) ? { ...node, size: { ...live.size } } : node;
    if (!sized.children) return sized;
    const children = sized.children.map(keepSize);
    return children.some((c, k) => c !== sized.children[k]) ? { ...sized, children } : sized;
  };
  const kept = preserveSizes ? columns.map(keepSize) : columns;
  return changeLayout(tree, "work-body", (b) => ({ ...b, children: [...rest.slice(0, i), ...kept, ...rest.slice(i)] }));
}

// Both nodes are looked up in the tree as given: a "panel" that was inside panel-body is gone with the children it had, so it is left alone.
function paintPanel(tree, panel) {
  const bodyAt = pathTo(tree, "panel-body");
  if (!bodyAt) return tree;
  const wrapAt = pathTo(tree, "panel") ?? bodyAt;
  const child = panel ? JSON.parse(JSON.stringify(panel)) : null;
  const same = wrapAt === bodyAt;
  const inside = !same && wrapAt.length > bodyAt.length && bodyAt.every((k, d) => wrapAt[d] === k);
  const withBody = changedAt(tree, bodyAt, (body) => {
    const { active: _active, ...rest } = body;
    const filled = child ? { ...body, children: [child], active: child.id } : { ...rest, children: [] };
    return same ? { ...filled, hidden: !child } : filled;
  });
  return same || inside ? withBody : changedAt(withBody, wrapAt, (wrap) => ({ ...wrap, hidden: !child }));
}

function paintRail(tree, rail) {
  const kids = tree.children ?? [];
  const at = kids.findIndex((n) => n.id === "sidebar");
  if (at < 0) return tree;
  return { ...tree, resizable: rail.open, children: kids.with(at, { ...kids[at], min: rail.min, hidden: false }) };
}

export const OPEN_MIN = 120; // open, the edge drags this far, past where a drag folds it
// The collapsed rail is as wide as the macOS traffic lights need, so they never spill over the tab bar.
export const railWidth = () => (window()?.platform === "macos" ? 76 : 44);

export function setRail(open, width) {
  const min = open ? OPEN_MIN : railWidth();
  rememberLayout({ rail: { open, min } });
  const tree = layout();
  const sidebar = (tree?.children ?? []).find((n) => n.id === "sidebar");
  if (!sidebar) return;
  if (tree.resizable !== open || sidebar.min !== min || sidebar.hidden) {
    const painted = paintLayout(tree);
    if (isKansoTree(painted)) run("layout.set", { layout: painted });
  }
  run("layout.resize", { id: "sidebar", px: width });
}

export function foldSidebar() {
  setShared("sidebar.collapsed", true);
  setRail(false, railWidth());
}

// Herdr's own toggle hides the sidebar, and kanso-spaces with it: once per hiding, it comes back as the rail.
export function sidebarBack(tree, acted) {
  const hidden = isKansoTree(tree) && (tree.children ?? []).some((n) => n.id === "sidebar" && n.hidden === true);
  return { acted: hidden, fold: hidden && !acted };
}

// A side panel's left border is Herdr's divider, which moves only the two nodes beside it, so a fixed-width neighbor pins it: while a panel shows, the strip's right edge rail stands after the panel instead of before it.
export function edgeBesidePanel(tree) {
  const body = walkLayout(tree, "work-body"), kids = body?.children;
  const at = kids ? kids.findIndex((n) => n.id === "strip-edge-right") : -1;
  if (at < 0) return tree;
  const edge = kids[at], rest = kids.toSpliced(at, 1);
  const panel = rest[at];
  const beside = panel && (panel.id === "panel-body" || panel.id === "panel") && !panel.hidden;
  return changeLayout(tree, "work-body", (b) => ({ ...b, children: rest.toSpliced(beside ? at + 1 : at, 0, edge) }));
}

export function rememberLayout(patch) {
  setShared(LAYOUT_INTENT, { ...(shared(LAYOUT_INTENT) ?? {}), ...patch });
}

export function commitLayout(patch) {
  rememberLayout(patch);
  const tree = layout();
  if (!tree) return false;
  const painted = paintLayout(tree);
  if (isKansoTree(painted)) run("layout.set", { layout: painted });
  return true;
}
