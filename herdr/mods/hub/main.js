// Work panel: GitHub PRs of the current repo and Linear issues, with filters
// and a split button that starts a gh44 skill in a new Claude tab.
// The same mod opened as a popup (props().menu) draws the dropdown menus.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { theme, run, focused, layout, spaces, panes, shared, setShared, openOverlay, closeOverlay, props, checking, nextCommand, home, notify } from "herdr";
import {
  GITHUB_DEFAULTS, LINEAR_DEFAULTS, GITHUB_SCOPES, LINEAR_SCOPES, CI_OPTIONS, PRIORITY_OPTIONS, UNASSIGNED,
  REVIEW_OPTIONS, SORT_OPTIONS, NO_ASSIGNEE,
  filterPullRequests, filterIssues, groupIssuesByState, toOptions, buildIssueFilter, getProjectOptions, buildPullRequestQuery,
  getMyReviewState, isReviewScope,
} from "./filters.js";
import {
  loadPullRequests, loadRepoName, loadRepoId, loadRepoLabels, loadMyTeams, loadGithubLogin,
  loadWorktrees, loadMergedWorktrees, removeWorktree,
} from "./github.js";
import { loadIssues, loadLinearMeta } from "./linear.js";
import {
  LINEAR_SKILLS, GITHUB_SKILLS, shortSkill, getDefaultGithubSkill, getDefaultLinearSkill, getIssueStage,
  findSpaceOnBranch, findAgentFor, focusAgent, startSkill,
} from "./actions.js";

const NO_MENU_ROW = -1;
const icon = (name) => `mods/hub/icons/${name}.svg`;

const STORE = {
  tab: "hub.tab",
  github: "hub.github.filters",
  linear: "hub.linear.filters",
  // { "THU-123": true }: tickets whose ▾ menu has "In new worktree" ticked.
  worktreeTickets: "hub.linear.worktreeTickets",
};
// GitHub filters are kept per repo ("hub.github.filters|<repo id>"); Linear's are shared.
const isGithubStore = (store) => store.startsWith(STORE.github);
const defaultsFor = (store) => (isGithubStore(store) ? GITHUB_DEFAULTS : LINEAR_DEFAULTS);

const TICK_MS = 1000;
const REFRESH_MS = 120_000;
// A failed load or "not a repo" is retried this soon, so a hiccup never sticks.
const ERROR_RETRY_MS = 5_000;
// Opening the panel or switching space/tab refreshes the shown list, at most this often.
const MIN_REVALIDATE_MS = 15_000;
// Typing in the PR search runs the GitHub query once it pauses this long.
const SEARCH_DEBOUNCE_MS = 700;
const MENU_ROW_HEIGHT = 30;
const MENU_PADDING = 12;
const MENU_SEARCH_HEIGHT = 38;
const MENU_MAX_HEIGHT = 420;
// The line above "In new worktree": 1px plus 3px above and below.
const MENU_SEPARATOR_HEIGHT = 7;
const MENU_WIDTH = 240;
// The Filters popover is frameless and this big; its visible box grows with the open section.
const FILTER_POPOVER_WIDTH = 260;
const FILTER_POPOVER_HEIGHT = 580;
const FILTER_OPTIONS_VISIBLE = 7;
const SKELETON_ROWS = 4;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// Keys on a selected row that start a skill directly.
const KEY_SKILLS = {
  github: { r: "gh44-code-review", a: "gh44-address-review" },
  linear: { c: "gh44-clarify", p: "gh44-plan", i: "gh44-implement", a: "gh44-address-review" },
};
const KEY_HINTS = {
  github: "j/k move · ↵ run · r review · a address · o open · / search",
  linear: "j/k move · ↵ run · c clarify · p plan · i implement · o open · / search",
};

// One meaning per color, everywhere in the panel. Accent is for buttons only.
const palette = (t) => ({ success: t.ansi2, danger: t.ansi1, warning: t.ansi3, neutral: t.dim, quiet: t.muted });

const CI_STATUS = {
  passing: { tone: "success", tip: "Checks passing" },
  failing: { tone: "danger", tip: "Checks failing" },
  pending: { tone: "warning", tip: "Checks running" },
  none: { tone: "neutral", tip: "No checks" },
};
const STAGE_STATUS = { backlog: "neutral", todo: "quiet", progress: "warning", review: "warning" };
const URGENT = 1;
// An agent on a row: its tag, and what the main button says while it runs.
const AGENT_STATUS = {
  working: { label: "working", tone: "warning" },
  blocked: { label: "needs you", tone: "danger" },
  done: { label: "done", tone: "success" },
  idle: { label: "idle", tone: "neutral" },
};
const DECISION_TAG = {
  APPROVED: { label: "Approved", tone: "success" },
  CHANGES_REQUESTED: { label: "Changes requested", tone: "danger" },
};

// Module scope so results survive tab switches and new panel copies:
// key -> { result, at }. A key is a repo + scope, or a Linear filter.
const cache = new Map();
const inflight = new Set();
// folder -> repo id (shared git dir) or null; when a null was last checked.
const repoIds = new Map();
const repoCheckedAt = new Map();
const repoNames = new Map();
const repoLabels = new Map();
const repoNameCheckedAt = new Map();
// org -> my teams there, for the Team filter.
const myTeams = new Map();
// The merged worktrees the open Clean up dialog is about; its confirm runs `hub.cleanup`.
let pendingCleanup = null;
// A skill picked in the ▾ popup; the panel runs it (`hub.start`), since a closed popup's
// async work (creating a worktree) would be cancelled.
let pendingStart = null;
const session = { login: null, meta: { status: "idle", teams: [], projects: [] } };

const getFilters = (store) => {
  // A repo without its own filters starts from the ones saved before filters were per repo.
  const saved = shared(store) ?? (isGithubStore(store) ? shared(STORE.github) : null) ?? {};
  const f = { ...defaultsFor(store), ...saved };
  // A scope saved by an older version falls back to review requests.
  if (isGithubStore(store) && !GITHUB_SCOPES.some((o) => o.value === f.scope)) f.scope = "review";
  return f;
};
const patchFilters = ({ store, patch }) => setShared(store, { ...getFilters(store), ...patch });
const isWorktreeTicket = (identifier) => (shared(STORE.worktreeTickets) ?? {})[identifier] === true;
const setWorktreeTicket = ({ identifier, isOn }) => setShared(STORE.worktreeTickets, { ...(shared(STORE.worktreeTickets) ?? {}), [identifier]: isOn });
const currentTab = () => (shared(STORE.tab) === "linear" ? "linear" : "github");

