import { paths } from "./platform-paths.js";
import { openApi } from "./platform-open.js";
// Open with: opens the focused pane's folder in a code editor installed on this computer.
// Other mods open it with openOverlay({ mod: "open-with", kind: "popup", props: { folder, machine } }), or props.file (full path) for one file; a text file is also offered to kanso-panel's preview.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, run, notify, theme, props, closeOverlay, focused, panes, spaces, home, appHome, shared, setShared, layout, window as win } from "herdr";
import { walkLayout, commitLayout } from "./layout.js";
import { listKey, moveTo } from "./listkeys.js";
import { isText } from "./kinds.js";

const MOD = "open-with";
const RECENT = `${MOD}.recent`;
const FOUND = `${MOD}.found`;
const ICONS = `data/${MOD}/icons`;

// Catalog order is the order shown before anything was used; family: how a remote (SSH) folder opens; bin: the CLI inside the macOS bundle.
const VSC = "Contents/Resources/app/bin/";
const EDITORS = [
  { id: "cursor", name: "Cursor", mac: ["Cursor.app"], cli: ["cursor"], family: "vscode", bin: VSC + "cursor", icon: "icons/cursor.svg" },
  { id: "vscode", name: "VS Code", mac: ["Visual Studio Code.app"], cli: ["code"], flatpak: ["com.visualstudio.code"], family: "vscode", bin: VSC + "code" },
  { id: "vscode-insiders", name: "VS Code Insiders", mac: ["Visual Studio Code - Insiders.app"], cli: ["code-insiders"], family: "vscode", bin: VSC + "code-insiders" },
  { id: "windsurf", name: "Windsurf", mac: ["Windsurf.app"], cli: ["windsurf"], family: "vscode", bin: VSC + "windsurf" },
  { id: "antigravity", name: "Antigravity", mac: ["Antigravity.app"], cli: ["antigravity", "agy"], family: "vscode", bin: VSC + "antigravity", icon: "icons/antigravity.svg" },
  { id: "kiro", name: "Kiro", mac: ["Kiro.app"], cli: ["kiro"], family: "vscode", bin: VSC + "kiro", icon: "icons/kiro.svg" },
  { id: "trae", name: "Trae", mac: ["Trae.app"], cli: ["trae"], family: "vscode", bin: VSC + "trae" },
  { id: "vscodium", name: "VSCodium", mac: ["VSCodium.app"], cli: ["codium"], flatpak: ["com.vscodium.codium"], family: "vscode", bin: VSC + "codium" },
  { id: "positron", name: "Positron", mac: ["Positron.app"], cli: ["positron"] },
  { id: "zed", name: "Zed", mac: ["Zed.app", "Zed Preview.app"], cli: ["zed", "zeditor"], flatpak: ["dev.zed.Zed"], family: "zed", bin: "Contents/MacOS/cli" },
  { id: "sublime", name: "Sublime Text", mac: ["Sublime Text.app"], cli: ["subl"], flatpak: ["com.sublimetext.three"] },
  { id: "idea", name: "IntelliJ IDEA", mac: ["IntelliJ IDEA.app", "IntelliJ IDEA Ultimate.app", "IntelliJ IDEA CE.app"], cli: ["idea", "intellij-idea-ultimate", "intellij-idea-community"] },
  { id: "webstorm", name: "WebStorm", mac: ["WebStorm.app"], cli: ["webstorm"] },
  { id: "pycharm", name: "PyCharm", mac: ["PyCharm.app", "PyCharm Professional Edition.app", "PyCharm CE.app"], cli: ["pycharm", "pycharm-professional", "pycharm-community"] },
  { id: "goland", name: "GoLand", mac: ["GoLand.app"], cli: ["goland"] },
  { id: "phpstorm", name: "PhpStorm", mac: ["PhpStorm.app"], cli: ["phpstorm"] },
  { id: "rubymine", name: "RubyMine", mac: ["RubyMine.app"], cli: ["rubymine"] },
  { id: "rustrover", name: "RustRover", mac: ["RustRover.app"], cli: ["rustrover"] },
  { id: "clion", name: "CLion", mac: ["CLion.app"], cli: ["clion"] },
  { id: "rider", name: "Rider", mac: ["Rider.app"], cli: ["rider"] },
  { id: "fleet", name: "Fleet", mac: ["Fleet.app"], cli: ["fleet"] },
  { id: "nova", name: "Nova", mac: ["Nova.app"], cli: ["nova"] },
  { id: "bbedit", name: "BBEdit", mac: ["BBEdit.app"], cli: ["bbedit"] },
  { id: "textmate", name: "TextMate", mac: ["TextMate.app"], cli: ["mate"] },
  { id: "xcode", name: "Xcode", mac: ["Xcode.app"] },
  { id: "nvim", name: "Neovim", cli: ["nvim"], tui: true, icon: "icons/nvim.svg" },
  { id: "hx", name: "Helix", cli: ["hx", "helix"], tui: true, icon: "icons/hx.svg" },
  { id: "vim", name: "Vim", cli: ["vim"], tui: true, icon: "icons/vim.svg" },
];
const BY_ID = Object.fromEntries(EDITORS.map((e) => [e.id, e]));
const TILES = ["#5b8def", "#22a99a", "#8b7cf6", "#e3814f", "#3fae6a", "#d9649a"];

