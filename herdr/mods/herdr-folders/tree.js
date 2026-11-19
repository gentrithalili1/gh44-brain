// The folder tree behind the sidebar: where each space, folder and machine
// sits, and which moves are allowed. Pure logic with no Herdr calls, so
// `node --test` covers it. Every function returns a new tree; none changes
// its input.
//
// A key names one thing: "folder:<id>", "space:<id>" or "machine:<name>".
// A parent ref names one list of children: "root", or the key of the folder
// or machine that owns the list. Spaces and machines in no list sit at the
// end of their default parent (see homeOf).

export const ROOT = "root";
export const DEFAULT_ICON = "mods/workspace-chrome/folder.svg";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function emptyTree() {
  return { version: 1, folders: {}, machines: {}, children: { [ROOT]: [] } };
}

// ---- keys ----

export const kindOf = (key) => key.slice(0, key.indexOf(":"));
export const nameOf = (key) => key.slice(key.indexOf(":") + 1);
const isContainer = (key) => kindOf(key) === "folder" || kindOf(key) === "machine";

// A remote space's id is "<machine>/<id>"; a local one has no slash.
function machineOfSpace(key) {
  const id = nameOf(key);
  return id.includes("/") ? id.slice(0, id.indexOf("/")) : null;
}

// Where a space or machine sits while no list names it.
function homeOf(machine) {
  return machine ? `machine:${machine}` : ROOT;
}

// ---- where things are ----

// The ref of the list that holds `key`, or null when no list does.
function parentOf(tree, key) {
  return Object.keys(tree.children).find((ref) => tree.children[ref].includes(key)) ?? null;
}

// Where `key` is drawn: its list, else its default parent.
function placeOf(tree, key) {
  const listed = parentOf(tree, key);
  if (listed) return listed;
  return kindOf(key) === "space" ? homeOf(machineOfSpace(key)) : ROOT;
}

// The machine on the path from `ref` up to the root; null for this computer.
export function machineAt(tree, ref) {
  const seen = new Set();
  let at = ref;
  while (!seen.has(at)) {
    seen.add(at);
    if (at === ROOT) return null;
    if (kindOf(at) === "machine") return nameOf(at);
    at = placeOf(tree, at);
  }
  return null; // a loop in a damaged store
}

// Whether `ref` is `key` or inside it.
function isWithin(tree, ref, key) {
  const seen = new Set();
  let at = ref;
  while (at !== ROOT && !seen.has(at)) {
    if (at === key) return true;
    seen.add(at);
    at = placeOf(tree, at);
  }
  return false;
}

// The machines a key's path must contain: null is this computer. A folder
// takes them from what it holds; a machine's own contents settle it.
function machinesNeeded(tree, key, seen = new Set()) {
  if (kindOf(key) === "space") return new Set([machineOfSpace(key)]);
  if (kindOf(key) === "machine") return new Set([null]);
  const needed = new Set();
  if (seen.has(key)) return needed;
  seen.add(key);
  for (const child of tree.children[key] ?? []) {
    for (const machine of machinesNeeded(tree, child, seen)) needed.add(machine);
  }
  return needed;
}

// ---- moving ----

// Rules 4 to 7: a machine sits outside any machine, a space sits in its own
// machine (or none), and nothing moves into itself.
export function canMove(tree, key, ref) {
  if (isWithin(tree, ref, key)) return false;
  if (kindOf(ref) === "folder" && !(nameOf(ref) in tree.folders)) return false;
  const here = machineAt(tree, ref);
  return [...machinesNeeded(tree, key)].every((machine) => machine === here);
}

// `key` goes to position `index` of the list `ref`, counted with `key` taken
// out first. A move `canMove` refuses changes nothing.
export function move(tree, key, ref, index) {
  if (!canMove(tree, key, ref)) return tree;
  const children = {};
  for (const [at, list] of Object.entries(tree.children)) children[at] = list.filter((k) => k !== key);
  const list = [...(children[ref] ?? [])];
  list.splice(Math.min(Math.max(index, 0), list.length), 0, key);
  children[ref] = list;
  return { ...tree, children };
}

// The index to hand `move` for dropping `key` just before or after `target`.
export function slotNear(tree, ref, key, target, side) {
  const rest = (tree.children[ref] ?? []).filter((k) => k !== key);
  const at = rest.indexOf(target);
  if (at < 0) return rest.length;
  return side === "after" ? at + 1 : at;
}