// The shown space's repo folder: its focused terminal, else any terminal in the shown tab,
// else any terminal in the space, else where the space was made.
function currentFolder() {
  const space = spaces().find((s) => s.active);
  if (!space) return null;
  const f = focused();
  if (f?.space === space.id && f.cwd) return f.cwd;
  const tabIds = new Set((space.tabs ?? []).map((tab) => tab.id));
  const activeTab = (space.tabs ?? []).find((tab) => tab.active)?.id;
  const terminals = panes().filter((p) => tabIds.has(p.tab) && p.cwd);
  return terminals.find((p) => p.tab === activeTab && p.focused)?.cwd
    ?? terminals.find((p) => p.tab === activeTab)?.cwd
    ?? terminals[0]?.cwd
    ?? space.folder
    ?? null;
}
const activeMachine = () => spaces().find((s) => s.active)?.machine ?? undefined;
const stop = (_e, cx) => cx.stop_propagation();

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

// The Work panel is open and showing this mod (not Files or Changes).
const isPanelShown = () => {
  const root = layout();
  const panel = findNode(root, "panel");
  return Boolean(panel) && !panel.hidden && findNode(root, "panel-body")?.active === "hub";
};

const formatAge = (iso) => {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return ms < DAY_MS ? `${Math.max(1, Math.round(ms / HOUR_MS))}h` : `${Math.round(ms / DAY_MS)}d`;
};

// How many of a filter's values are picked; a single choice counts when it differs from the default.
const countPicked = ({ store, def }) => {
  const value = getFilters(store)[def.field];
  return def.isMulti ? value.length : Number(value !== defaultsFor(store)[def.field]);
};

function openMenu(menu) {
  const groups = menu.groups ?? [];
  const groupRows = groups.reduce((sum, g) => sum + g.options.length + (groups.length > 1 ? 1 : 0), 0);
  const hasSearch = !menu.skills && !menu.isFilterList;
  const rows = menu.isFilterList
    ? groups.length + 1
    : (menu.skills?.length ?? 0) + groupRows + (menu.hasWorktreeToggle ? 1 : 0);
  const separators = menu.hasWorktreeToggle ? MENU_SEPARATOR_HEIGHT : 0;
  const height = Math.min(MENU_MAX_HEIGHT, Math.max(1, rows) * MENU_ROW_HEIGHT + separators + MENU_PADDING + (hasSearch ? MENU_SEARCH_HEIGHT : 0));
  if (menu.isFilterList) {
    openOverlay({ mod: "hub", kind: "popup", frame: "none", width: FILTER_POPOVER_WIDTH, height: FILTER_POPOVER_HEIGHT, props: { menu } });
    return;
  }
  openOverlay({ mod: "hub", kind: "popup", width: MENU_WIDTH, height, props: { menu: { ...menu, height } } });
}