// One shell pass: prints `app|cli|flatpak <tab> key <tab> path` per hit.
const PREVIEW = { id: "preview", name: "Preview in the panel", icon: "mods/kanso-chrome/icons/file-text.svg", builtin: true };

function showPreview(file, machine) {
  if (!walkLayout(layout(), "panel-body")) return false;
  const child = { id: "preview", type: "block", content: { mod: "kanso-panel", props: { panel: "preview", path: file, on: machine } } };
  return commitLayout({ panel: child });
}

function shortPath(folder, machine) {
  const h = home();
  if (!machine && folder.startsWith(h)) return "~" + folder.slice(h.length);
  return folder;
}

export default class OpenWith extends View {
  init(_props, cx) {
    this.platform = win()?.platform ?? "macos";
    this.found = shared(FOUND) ?? null;
    this.at = 0;
    this.icons = {};
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.target = this.resolveTarget();
    cx.spawn(async (cx) => {
      try {
        this.found = await openApi(this.platform, exec).detectEditors(EDITORS);
        setShared(FOUND, this.found);
      } catch (err) {
        this.error = String(err?.message ?? err);
      }
      cx.notify();
      await this.loadIcons();
      cx.notify();
    });
  }

  resolveTarget() {
    const p = props() ?? {};
    if (p.file) return { folder: p.folder ?? paths.dirname(p.file), machine: p.machine ?? null, file: p.file };
    if (p.folder) return { folder: p.folder, machine: p.machine ?? null };
    const f = focused();
    const space = spaces().find((s) => s.id === f?.space) ?? spaces().find((s) => s.active);
    const pane = panes().find((x) => x.focused);
    const folder = f?.cwd || pane?.cwd || space?.folder || home();
    return { folder, machine: space?.machine ?? null };
  }

  async loadIcons() {
    const ids = await openApi(this.platform, exec).editorIcons(this.found ?? {}, paths.join(appHome(), ICONS)).catch(() => []);
    this.icons = Object.fromEntries(ids.map((id) => [id, `${ICONS}/${id}.png`]));
  }

  list() {
    const recent = (shared(RECENT) ?? []).filter((id) => BY_ID[id]);
    const have = EDITORS.filter((e) => this.found?.[e.id]);
    const rank = (e) => { const i = recent.indexOf(e.id); return i < 0 ? 1000 + EDITORS.indexOf(e) : i; };
    const gui = have.filter((e) => !e.tui).toSorted((a, b) => rank(a) - rank(b));
    const tui = have.filter((e) => e.tui).toSorted((a, b) => rank(a) - rank(b));
    const own = this.target.file && isText(this.target.file) ? [PREVIEW] : [];
    return [...own, ...gui, ...tui];
  }

  canOpen(e) {
    if (e.builtin || !this.target.machine) return true;
    return e.tui || e.family === "vscode" || e.family === "zed";
  }

  close() {
    closeOverlay(props().overlay);
  }

