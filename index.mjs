// @creationix/vscode-themes — programmatic access to theme data
//
// Import in CLI tools, REPLs, and other applications:
//
//   import { themes, scopes, getTheme, toAnsi256, colorize } from "@creationix/vscode-themes";
//
//   const dark = getTheme("Dark");
//   const ansi = colorize(dark, "comment", "// hello");
//   process.stdout.write(ansi);

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = import.meta.dirname;

// ── load all themes and scopes lazily ────────────────────────────────────

let _scopes = null;
let _themes = null;

export function getScopes() {
  if (!_scopes) _scopes = JSON.parse(readFileSync(join(ROOT, "scopes.json"), "utf-8"));
  return _scopes;
}

export function getAllThemes() {
  if (!_themes) {
    _themes = readdirSync(ROOT)
      .filter((f) => f.endsWith(".json") && f !== "scopes.json" && f !== "package.json" && f !== "tsconfig.json")
      .map((f) => {
        try {
          const data = JSON.parse(readFileSync(join(ROOT, f), "utf-8"));
          if (data.tokens && data.ui && data.type) return data;
        } catch {}
        return null;
      })
      .filter(Boolean);
  }
  return _themes;
}

export function getTheme(name) {
  return getAllThemes().find((t) => t.name === name || t.label === name);
}

// ── 256-color utilities ──────────────────────────────────────────────────

const CUBE = [0, 0x5f, 0x87, 0xaf, 0xd7, 0xff];

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function nearestCube(v) {
  let best = 0, d = Math.abs(v - CUBE[0]);
  for (let i = 1; i < 6; i++) { const dd = Math.abs(v - CUBE[i]); if (dd < d) { best = i; d = dd; } }
  return best;
}

/** Convert a hex color to the nearest ANSI 256-color code. */
export function toAnsi256(hex) {
  const [r, g, b] = hexToRgb(hex);

  const ri = nearestCube(r), gi = nearestCube(g), bi = nearestCube(b);
  const cr = CUBE[ri], cg = CUBE[gi], cb = CUBE[bi];
  const cubeDist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;

  const gray = Math.round((r + g + b) / 3);
  const gi2 = Math.max(0, Math.min(23, Math.round((gray - 8) / 10)));
  const gv = 8 + gi2 * 10;
  const grayDist = (r - gv) ** 2 + (g - gv) ** 2 + (b - gv) ** 2;

  return grayDist < cubeDist ? 232 + gi2 : 16 + 36 * ri + 6 * gi + bi;
}

/** Parse a compact token value "#hex style" into { color, fontStyle }. */
export function parseTokenValue(val) {
  const parts = val.split(/\s+/);
  return { color: parts[0], fontStyle: parts.slice(1).join(" ") || undefined };
}

/**
 * Wrap `text` in ANSI escape codes for the given token role in a theme.
 * Returns the styled string with a trailing reset sequence.
 */
export function colorize(theme, role, text) {
  const val = theme.tokens[role];
  if (!val) return text;

  const { color, fontStyle } = parseTokenValue(val);
  const code = toAnsi256(color);
  let prefix = `\x1b[38;5;${code}m`;
  if (fontStyle) {
    if (fontStyle.includes("bold")) prefix += "\x1b[1m";
    if (fontStyle.includes("italic")) prefix += "\x1b[3m";
    if (fontStyle.includes("underline")) prefix += "\x1b[4m";
    if (fontStyle.includes("strikethrough")) prefix += "\x1b[9m";
  }
  return `${prefix}${text}\x1b[0m`;
}

/**
 * Get a mapping of { role: ansi256Code } for a theme — useful for
 * building terminal highlight tables without repeated conversion.
 */
export function getAnsi256Map(theme) {
  const map = {};
  for (const [role, val] of Object.entries(theme.tokens)) {
    const { color, fontStyle } = parseTokenValue(val);
    map[role] = { code: toAnsi256(color), fontStyle };
  }
  return map;
}

// Re-export convenience aliases
export { getScopes as scopes, getAllThemes as themes };
