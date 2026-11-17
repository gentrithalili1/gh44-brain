import { powershell, psQuote, shellQuote, windowsArg } from "./platform-command.js";

const DETECT = `
for a in "$@"; do
  case "$a" in
    app:*) n=\${a#app:}
      for d in /Applications "$HOME/Applications" /Applications/Setapp "$HOME/Applications/JetBrains Toolbox"; do
        if [ -d "$d/$n" ]; then printf 'app\\t%s\\t%s\\n' "$n" "$d/$n"; break; fi
      done;;
    cli:*) n=\${a#cli:}
      p=$(command -v "$n" 2>/dev/null) && case "$p" in /*) printf 'cli\\t%s\\t%s\\n' "$n" "$p";; esac;;
  esac
done
if command -v flatpak >/dev/null 2>&1; then
  flatpak list --app --columns=application 2>/dev/null | awk '{ printf "flatpak\\t%s\\t\\n", $1 }'
fi`;

// macOS: each app's own icon as a 64 px PNG, made once.
const ICON = `
out=$1; shift; mkdir -p "$out"
while [ $# -gt 1 ]; do
  id=$1; app=$2; shift 2
  [ -f "$out/$id.png" ] && continue
  f=$(plutil -extract CFBundleIconFile raw "$app/Contents/Info.plist" 2>/dev/null) || continue
  case "$f" in *.icns) ;; *) f="$f.icns";; esac
  [ -f "$app/Contents/Resources/$f" ] && sips -s format png -Z 64 "$app/Contents/Resources/$f" --out "$out/$id.png" >/dev/null 2>&1
done
exit 0`;

export function openApi(platform, run) {
  async function detectEditors(editors) {
    if (platform === "windows") {
      const tries = editors.flatMap((e) => (e.cli ?? []).map((c) => [e, c]));
      const hits = (await Promise.all(tries.map(([e, c]) =>
        run("where", [c]).then((r) => (r.code === 0 ? [e, r.stdout.split(/\r?\n/)[0].trim()] : null)).catch(() => null)))).filter(Boolean);
      return Object.fromEntries(hits.filter((h, i) => hits.findIndex((x) => x[0].id === h[0].id) === i).map((h) => [h[0].id, { cli: h[1] }]));
    }
    const args = editors.flatMap((e) => [...(platform === "macos" ? (e.mac ?? []).map((m) => `app:${m}`) : []), ...(e.cli ?? []).map((c) => `cli:${c}`)]);
    const r = await run("sh", ["-c", DETECT, "sh", ...args]);
    const hits = r.stdout.split("\n").filter(Boolean).map((l) => l.split("\t"));
    return Object.fromEntries(editors.flatMap((e) => {
      const app = hits.find(([k, n]) => k === "app" && e.mac?.includes(n));
      const cli = hits.find(([k, n]) => k === "cli" && e.cli?.includes(n));
      const fp = hits.find(([k, n]) => k === "flatpak" && e.flatpak?.includes(n));
      return app || cli || fp ? [[e.id, { app: app?.[2], cli: cli?.[2], flatpak: fp?.[1] }]] : [];
    }));
  }
  const spawn = (program, args = [], options) => platform === "windows"
    ? powershell(run, `Start-Process -FilePath ${psQuote(program)}${args.length ? ` -ArgumentList ${psQuote(args.map(windowsArg).join(" "))}` : ""} -ErrorAction Stop`, options)
    : run("sh", ["-c", 'if command -v setsid >/dev/null 2>&1; then setsid -f "$@" >/dev/null 2>&1; else nohup "$@" >/dev/null 2>&1 & fi', "sh", program, ...args], options);
  const open = (target, { application, ...options } = {}) => platform === "windows" ? spawn(application || target, application ? [target] : [], options) : platform === "macos" ? run("open", [...(application ? ["-a", application] : []), target], options) : application ? spawn(application, [target], options) : run("xdg-open", [target], options);
  const terminalLine = (cwd, argv) => platform === "windows" ? `Set-Location -LiteralPath ${psQuote(cwd)}; if ($?) { & ${argv.map(psQuote).join(" ")} }` : `cd ${shellQuote(cwd)} && ${argv.map(shellQuote).join(" ")}`;
  const editorIcons = async (found, dir) => {
    if (platform !== "macos") return [];
    const pairs = Object.entries(found).filter(([, how]) => how.app).flatMap(([id, how]) => [id, how.app]);
    if (pairs.length) await run("sh", ["-c", ICON, "sh", dir, ...pairs]);
    const ids = Object.keys(found);
    if (!ids.length) return [];
    const result = await run("sh", ["-c", 'out="$1"; shift; for id in "$@"; do [ -f "$out/$id.png" ] && printf "%s\\n" "$id"; done; true', "sh", dir, ...ids]);
    return result.stdout.split("\n").filter((id) => ids.includes(id));
  };
  return { open, spawn, terminalLine, detectEditors, editorIcons };
}