  async open(e) {
    if (!e || !this.canOpen(e)) return;
    const { folder, machine, file } = this.target;
    this.close();
    if (e.builtin) { showPreview(file, machine); return; }
    const how = this.found[e.id];
    setShared(RECENT, [e.id, ...(shared(RECENT) ?? []).filter((x) => x !== e.id)].slice(0, 12));
    if (e.tui) {
      // A path found here means nothing on another machine: run it by name there.
      run("terminal.open", { argv: [machine || !how.cli ? e.cli[0] : how.cli, file ?? "."], folder, place: "right" });
      return;
    }
    try {
      const r = await this.launch(e, how, file ?? folder, machine);
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `exit ${r.code}`);
    } catch (err) {
      notify({ title: `Could not open ${e.name}`, body: String(err?.message ?? err).slice(0, 300), level: "error" });
    }
  }

  launch(e, how, folder, machine) {
    const cli = how.cli ?? (how.app && e.bin ? paths.join(how.app, e.bin) : null);
    if (machine) {
      if (!cli) throw new Error(`${e.name} has no command line to open a folder on ${machine}`);
      const args = e.family === "zed" ? [`ssh://${machine}${folder.startsWith("/") ? "" : "/"}${folder}`] : ["--remote", `ssh-remote+${machine}`, folder];
      return this.spawn(cli, args);
    }
    if (how.app) return openApi(this.platform, exec).open(folder, { application: how.app });
    if (how.flatpak && !how.cli) return this.spawn("flatpak", ["run", how.flatpak, folder]);
    return this.spawn(cli, [folder]);
  }

  spawn(cli, args) {
    return openApi(this.platform, exec).spawn(cli, args);
  }

  glyph(e, t) {
    if (e.builtin) return div().size(18).flex_none().rounded(6).bg(t.accent + "33").flex().items_center().justify_center().child(svg(e.icon).size(13).text_color(t.foreground));
    if (this.icons[e.id]) return image(this.icons[e.id]).size(18).flex_none();
    if (e.icon) return div().size(18).flex_none().items_center().justify_center().flex().child(svg(e.icon).size(15).text_color(t.foreground));
    const c = TILES[EDITORS.indexOf(e) % TILES.length];
    return div().size(18).flex_none().rounded(6).bg(c).flex().items_center().justify_center()
      .text_size(10.5).font_bold().text_color("#ffffff").child(e.name[0]);
  }

  row(e, i, sel, t) {
    const ok = this.canOpen(e);
    const recent = (shared(RECENT) ?? [])[0] === e.id;
    const hint = !ok ? "local only" : e.builtin ? "no editor" : e.tui ? "split" : recent ? "last used" : "";
    return h_flex().id(`ow-${e.id}`).h(32).px(9).gap(10).rounded(6).items_center().flex_none()
      .text_color(ok ? t.foreground : t.dim)
      .when(i === sel && ok, (el) => el.bg(t.selected))
      .when(ok, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)))
      .on_click((_ev, cx) => { if (ok) this.open(e); else cx.stop_propagation(); })
      .child(this.glyph(e, t))
      .child(div().flex_1().truncate().child(e.name))
      .child(div().text_size(11).text_color(t.dim).child(hint))
      .child(div().w(12).text_size(11).text_color(t.dim).child(i < 9 && ok ? String(i + 1) : ""));
  }

  render() {
    const t = theme();
    const list = this.list();
    const pickable = list.filter((e) => this.canOpen(e));
    this.at = Math.max(0, Math.min(this.at, pickable.length - 1));
    const sel = list.indexOf(pickable[this.at]);
    const { folder, machine, file } = this.target;
    const shown = file ?? folder;
    const firstTui = list.findIndex((e) => e.tui);

    const note = !this.found ? div().px(9).py(8).text_color(t.dim).child("Looking for editors…")
      : this.error && !list.length ? div().px(9).py(8).text_color(t.blocked).child(`Could not look for editors: ${this.error}`)
      : !list.length ? div().px(9).py(8).text_color(t.dim).child("No code editor found. Install Cursor, VS Code, Zed or another editor and open this again.")
      : null;
    const body = [
      ...(note ? [note] : []),
      ...list.flatMap((e, i) => [...(i === firstTui ? [div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child("In a split")] : []), this.row(e, i, sel, t)]),
    ];

    return v_flex().id("open-with").track_focus(this.handle).w_full().min_h(0).bg(t.popover).p(6).text_size(12.8)
      .on_key_down((ev, cx) => {
        const k = ev.key, { move, gAt } = listKey(ev, this.listG);
        this.listG = gAt;
        if (move === "escape") return this.close();
        if (move === "enter") return void this.open(pickable[this.at]);
        if (move && move !== "pending") { if (pickable.length) this.at = moveTo(move, this.at, pickable.length); }
        else if (move === "pending") { /* the first g of gg */ }
        else if (!ev.modifiers.control && !ev.modifiers.platform && !ev.modifiers.alt && /^[1-9]$/.test(k)) return void this.open(list[Number(k) - 1]);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().px(9).pt(6).pb(8).gap(10).items_center()
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(14).font_semibold().text_color(t.foreground).child("Open with"))
          .child(div().text_size(11).text_color(t.dim).truncate().child(machine ? `${machine}: ${shown}` : shortPath(shown, machine))))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().h(1).mx(4).mb(4).bg(t.border))
      .child(v_flex().id("open-with-list").max_h(420).overflow_y_scrollbar().child(v_flex().flex_none().w_full().children(body)));
  }
}