// The index for a new space in `ref`: after its own spaces, before its first
// folder or machine, else last.
export function newSpaceSlot(tree, ref) {
  const list = tree.children[ref] ?? [];
  const at = list.findIndex(isContainer);
  return at < 0 ? list.length : at;
}

// ---- folders ----

// A new folder goes after the last folder in `ref`, else first.
export function insertFolder(tree, ref, id, name) {
  const key = `folder:${id}`;
  const list = [...(tree.children[ref] ?? [])];
  let after = 0;
  list.forEach((k, at) => {
    if (kindOf(k) === "folder") after = at + 1;
  });
  list.splice(after, 0, key);
  return {
    ...tree,
    folders: { ...tree.folders, [id]: { name, icon: DEFAULT_ICON, color: null, folded: false } },
    children: { ...tree.children, [ref]: list, [key]: [] },
  };
}

// The folder goes; what it held takes its place in its parent.
export function deleteFolder(tree, id) {
  const key = `folder:${id}`;
  const ref = placeOf(tree, key);
  const held = tree.children[key] ?? [];
  const children = {};
  for (const [at, list] of Object.entries(tree.children)) {
    if (at !== key) children[at] = list;
  }
  const list = [...(children[ref] ?? [])];
  const at = list.indexOf(key);
  if (at < 0) list.push(...held);
  else list.splice(at, 1, ...held);
  children[ref] = list;
  const folders = { ...tree.folders };
  delete folders[id];
  return { ...tree, folders, children };
}

export function updateFolder(tree, id, patch) {
  if (!(id in tree.folders)) return tree;
  return { ...tree, folders: { ...tree.folders, [id]: { ...tree.folders[id], ...patch } } };
}

// Folds or unfolds a folder or a machine.
export function setFolded(tree, key, folded) {
  if (kindOf(key) === "folder") return updateFolder(tree, nameOf(key), { folded });
  const name = nameOf(key);
  return { ...tree, machines: { ...tree.machines, [name]: { ...tree.machines[name], folded } } };
}

export function isFolded(tree, key) {
  if (kindOf(key) === "folder") return tree.folders[nameOf(key)]?.folded === true;
  return tree.machines[nameOf(key)]?.folded === true;
}

// ---- drawing ----

// `known`: { spaces: [{ id, machine }], machines: [name] }, what exists now.
// Puts each in a list: this computer's spaces first, then machines, at the
// end of the root; a remote space at the end of its machine.
export function settle(tree, known) {
  const children = {};
  for (const [ref, list] of Object.entries(tree.children)) children[ref] = [...list];
  const placed = new Set(Object.values(children).flat());
  const place = (key, ref) => {
    if (placed.has(key)) return;
    placed.add(key);
    (children[ref] ??= []).push(key);
  };
  for (const id of Object.keys(tree.folders)) place(`folder:${id}`, ROOT);
  for (const space of known.spaces) if (!space.machine) place(`space:${space.id}`, ROOT);
  for (const name of known.machines) place(`machine:${name}`, ROOT);
  for (const space of known.spaces) if (space.machine) place(`space:${space.id}`, homeOf(space.machine));
  return { ...tree, children };
}

// The draw list: one node per thing to show, parents before their children,
// with its depth and its parent ref. A folded
// node's children are left out. Keys for what no longer exists are skipped
// and stay in the store (a machine can come back).
export function rowsOf(tree, known) {
  const full = settle(tree, known);
  const present = new Set([
    ...known.spaces.map((space) => `space:${space.id}`),
    ...known.machines.map((name) => `machine:${name}`),
  ]);
  const exists = (key) => (kindOf(key) === "folder" ? nameOf(key) in tree.folders : present.has(key));
  const visited = new Set();

  const walk = (ref, depth, out) => {
    for (const key of full.children[ref] ?? []) {
      if (!exists(key)) continue;
      const node = { key, kind: kindOf(key), depth, parent: ref };
      out.push(node);
      if (!isContainer(key) || visited.has(key)) continue;
      visited.add(key);
      node.folded = isFolded(full, key);
      const inside = [];
      walk(key, depth + 1, inside);
      node.empty = inside.length === 0;
      if (!node.folded) out.push(...inside);
    }
  };

  const nodes = [];
  walk(ROOT, 0, nodes);
  return nodes;
}

// ---- colors ----

export function isHex(text) {
  return typeof text === "string" && HEX_COLOR.test(text);
}