export default class Hub extends View {
  init(_props, cx) {
    if (props()?.menu) {
      this.isMenu = true;
      this.expanded = null;
      this.menuSearch = InputState.new({ placeholder: "Search" });
      this.menuSearch.on("change", (_e, cx) => { this.menuIndex = this.expanded ? this.firstOptionIndex ?? 0 : 0; cx.notify(); });
      this.menuItems = [];
      // A skill menu opens with no active row, so nothing looks preselected; ↑/↓ picks one.
      this.menuIndex = props().menu.skills ? NO_MENU_ROW : 0;
      this.menuListOffset = 0;
      this.menuHandle = cx.focus_handle();
      this.menuScroll = ScrollHandle.new();
      this.optionScroll = ScrollHandle.new();
      // Without a search box to type in, the menu itself takes the keyboard for ↑/↓/↵.
      if (props().menu.skills || props().menu.isFilterList) this.menuHandle.focus();
      if (!props().menu.skills && !props().menu.isFilterList) this.menuSearch.focus();
      // What was picked when the menu opened goes first; the order stays put while clicking.
      const menu = props().menu;
      this.pinned = new Set((menu.groups ?? []).flatMap((def) => [].concat(getFilters(menu.store)[def.field]).map((v) => `${def.field}:${v}`)));
      return;
    }
    this.hovered = null;
    this.selected = { github: null, linear: null };
    this.visible = { github: [], linear: [] };
    this.isSearchFocused = false;
    this.isShowingReviewed = false;
    this.folder = undefined;
    this.githubKey = null;
    this.linearKey = null;
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.committedSearch = "";
    this.searchChangedAt = 0;
    // The PR search runs on GitHub: after a pause in typing, or at once on Enter or leaving the box.
    this.githubSearch = this.createSearch({
      placeholder: "Search titles or #number",
      onChange: () => { this.searchChangedAt = Date.now(); },
      onCommit: (cx) => { this.searchChangedAt = 0; this.tick(cx); },
    });
    this.lastGithub = null;
    this.linearSearch = this.createSearch({ placeholder: "Search ID or title" });
    if (checking()) return;
    if (!session.login) cx.spawn(async (cx) => { session.login = await loadGithubLogin(); cx.notify(); });
    if (session.meta.status !== "success") this.loadMeta(cx);
    // pane.go and Herdr hand the panel the keyboard with "focus".
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        // `herdr-app do hub.github` / `hub.linear`: show that tab (bindable in keys.json).
        if (command === "github" || command === "linear") setShared(STORE.tab, command);
        if (command === "cleanup") await this.runCleanup(cx);
        if (command === "start" && pendingStart) {
          const start = pendingStart;
          pendingStart = null;
          startSkill(start);
        }
        cx.notify();
      }
    });
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
    this.tick(cx);
  }

  // One handler per event: the input may keep only one.
  createSearch({ placeholder, onChange = () => {}, onCommit = () => {} }) {
    const state = InputState.new({ placeholder });
    state.on("change", (_e, cx) => { onChange(); cx.notify(); });
    state.on("submit", (_e, cx) => { onCommit(cx); cx.notify(); });
    state.on("focus", (_e, cx) => { this.isSearchFocused = true; cx.notify(); });
    state.on("blur", (_e, cx) => { this.isSearchFocused = false; onCommit(cx); cx.notify(); });
    return state;
  }

  // Every second, no I/O unless needed: pick the cache keys for what is shown,
  // and fetch only what is missing or older than REFRESH_MS.
  tick(cx) {
    const folder = currentFolder();
    const isIdStale = repoIds.get(folder) === null && Date.now() - (repoCheckedAt.get(folder) ?? 0) > ERROR_RETRY_MS;
    if (folder !== this.folder || isIdStale) {
      this.folder = folder;
      if (!repoIds.has(folder) || isIdStale) {
        const machine = activeMachine();
        repoCheckedAt.set(folder, Date.now());
        cx.spawn(async (cx) => { repoIds.set(folder, await loadRepoId({ folder, machine })); this.tick(cx); });
        if (!repoIds.has(folder)) return;
      }
    }
    if (!repoIds.has(folder)) return;
    const repoId = repoIds.get(folder);

    // Another repo: refresh its cached list in the background. Opening the panel, worktrees
    // of the same repo and tab switches show the cache; it refreshes once older than REFRESH_MS.
    const isShown = isPanelShown();
    if (repoId !== this.repoId) this.shouldRevalidate = true;
    this.repoId = repoId;

    const ln = getFilters(STORE.linear);
    const linearKey = `ln|${JSON.stringify(buildIssueFilter(ln))}`;
    // Back to a filter combination seen before: refresh its cached list if it's not recent.
    if (this.shouldRevalidate || linearKey !== this.linearKey) this.revalidate(linearKey);
    this.linearKey = linearKey;
    // Nothing is fetched while the panel is closed; opening it refreshes both tabs.
    if (isShown) this.ensure({ cx, key: this.linearKey, load: () => loadIssues(ln) });

    // The repo's name (for the search query) and labels (for the Label filter), once per repo.
    // A failed name lookup is retried after ERROR_RETRY_MS instead of blocking the repo for good.
    const isNameStale = repoId && repoNames.get(repoId) === null && Date.now() - (repoNameCheckedAt.get(repoId) ?? 0) > ERROR_RETRY_MS;
    if (repoId && (!repoNames.has(repoId) || isNameStale)) {
      const machine = activeMachine();
      repoNames.set(repoId, null);
      repoNameCheckedAt.set(repoId, Date.now());
      cx.spawn(async (cx) => {
        repoNames.set(repoId, await loadRepoName({ folder, machine }));
        repoLabels.set(repoId, await loadRepoLabels({ folder, machine }));
        this.tick(cx);
      });
      return;
    }
    const repo = repoId ? repoNames.get(repoId) : null;
    if (repoId && !repo) return;
    const org = repo?.split("/")[0];
    if (org && session.login && !myTeams.has(org)) {
      myTeams.set(org, []);
      const login = session.login;
      cx.spawn(async (cx) => { myTeams.set(org, await loadMyTeams({ org, login })); cx.notify(); });
    }
    if (Date.now() - this.searchChangedAt > SEARCH_DEBOUNCE_MS) this.committedSearch = this.githubSearch.value();
    this.githubQuery = repo ? buildPullRequestQuery({ repo, filters: getFilters(this.githubStore()), search: this.committedSearch }) : null;
    const githubKey = `gh|${repoId}|${this.githubQuery}`;
    if (githubKey !== this.githubKey) this.revalidate(githubKey);
    this.githubKey = githubKey;
    // The repo's worktrees (to reuse a ticket's checkout) and which are merged (to clean up).
    const main = this.repoMain();
    if (isShown && repo && main) {
      const machine = activeMachine();
      this.ensure({
        cx, key: `wt|${repoId}`,
        load: async () => {
          const items = await loadWorktrees({ main, machine });
          // Only checkouts made for tickets: gh44's .worktrees/ and Herdr's worktree folder.
          const ours = items.filter((w) => w.path.startsWith(`${main}/.worktrees/`) || w.path.startsWith(`${home()}/.herdr/worktrees/`));
          return { status: "success", items, merged: await loadMergedWorktrees({ repo, main, worktrees: ours, machine }) };
        },
      });
    }
    if (this.shouldRevalidate) this.revalidate(this.githubKey);
    this.shouldRevalidate = false;
    const query = this.githubQuery;
    if (isShown) this.ensure({ cx, key: this.githubKey, load: () => (query ? loadPullRequests({ query }) : Promise.resolve({ status: "error", reason: "notRepo" })) });
  }

  // The next page of PRs, added to the cached list.
  loadMore(cx) {
    const key = this.githubKey;
    const entry = cache.get(key);
    const moreKey = `${key}|more`;
    if (!entry?.result.hasMore || inflight.has(moreKey)) return;
    inflight.add(moreKey);
    cx.notify();
    const query = this.githubQuery;
    cx.spawn(async (cx) => {
      const next = await loadPullRequests({ query, after: entry.result.cursor });
      inflight.delete(moreKey);
      const current = cache.get(key);
      if (next.status === "success" && current?.result.status === "success") {
        const seen = new Set(current.result.items.map((pr) => pr.id));
        const items = [...current.result.items, ...next.items.filter((pr) => !seen.has(pr.id))];
        cache.set(key, { ...current, result: { ...current.result, items, cursor: next.cursor, hasMore: next.hasMore } });
      }
      cx.notify();
    });
  }

  // Mark a list stale so the next ensure refetches it in the background; the old list stays on screen.
  revalidate(key) {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.at > MIN_REVALIDATE_MS) cache.set(key, { ...entry, at: 0 });
  }

  ensure({ cx, key, load }) {
    const entry = cache.get(key);
    const maxAge = entry?.result.status === "error" ? ERROR_RETRY_MS : REFRESH_MS;
    if ((entry && Date.now() - entry.at < maxAge) || inflight.has(key)) return;
    inflight.add(key);
    cx.notify();
    cx.spawn(async (cx) => {
      const result = await load();
      inflight.delete(key);
      // A failed refresh keeps the last good list on screen.
      const keepOld = result.status !== "success" && entry?.result.status === "success";
      cache.set(key, { result: keepOld ? entry.result : result, at: Date.now() });
      if (result.status === "success" && key.startsWith("ln|") && session.meta.status !== "success") this.loadMeta(cx);
      cx.notify();
    });
  }

  loadMeta(cx) {
    session.meta = { ...session.meta, status: "loading" };
    cx.spawn(async (cx) => {
      const result = await loadLinearMeta();
      session.meta = result.status === "success" ? result : { ...result, teams: [], projects: [] };
      cx.notify();
    });
  }

  handleRefresh(cx) {
    for (const key of [this.githubKey, this.linearKey]) {
      const entry = cache.get(key);
      if (entry) cache.set(key, { ...entry, at: 0 });
    }
    this.loadMeta(cx);
    this.tick(cx);
  }

  handleKey(e, cx) {
    if (this.isSearchFocused) {
      if (e.key === "escape" || e.key === "enter") { this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      return;
    }
    if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
    const tab = currentTab();
    const rows = this.visible[tab];
    const at = rows.findIndex((r) => r.id === this.selected[tab]);
    const row = rows[at];
    const move = (step) => {
      if (rows.length === 0) return;
      const from = at === -1 ? (step > 0 ? -1 : rows.length) : at;
      const next = rows[Math.max(0, Math.min(rows.length - 1, from + step))];
      this.selected[tab] = next.id;
      this.scroll.scroll_to_item(next.index);
    };
    switch (e.key) {
      case "j": case "down": move(1); break;
      case "k": case "up": move(-1); break;
      case "enter": row?.primary(); break;
      case "o": if (row) cx.open_url(row.url); break;
      case "/": (tab === "github" ? this.githubSearch : this.linearSearch).focus(); break;
      case "1": setShared(STORE.tab, "github"); break;
      case "2": setShared(STORE.tab, "linear"); break;
      default: {
        const skill = KEY_SKILLS[tab][e.key];
        if (!skill || !row) return;
        row.start(skill);
      }
    }
    cx.stop_propagation();
    cx.notify();
  }

  // ---------- shared pieces ----------

  iconButton({ id, name, tip, onClick }) {
    const t = theme();
    return div().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
      .text_color(t.muted).hover((s) => s.bg(t.raised).text_color(t.foreground))
      .tooltip(tip).on_mouse_down("left", stop).on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); })
      .child(svg(icon(name)).size(13));
  }

  // [Review: me + teams ▾ | search...] like GitHub's search box with its scope picker.
  searchRow({ store, scopeDef, state, defs }) {
    const t = theme();
    const value = getFilters(store)[scopeDef.field];
    const label = scopeDef.options.find((o) => o.value === value)?.label ?? "";
    return h_flex().h(30).items_center().rounded(6).border(1).border_color(this.isSearchFocused ? t.accent : t.input).bg(t.background).overflow_hidden()
      .child(h_flex().id(`scope-${scopeDef.field}`).h_full().px(8).gap(4).items_center().flex_none().cursor_pointer()
        .text_size(12).text_color(t.foreground).bg(t.raised).hover((s) => s.bg(t.hover))
        .on_click(() => openMenu({ store, groups: [scopeDef] }))
        .child(label).child(svg(icon("chevron")).size(12).text_color(t.muted)))
      .child(div().w(1).h_full().bg(t.border))
      .child(h_flex().flex_1().min_w(0).px(8).gap(6).items_center()
        .child(svg(icon("search")).size(13).text_color(t.dim))
        .child(Input.new(state).flex_1().text_size(12).text_color(t.foreground)))
      .child(div().w(1).h_full().bg(t.border))
      .child(this.filtersButton({ store, defs }));
  }

  // [≡ Filters ②]: every filter in one popover, with search and Clear.
  filtersButton({ store, defs }) {
    const t = theme();
    const count = defs.reduce((sum, def) => sum + countPicked({ store, def }), 0);
    const isOn = count > 0;
    return h_flex().id(`filters-${store}`).h_full().px(8).gap(5).items_center().flex_none().cursor_pointer().text_size(12)
      .text_color(isOn ? t.foreground : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => openMenu({ store, groups: defs, isFilterList: true }))
      .child(svg(icon("filter")).size(13))
      .child("Filters")
      .when(isOn, (el) => el.child(div().px(5).rounded(8).bg(t.accent).text_color(t.accent_foreground).text_size(10.5).child(String(count))));
  }

  // [▶ plan | ▾]: the main part runs the row's next step, the chevron picks another.
  splitButton({ id, primary, menu }) {
    const t = theme();
    return h_flex().id(id).h(24).flex_none().items_center().rounded(6).border(1).border_color(t.border).bg(t.background).text_size(12)
      .child(h_flex().id(`${id}-run`).h_full().pl(7).pr(8).gap(5).items_center().rounded_l(6).cursor_pointer()
        .text_color(t.foreground).hover((s) => s.bg(t.hover)).tooltip(primary.tip)
        .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); primary.run(); })
        .child(svg(icon(primary.icon)).size(11).text_color(t.accent))
        .child(primary.label)
        .when(Boolean(primary.worktreeBadge), (el) => el.child(div().px(4).rounded(4).bg(t.selected).text_color(t.accent).text_size(10.5).child(primary.worktreeBadge))))
      .child(div().w(1).h(14).bg(t.border))
      .child(div().id(`${id}-more`).h_full().px(5).flex().items_center().rounded_r(6).cursor_pointer()
        .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); openMenu(menu); })
        .child(svg(icon("chevron")).size(12)));
  }

  // A pill; with a url it opens that page (e.g. a ticket's PR on GitHub).
  tag({ label, tone, url = null }) {
    const t = theme();
    const color = palette(t)[tone];
    const pill = div().id(`tag-${label}-${url ?? ""}`).flex_none().px(5).rounded(4).border(1).border_color(color).text_color(color).text_size(10.5).child(label);
    if (!url) return pill;
    return pill.cursor_pointer().tooltip("Open on GitHub").hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); cx.open_url(url); });
  }

  // One row shape for both tabs: status icon | title over ref · meta and tags | hover actions + main button.
  row({ id, status, badge = null, title, isTitleDim, ref, meta, diff = null, tags, actions, primary, menu }) {
    const t = theme();
    const colors = palette(t);
    const tab = currentTab();
    const isSelected = this.selected[tab] === id;
    const isHovered = this.hovered === id;
    return h_flex().id(`row-${id}`).flex_none().px(10).py(7).gap(8).items_center().border_b(1).border_color(t.border)
      .bg(isSelected ? t.selected : t.background).hover((s) => s.bg(isSelected ? t.selected : t.hover))
      .on_hover((hovered, cx) => {
        if (hovered) this.hovered = id;
        else if (this.hovered === id) this.hovered = null;
        cx.notify();
      })
      .on_click((_e, cx) => { this.selected[tab] = id; this.handle.focus(); cx.notify(); })
      .child(div().flex_none().self_start().pt(2).tooltip(status.tip).child(svg(icon(status.icon)).size(14).text_color(status.color)))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().truncate().text_color(isTitleDim ? t.muted : t.foreground).child(title))
        .child(h_flex().gap(5).items_center().min_w(0).text_size(11.5).text_color(t.dim)
          .when(Boolean(badge), (el) => el.child(div().flex_none().tooltip(badge.tip).child(svg(icon(badge.icon)).size(12).text_color(badge.color))))
          .child(div().flex_none().child(ref))
          .when(meta.length > 0, (el) => el.child(div().min_w(0).truncate().child(`· ${meta.join(" · ")}`)))
          .when(Boolean(diff), (el) => el.child(h_flex().flex_none().gap(3)
            .child(div().text_color(t.dim).child("·"))
            .child(div().text_color(colors.success).child(`+${diff.additions}`))
            .child(div().text_color(colors.danger).child(`−${diff.deletions}`))))
          .children(tags.map((tg) => this.tag(tg)))))
      .child(h_flex().flex_none().gap(2).items_center()
        .when(isHovered || isSelected, (el) => el.children(actions.map((a) => this.iconButton(a))))
        .child(this.splitButton({ id: `run-${id}`, primary, menu })));
  }

  message({ title, body, action }) {
    const t = theme();
    return v_flex().p(16).gap(8).items_center().text_size(12.5)
      .child(div().text_color(t.foreground).child(title))
      .when(Boolean(body), (el) => el.child(div().text_color(t.dim).child(body)))
      .when(Boolean(action), (el) => el.child(div().id(`msg-${action.label}`).h(26).px(10).flex().items_center().rounded(6)
        .border(1).border_color(t.accent).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => action.onClick(cx)).child(action.label)));
  }

  skeleton() {
    const t = theme();
    const bar = (isFull) => div().h(10).when(isFull, (el) => el.w_full()).when(!isFull, (el) => el.w(140)).rounded(4)
      .bg(t.raised).loop("opacity", { from: 0.4, to: 1, period: 1200 });
    return v_flex().p(10).gap(14).children(Array.from({ length: SKELETON_ROWS }, (_, i) =>
      v_flex().id(`sk-${i}`).gap(7).child(bar(true)).child(bar(false))));
  }

  // Error, first-load and empty states; null when there are rows to show.
  listState({ source, label, shownCount, hasFilters, onClear }) {
    if (!source) return this.skeleton();
    if (source.status === "error") {
      if (source.reason === "auth") {
        const argv = label === "GitHub" ? ["gh", "auth", "login"] : ["linear", "auth", "login"];
        return this.message({ title: `${label} CLI is not logged in`, body: `Runs \`${argv.join(" ")}\` in a new tab.`, action: { label: "Log in", onClick: () => run("tab.new", { name: `${label} login`, argv }) } });
      }
      if (source.reason === "notRepo") return this.message({ title: "Not a GitHub repo", body: `${this.folder ?? "No folder"} is not inside a repo. Focus a terminal in one.` });
      return this.message({ title: `${label} failed to load`, body: source.message, action: { label: "Retry", onClick: (cx) => this.handleRefresh(cx) } });
    }
    if (shownCount > 0) return null;
    return hasFilters
      ? this.message({ title: "Nothing matches these filters", action: { label: "Clear filters", onClick: onClear } })
      : this.message({ title: "Nothing here", body: "No open items for this view." });
  }

  note({ id, text, action }) {
    const t = theme();
    return h_flex().id(id).flex_none().px(10).py(8).gap(6).text_size(11.5).text_color(t.dim)
      .child(text)
      .when(Boolean(action), (el) => el.child(div().id(`${id}-action`).text_color(t.accent).cursor_pointer()
        .on_click((_e, cx) => action.onClick(cx)).child(action.label)));
  }

  // A scrolling list whose direct children are the rows, so the keyboard can scroll to one.
  list({ id, state, entries }) {
    return v_flex().id(id).flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll)
      .on_mouse_down("left", () => this.handle.focus())
      .children(state ? [state] : entries);
  }

  // An agent already on it: open it. Else resume a space on its branch, else start the next skill.
  primaryFor({ agent, branch, skill, target, isWorktree, isBackground = false }) {
    if (agent) return { label: "open", icon: "resume", tip: `Go to ${agent.tab_name} (${AGENT_STATUS[agent.status]?.label ?? agent.status})`, run: () => focusAgent(agent) };
    const space = findSpaceOnBranch(branch);
    if (space) return { label: "resume", icon: "resume", tip: `Go to ${space.name}`, run: () => run("space.select", { id: space.id }) };
    const worktreeTip = target.worktree
      ? `/${skill} in this ticket's existing worktree (${target.worktree.split("/").pop()})`
      : `/${skill} in a NEW worktree: Herdr creates it from origin/main, gh44 setup runs, then Claude starts`;
    return {
      label: shortSkill(skill), icon: isWorktree ? "branch" : "play",
      // Shown on the button, so it is clear before clicking that a worktree is involved.
      worktreeBadge: isWorktree ? (target.worktree ? "worktree" : "+ worktree") : null,
      tip: isWorktree ? worktreeTip : isBackground ? `/${skill} in a background tab` : `/${skill} in a new tab here`,
      run: () => startSkill({ skill, target, isWorktree, isBackground }),
    };
  }

  agentTag(agent) {
    const status = agent ? AGENT_STATUS[agent.status] : null;
    return status && agent.status !== "idle" ? [{ label: `● ${status.label}`, tone: status.tone }] : [];
  }

  githubStore() {
    return `${STORE.github}|${this.repoId ?? "none"}`;
  }

  // The repo's main checkout (the folder holding the shared .git), for new worktrees.
  repoMain() {
    return this.repoId?.endsWith("/.git") ? this.repoId.slice(0, -"/.git".length) : null;
  }

  // "2 merged worktrees: THU-1, THU-2 · Clean up", at the top of both lists.
  cleanupNote() {
    const merged = cache.get(`wt|${this.repoId}`)?.result.merged ?? [];
    if (merged.length === 0) return [];
    const names = merged.map((w) => w.path.split("/").pop());
    const handleOpen = () => {
      pendingCleanup = { main: this.repoMain(), machine: activeMachine(), items: merged };
      openOverlay({
        mod: "confirm", kind: "dialog", width: 460, height: 230,
        props: {
          title: `Clean up ${merged.length} merged worktree${merged.length === 1 ? "" : "s"}?`,
          detail: `${merged.map((w) => `${w.path.split("/").pop()} (PR #${w.pr})`).join(", ")}.\n\nCloses their spaces, removes the worktrees and deletes the local branches. A worktree with uncommitted changes is skipped.`,
          command: { name: "hub.cleanup" },
        },
      });
    };
    return [this.note({ id: "wt-merged", text: `${merged.length} merged worktree${merged.length === 1 ? "" : "s"}: ${names.join(", ")}`, action: { label: "Clean up", onClick: handleOpen } })];
  }

  // Close each merged worktree's spaces, then remove the worktree and its branch.
  async runCleanup(cx) {
    const job = pendingCleanup;
    pendingCleanup = null;
    if (!job) return;
    const inside = (folder, path) => folder === path || folder?.startsWith(`${path}/`);
    const removed = [];
    const skipped = [];
    for (const w of job.items) {
      const tabsInside = new Set(panes().filter((p) => inside(p.cwd, w.path)).map((p) => p.tab));
      for (const space of spaces().filter((sp) => inside(sp.folder, w.path) || (sp.tabs ?? []).some((tab) => tabsInside.has(tab.id)))) {
        run("space.close", { id: space.id, confirmed: true });
      }
      const result = await removeWorktree({ main: job.main, path: w.path, branch: w.branch, machine: job.machine });
      (result.status === "removed" ? removed : skipped).push(w.path.split("/").pop());
    }
    notify({
      title: removed.length ? `Cleaned up ${removed.join(", ")}` : "Nothing cleaned up",
      body: skipped.length ? `Skipped (uncommitted changes): ${skipped.join(", ")}` : undefined,
      level: skipped.length ? "warning" : "success",
    });
    const entry = cache.get(`wt|${this.repoId}`);
    if (entry) cache.set(`wt|${this.repoId}`, { ...entry, at: 0 });
    cx.notify();
  }

  // ---------- GitHub ----------

  pullRequestEntry(pr) {
    const colors = palette(theme());
    const skill = getDefaultGithubSkill({ pr, login: session.login });
    const target = { ref: pr.url, label: `#${pr.number}`, folder: this.folder };
    const ci = CI_STATUS[pr.ci];
    const review = getMyReviewState({ pr, login: session.login });
    const agent = findAgentFor({ label: target.label, branch: pr.branch });
    // Reviews run in a background tab, so several can start in a row.
    const primary = this.primaryFor({ agent, branch: pr.branch, skill, target, isWorktree: false, isBackground: true });
    const tags = [
      ...this.agentTag(agent),
      ...(pr.isDraft ? [{ label: "Draft", tone: "neutral" }] : []),
      ...(review === "rereview" ? [{ label: "Re-review", tone: "warning" }] : []),
      ...(DECISION_TAG[pr.decision] ? [DECISION_TAG[pr.decision]] : []),
    ];
    const element = this.row({
      id: pr.id, title: pr.title, isTitleDim: pr.isDraft, ref: `#${pr.number}`, tags, primary,
      status: { icon: `ci-${pr.ci}`, color: colors[ci.tone], tip: ci.tip },
      meta: [pr.author, formatAge(pr.createdAt)].filter(Boolean),
      diff: { additions: pr.additions, deletions: pr.deletions },
      actions: [
        { id: `open-${pr.number}`, name: "external", tip: "Open on GitHub (o)", onClick: (_e, cx) => cx.open_url(pr.url) },
      ],
      menu: { skills: GITHUB_SKILLS, target, isBackground: true },
    });
    return { id: pr.id, url: pr.url, element, primary: primary.run, start: (s) => startSkill({ skill: s, target, isBackground: true }) };
  }

  githubView() {
    const t = theme();
    const store = this.githubStore();
    const f = getFilters(store);
    // While a new search or filter loads, keep showing the last list of this repo.
    const fresh = cache.get(this.githubKey)?.result;
    if (fresh) this.lastGithub = { repoId: this.repoId, result: fresh };
    const result = fresh ?? (this.lastGithub && this.lastGithub.repoId === this.repoId ? this.lastGithub.result : undefined);
    const items = result?.items ?? [];
    const search = this.githubSearch.value();
    const shown = filterPullRequests({ items, filters: f, login: session.login, isShowingReviewed: this.isShowingReviewed });
    const org = repoNames.get(this.repoId)?.split("/")[0];
    const teamOptions = [...new Map([
      ...f.teams.map((value) => [value, value.split("/").pop()]),
      ...(myTeams.get(org) ?? []).map((team) => [team.value, team.label]),
    ]).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    const reviewedCount = isReviewScope(f.scope) ? items.filter((pr) => getMyReviewState({ pr, login: session.login }) === "reviewed").length : 0;
    const defs = [
      { title: "Author", field: "authors", isMulti: true, options: toOptions([...items.map((p) => p.author), ...f.authors]) },
      { title: "Label", field: "labels", isMulti: true, options: toOptions([...(repoLabels.get(this.repoId) ?? []), ...f.labels]) },
      { title: "Team", field: "teams", isMulti: true, options: teamOptions },
      { title: "Reviews", field: "reviews", isMulti: false, options: REVIEW_OPTIONS },
      {
        title: "Assignee", field: "assignees", isMulti: true,
        options: [{ value: NO_ASSIGNEE, label: "Assigned to nobody" }, ...toOptions([...items.flatMap((p) => p.assignees), ...f.assignees.filter((a) => a !== NO_ASSIGNEE)])],
      },
      { title: "CI", field: "checks", isMulti: false, options: CI_OPTIONS },
      { title: "Sort", field: "sort", isMulti: false, options: SORT_OPTIONS },
    ];
    const handleClear = () => { this.githubSearch.set_value(""); setShared(store, { ...GITHUB_DEFAULTS, scope: f.scope }); };
    const state = this.listState({
      source: result, label: "GitHub", shownCount: shown.length, onClear: handleClear,
      hasFilters: defs.some((def) => countPicked({ store, def }) > 0) || search.trim() !== "",
    });
    const entries = shown.map((pr) => this.pullRequestEntry(pr));
    const notes = this.cleanupNote();
    this.visible.github = entries.map((e, index) => ({ ...e, index: index + notes.length }));
    const repo = repoNames.get(this.repoId);
    const footer = [
      ...(reviewedCount > 0 ? [this.note({
        id: "gh-reviewed",
        text: this.isShowingReviewed ? `Showing ${reviewedCount} you already reviewed.` : `${reviewedCount} you already reviewed hidden.`,
        action: { label: this.isShowingReviewed ? "Hide" : "Show", onClick: (cx) => { this.isShowingReviewed = !this.isShowingReviewed; cx.notify(); } },
      })] : []),
      ...(result?.status === "success" && result.total > items.length ? [this.note({
        id: "gh-more",
        text: inflight.has(`${this.githubKey}|more`) ? `Loading more of ${result.total}…` : `Showing ${items.length} of ${result.total}.`,
        action: result.hasMore && !inflight.has(`${this.githubKey}|more`) ? { label: "Load more", onClick: (cx) => this.loadMore(cx) } : null,
      })] : []),
    ];
    return v_flex().flex_1().min_h(0)
      .child(v_flex().px(10).pb(4).gap(6).border_b(1).border_color(t.border)
        .child(this.searchRow({ store, scopeDef: { title: "Show", field: "scope", isMulti: false, options: GITHUB_SCOPES }, state: this.githubSearch, defs })))
      .when(Boolean(repo), (el) => el.child(div().px(10).pt(6).pb(2).text_size(11).text_color(t.dim).truncate().child(repo)))
      .child(this.list({ id: "gh-list", state, entries: [...notes, ...entries.map((e) => e.element), ...footer] }));
  }

  // ---------- Linear ----------

  issueEntry({ issue, showAssignee }) {
    const isWorktree = isWorktreeTicket(issue.identifier);
    const colors = palette(theme());
    const skill = getDefaultLinearSkill(issue);
    const stage = getIssueStage(issue);
    const worktree = (cache.get(`wt|${this.repoId}`)?.result.items ?? []).find((w) => w.branch === issue.branch)?.path;
    const target = { ref: issue.identifier, prRef: issue.prUrl, label: issue.identifier, branch: issue.branch, main: this.repoMain(), ...(worktree ? { worktree } : {}) };
    const agent = findAgentFor({ label: issue.identifier, branch: issue.branch });
    const primary = this.primaryFor({ agent, branch: issue.branch, skill, target, isWorktree: isWorktree && Boolean(target.main) });
    const priority = PRIORITY_OPTIONS.find((p) => p.value === issue.priority);
    const element = this.row({
      id: issue.id, title: issue.title, ref: issue.identifier, primary,
      badge: issue.priority > 0 ? { icon: `priority-${issue.priority}`, color: issue.priority === URGENT ? colors.danger : colors.quiet, tip: priority?.label ?? "" } : null,
      status: { icon: `state-${stage}`, color: colors[STAGE_STATUS[stage]], tip: issue.state },
      meta: [issue.project, showAssignee ? (issue.assignee ?? UNASSIGNED) : null, issue.labels[0]].filter(Boolean),
      tags: [...this.agentTag(agent), ...(issue.prUrl ? [{ label: `PR #${issue.prUrl.split("/").pop()}`, tone: "quiet", url: issue.prUrl }] : [])],
      actions: [
        { id: `open-${issue.id}`, name: "external", tip: "Open in Linear (o)", onClick: (_e, cx) => cx.open_url(issue.url) },
      ],
      menu: { skills: LINEAR_SKILLS, target, hasWorktreeToggle: true },
    });
    return { id: issue.id, url: issue.url, element, primary: primary.run, start: (s) => startSkill({ skill: s, target, isWorktree: isWorktree && Boolean(target.main) }) };
  }

  groupHeader(group) {
    const t = theme();
    const stage = getIssueStage(group.items[0]);
    return h_flex().id(`grp-${group.state}`).flex_none().px(10).pt(10).pb(4).gap(6).items_center()
      .text_size(11).font_semibold().text_color(t.muted)
      .child(svg(icon(`state-${stage}`)).size(12).text_color(palette(t)[STAGE_STATUS[stage]]))
      .child(`${group.state} · ${group.items.length}`);
  }

  linearView() {
    const t = theme();
    const store = STORE.linear;
    const f = getFilters(store);
    const result = cache.get(this.linearKey)?.result;
    const items = result?.items ?? [];
    const search = this.linearSearch.value();
    const shown = filterIssues({ items, filters: f, search });
    const defs = [
      { title: "Team", field: "teams", isMulti: true, options: session.meta.teams },
      { title: "Project", field: "projects", isMulti: true, options: getProjectOptions({ projects: session.meta.projects, teams: f.teams }) },
      { title: "Status", field: "statuses", isMulti: true, options: toOptions([...items.map((i) => i.state), ...f.statuses]) },
      { title: "Priority", field: "priorities", isMulti: true, options: PRIORITY_OPTIONS },
      { title: "Label", field: "labels", isMulti: true, options: toOptions([...items.flatMap((i) => i.labels), ...f.labels]) },
      ...(f.mine ? [] : [{ title: "Assignee", field: "assignees", isMulti: true, options: [{ value: UNASSIGNED, label: UNASSIGNED }, ...toOptions(items.map((i) => i.assignee))] }]),
    ];
    const handleClear = () => { this.linearSearch.set_value(""); setShared(store, { ...LINEAR_DEFAULTS, mine: f.mine }); };
    const state = this.listState({
      source: cache.get(this.linearKey)?.result, label: "Linear", shownCount: shown.length, onClear: handleClear,
      hasFilters: defs.some((def) => countPicked({ store, def }) > 0) || search.trim() !== "",
    });
    // Notes, headers and rows side by side, so a row's child index is known for scrolling.
    const elements = [...this.cleanupNote()];
    const selectable = [];
    for (const group of groupIssuesByState(shown)) {
      elements.push(this.groupHeader(group));
      for (const issue of group.items) {
        const entry = this.issueEntry({ issue, showAssignee: !f.mine });
        selectable.push({ ...entry, index: elements.length });
        elements.push(entry.element);
      }
    }
    this.visible.linear = selectable;
    if (result?.isCapped) elements.push(this.note({ id: "ln-cap", text: "Showing the 100 most recently updated. Narrow the filters to see more." }));
    return v_flex().flex_1().min_h(0)
      .child(v_flex().px(10).pb(4).gap(6).border_b(1).border_color(t.border)
        .child(this.searchRow({ store, scopeDef: { title: "Show", field: "mine", isMulti: false, options: LINEAR_SCOPES }, state: this.linearSearch, defs })))
      .child(this.list({ id: "ln-list", state, entries: elements }));
  }

  // ---------- menu popup ----------

  // Every pickable row registers here, in order, so ↑/↓ and ↵ can reach it.
  registerMenuItem({ onClick, scroll = null }) {
    const index = this.menuItems.length;
    this.menuItems.push({ onClick, scroll });
    return index === this.menuIndex;
  }

  // An action row gets a leading `actionIcon`; a choice row gets a trailing tick when `isChecked`.
  menuRow({ id, label, actionIcon = null, isChecked, onClick, scroll = null }) {
    const t = theme();
    const isActive = this.registerMenuItem({ onClick, scroll });
    return h_flex().id(id).h(MENU_ROW_HEIGHT).flex_none().px(9).gap(8).items_center().rounded(6).cursor_pointer()
      .bg(isActive ? t.selected : t.popover).text_color(t.foreground).hover((s) => s.bg(t.selected)).on_click((_e, cx) => onClick(cx))
      .when(Boolean(actionIcon), (el) => el.child(svg(icon(actionIcon)).size(11).flex_none().text_color(t.accent)))
      .child(div().flex_1().truncate().child(label))
      .when(isChecked, (el) => el.child(svg(icon("check")).size(13).flex_none().text_color(t.accent)));
  }

  handleMenuKey(e, cx) {
    const count = this.menuItems.length;
    if (count === 0) return;
    const move = (step) => {
      this.menuIndex = Math.max(0, Math.min(count - 1, this.menuIndex + step));
      const scroll = this.menuItems[this.menuIndex]?.scroll;
      if (scroll) scroll.handle.scroll_to_item(scroll.index);
    };
    if (e.key === "down") move(1);
    else if (e.key === "up") move(-1);
    else if (e.key === "enter") this.menuItems[this.menuIndex]?.onClick(cx);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  matchesMenuSearch(label) {
    return String(label).toLowerCase().includes(this.menuSearch.value().trim().toLowerCase());
  }

  optionRows({ store, def, scrollHandle }) {
    const value = getFilters(store)[def.field];
    const isPinned = (o) => def.isMulti && this.pinned.has(`${def.field}:${o.value}`);
    const options = def.options.filter((o) => this.matchesMenuSearch(o.label))
      .sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)));
    if (options.length === 0) return [div().flex_none().px(9).py(6).text_color(theme().dim).child(def.options.length ? "No matches" : "No options yet")];
    const firstIndex = this.menuItems.length;
    return options.map((o, i) => {
      const isChecked = def.isMulti ? value.includes(o.value) : value === o.value;
      return this.menuRow({
        // The list's own children: a group title (in a combined menu) may sit before them.
        id: `opt-${def.field}-${o.value}`, label: o.label, isChecked,
        scroll: scrollHandle ? { handle: scrollHandle, index: firstIndex - this.menuListOffset + i } : null,
        onClick: () => {
          const next = def.isMulti ? (isChecked ? value.filter((v) => v !== o.value) : [...value, o.value]) : o.value;
          patchFilters({ store, patch: { [def.field]: next } });
          if (!def.isMulti && !props().menu.isFilterList) closeOverlay(props().overlay);
        },
      });
    });
  }

  skillRows(menu) {
    const t = theme();
    const isWorktree = menu.hasWorktreeToggle && isWorktreeTicket(menu.target.ref);
    const isNewWorktree = isWorktree && Boolean(menu.target.main);
    const rows = menu.skills.map((skill) => this.menuRow({
      id: `skill-${skill}`, label: skill, actionIcon: isNewWorktree ? "branch" : "play",
      onClick: () => {
        pendingStart = { skill, target: menu.target, isWorktree: isNewWorktree, isBackground: Boolean(menu.isBackground) };
        closeOverlay(props().overlay);
        run("hub.start");
      },
    }));
    if (!menu.hasWorktreeToggle) return rows;
    return [...rows, div().h(1).flex_none().my(3).bg(t.border),
      this.menuRow({ id: "skill-worktree", label: "In new worktree", isChecked: isWorktree, onClick: () => setWorktreeTicket({ identifier: menu.target.ref, isOn: !isWorktree }) })];
  }

  menuSearchBox() {
    const t = theme();
    return h_flex().h(30).flex_none().px(8).gap(6).items_center().rounded(6).border(1).border_color(t.input).bg(t.background)
      .child(svg(icon("search")).size(13).text_color(t.dim))
      .child(Input.new(this.menuSearch).flex_1().text_size(12).text_color(t.foreground));
  }

  // The Filters popover: one row per filter; clicking a row opens its options in place (one at a time).
  filterListRows(menu) {
    const t = theme();
    const { store, groups } = menu;
    const total = groups.reduce((sum, def) => sum + countPicked({ store, def }), 0);
    const rows = groups.flatMap((def) => {
      const count = countPicked({ store, def });
      const isOpen = this.expanded === def.field;
      const handleToggle = (cx) => {
        this.expanded = isOpen ? null : def.field;
        this.menuSearch.set_value("");
        this.shouldSelectFirstOption = !isOpen;
        if (!isOpen) this.menuSearch.focus();
        cx.notify();
      };
      const isActive = this.registerMenuItem({ onClick: handleToggle });
      const header = h_flex().id(`fl-${def.field}`).h(MENU_ROW_HEIGHT).flex_none().px(9).gap(6).items_center().rounded(6).cursor_pointer()
        .bg(isOpen || isActive ? t.selected : t.popover).text_color(count > 0 || isOpen ? t.foreground : t.muted)
        .hover((s) => s.bg(t.selected).text_color(t.foreground))
        .on_click((_e, cx) => handleToggle(cx))
        .child(div().flex_1().child(def.title))
        .when(count > 0, (el) => el.child(div().px(5).rounded(8).bg(t.accent).text_color(t.accent_foreground).text_size(10.5).child(String(count))))
        .child(svg(icon(isOpen ? "chevron-up" : "chevron")).size(12));
      if (!isOpen) return [header];
      this.firstOptionIndex = this.menuItems.length;
      if (this.shouldSelectFirstOption) { this.menuIndex = this.firstOptionIndex; this.shouldSelectFirstOption = false; }
      this.menuListOffset = this.firstOptionIndex;
      const options = this.optionRows({ store, def, scrollHandle: this.optionScroll });
      return [header, v_flex().flex_none().pl(8).pt(4).pb(4).gap(4)
        .child(this.menuSearchBox())
        .child(v_flex().id(`fl-list-${def.field}`).h(Math.min(options.length, FILTER_OPTIONS_VISIBLE) * MENU_ROW_HEIGHT).overflow_y_scrollbar().track_scroll(this.optionScroll).children(options))];
    });
    return [...rows, div().h(1).flex_none().my(3).bg(t.border),
      h_flex().id("fl-clear").h(MENU_ROW_HEIGHT - 4).flex_none().px(9).items_center().rounded(6).text_size(12)
        .text_color(total > 0 ? t.foreground : t.dim).when(total > 0, (el) => el.cursor_pointer().hover((s) => s.bg(t.selected)))
        .on_click(() => { if (total > 0) patchFilters({ store, patch: Object.fromEntries(groups.map((def) => [def.field, defaultsFor(store)[def.field]])) }); })
        .child(total > 0 ? `Clear ${total} filter${total === 1 ? "" : "s"}` : "No filters on")];
  }

  menuView() {
    const t = theme();
    const menu = props().menu;
    const groups = menu.groups ?? [];
    this.menuItems = [];
    this.menuListOffset = 0;
    if (menu.isFilterList) {
      // Frameless popup: draw the box ourselves, sized to its content.
      return v_flex().id("hub-filters").size_full().text_size(12.8)
        .track_focus(this.menuHandle).on_key_down((e, cx) => this.handleMenuKey(e, cx))
        .child(v_flex().w_full().flex_none().p(5).gap(1).rounded(8).border(1).border_color(t.border).bg(t.popover).shadow_lg()
          .children(this.filterListRows(menu)));
    }
    const hasSearch = !menu.skills;
    const rows = menu.skills
      ? this.skillRows(menu)
      : groups.filter((def) => groups.length === 1 || def.options.some((o) => this.matchesMenuSearch(o.label))).flatMap((def) => [
        ...(groups.length > 1 ? [div().flex_none().px(9).pt(8).pb(2).text_size(11).font_semibold().text_color(t.muted).child(def.title)] : []),
        ...this.optionRows({ store: menu.store, def, scrollHandle: groups.length === 1 ? this.menuScroll : null }),
      ]);
    this.menuIndex = Math.min(this.menuIndex, Math.max(0, this.menuItems.length - 1));
    return v_flex().id("hub-menu").w_full().bg(t.popover).p(5).gap(4).text_size(12.8)
      .track_focus(this.menuHandle).on_key_down((e, cx) => this.handleMenuKey(e, cx))
      .when(hasSearch, (el) => el.child(this.menuSearchBox()))
      .child(v_flex().id("hub-menu-list").h(menu.height - MENU_PADDING - (hasSearch ? MENU_SEARCH_HEIGHT : 0)).overflow_y_scrollbar().track_scroll(this.menuScroll).children(rows));
  }

  // ---------- panel ----------

  tabButton({ id, label, iconName, count, isOn }) {
    const t = theme();
    return h_flex().id(`tab-${id}`).h(26).px(10).gap(6).items_center().rounded(6).text_size(12.5).cursor_pointer()
      .bg(isOn ? t.selected : t.background).text_color(isOn ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
      .on_click(() => setShared(STORE.tab, id))
      .child(svg(icon(iconName)).size(13))
      .child(label)
      .when(count !== null, (el) => el.child(div().text_size(11).text_color(t.dim).child(String(count))));
  }

  render() {
    if (this.isMenu) return this.menuView();
    const t = theme();
    const tab = currentTab();
    const isLoading = inflight.has(this.githubKey) || inflight.has(this.linearKey);
    const countOf = (key) => {
      const result = cache.get(key)?.result;
      return result?.status === "success" ? (result.total ?? result.items.length) : null;
    };
    return v_flex().id("hub").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .track_focus(this.handle).on_key_down((e, cx) => this.handleKey(e, cx))
      .child(h_flex().px(10).py(8).gap(4).items_center()
        .child(this.tabButton({ id: "github", label: "GitHub", iconName: "github", count: countOf(this.githubKey), isOn: tab === "github" }))
        .child(this.tabButton({ id: "linear", label: "Linear", iconName: "linear", count: countOf(this.linearKey), isOn: tab === "linear" }))
        .child(div().flex_1())
        .child(div().id("hub-refresh").size(24).flex().items_center().justify_center().rounded(6).cursor_pointer()
          .text_color(t.muted).hover((s) => s.bg(t.hover)).tooltip("Refresh")
          .on_click((_e, cx) => this.handleRefresh(cx))
          .child(isLoading ? svg("mods/workspace-chrome/spinner.svg").size(14).text_color(t.working).spin(900) : svg(icon("refresh")).size(14))))
      .child(tab === "github" ? this.githubView() : this.linearView())
      .child(div().flex_none().px(10).py(5).border_t(1).border_color(t.border).text_size(10.5).text_color(t.dim).truncate().child(KEY_HINTS[tab]));
  }
}
