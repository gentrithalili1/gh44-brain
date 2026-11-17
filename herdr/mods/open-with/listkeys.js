// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Shared source: edit this file; `npm run sync:share` copies it into every mod.

const GG_MS = 1000; // vim's timeoutlen for the second g of gg

// `gAt`: the time of a pending first g (0: none); the list keeps it and hands it back.
export function listKey(e, gAt = 0, now = Date.now()) {
  const m = e?.modifiers ?? {};
  if (m.control || m.platform || m.alt || m.function) return { move: null, gAt };
  const k = String(e?.key ?? "").toLowerCase();
  const gg = gAt && now - gAt <= GG_MS;
  const move = k === "escape" ? "escape" : k === "enter" ? "enter"
    : k === "down" || (k === "j" && !m.shift) ? "down" : k === "up" || (k === "k" && !m.shift) ? "up"
    : k === "home" ? "first" : k === "end" || (k === "g" && m.shift) ? "last"
    : k === "g" ? (gg ? "first" : "pending") : null;
  return { move, gAt: move === "pending" ? now : 0 };
}

export function moveTo(move, at, n) {
  if (n <= 0) return 0;
  // Nothing chosen yet (-1): down takes the first, up the last.
  if (at < 0) return move === "up" || move === "last" ? n - 1 : 0;
  const i = Math.min(Math.max(0, at ?? 0), n - 1);
  if (move === "down") return Math.min(n - 1, i + 1);
  if (move === "up") return Math.max(0, i - 1);
  if (move === "first") return 0;
  if (move === "last") return n - 1;
  return i;
}
