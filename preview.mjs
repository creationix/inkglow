#!/usr/bin/env node
// TUI theme previewer — renders a sample code snippet using 256-color ANSI
// codes to approximate theme colors in the terminal.
//
// Usage:
//   node preview.mjs                    # preview all themes
//   node preview.mjs dark.json          # preview specific theme(s)
//   node preview.mjs --compact          # side-by-side compact view (2 per row)
//   node preview.mjs --dark             # only dark themes
//   node preview.mjs --light            # only light themes
//   node preview.mjs --palette          # show the color palette with 256 mappings

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = import.meta.dirname;

// ── ANSI 256-color helpers ──────────────────────────────────────────────

const CUBE_VALUES = [0, 0x5f, 0x87, 0xaf, 0xd7, 0xff];

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function nearestCubeIndex(v) {
  let best = 0, bestDist = Math.abs(v - CUBE_VALUES[0]);
  for (let i = 1; i < 6; i++) {
    const d = Math.abs(v - CUBE_VALUES[i]);
    if (d < bestDist) { best = i; bestDist = d; }
  }
  return best;
}

function nearest256(hex) {
  const [r, g, b] = hexToRgb(hex);
  const ri = nearestCubeIndex(r), gi = nearestCubeIndex(g), bi = nearestCubeIndex(b);
  const cr = CUBE_VALUES[ri], cg = CUBE_VALUES[gi], cb = CUBE_VALUES[bi];
  const cubeDist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
  const cubeCode = 16 + 36 * ri + 6 * gi + bi;

  const gray = Math.round((r + g + b) / 3);
  const gi2 = Math.max(0, Math.min(23, Math.round((gray - 8) / 10)));
  const gv = 8 + gi2 * 10;
  const grayDist = (r - gv) ** 2 + (g - gv) ** 2 + (b - gv) ** 2;
  const grayCode = 232 + gi2;

  if (grayDist < cubeDist) return { code: grayCode, hex: rgbToHex(gv, gv, gv) };
  return { code: cubeCode, hex: rgbToHex(cr, cg, cb) };
}

// ANSI escape helpers
const ESC = "\x1b[";
const RESET = `${ESC}0m`;

function fg256(code) { return `${ESC}38;5;${code}m`; }
function bg256(code) { return `${ESC}48;5;${code}m`; }
function fgHex(hex) { return fg256(nearest256(hex).code); }
function bgHex(hex) { return bg256(nearest256(hex).code); }
function bold() { return `${ESC}1m`; }
function italic() { return `${ESC}3m`; }
function strikethrough() { return `${ESC}9m`; }
function underline() { return `${ESC}4m`; }

function style(hex, fontStyle) {
  let s = fgHex(hex);
  if (fontStyle) {
    if (fontStyle.includes("bold")) s += bold();
    if (fontStyle.includes("italic")) s += italic();
    if (fontStyle.includes("strikethrough")) s += strikethrough();
    if (fontStyle.includes("underline")) s += underline();
  }
  return s;
}

function parseValue(val) {
  const parts = val.split(/\s+/);
  return { color: parts[0], fontStyle: parts.slice(1).join(" ") || undefined };
}

// ── theme loading ───────────────────────────────────────────────────────

function loadTheme(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function discoverThemes() {
  return readdirSync(ROOT)
    .filter((f) => f.endsWith(".json") && f !== "scopes.json" && f !== "package.json" && f !== "tsconfig.json")
    .sort((a, b) => a.split("-").length - b.split("-").length || a.localeCompare(b))
    .map((f) => {
      try {
        const data = loadTheme(join(ROOT, f));
        if (data.tokens && data.ui && data.type) return { file: f, ...data };
      } catch {}
      return null;
    })
    .filter(Boolean);
}

// ── sample code snippet ─────────────────────────────────────────────────

// Each line is [role, text] pairs
const SAMPLE = [
  [["comment", "// A sample to preview theme colors"]],
  [["keyword", "fn "], ["function", "fibonacci"], ["bracket", "("], ["parameter", "n"], ["operator", ": "], ["type", "u32"], ["bracket", ")"], ["operator", " -> "], ["type", "u32"], ["bracket", " {"]],
  [["keyword.control", "  if "], ["parameter", "n"], ["operator", " <= "], ["number", "1"], ["keyword.control", " return "], ["parameter", "n"]],
  [["keyword", "  let "], ["variable", "result"], ["operator", " = "], ["function", "fibonacci"], ["bracket", "("], ["parameter", "n"], ["operator", " - "], ["number", "1"], ["bracket", ")"], ["operator", " + "], ["function", "fibonacci"], ["bracket", "("], ["parameter", "n"], ["operator", " - "], ["number", "2"], ["bracket", ")"]],
  [["keyword.control", "  return "], ["variable", "result"]],
  [["bracket", "}"]],
  [],
  [["comment", "// Types and strings"]],
  [["keyword", "struct "], ["type.user", "Config"], ["bracket", " {"]],
  [["keyword", "  "], ["property", "name"], ["operator", ": "], ["type", "String"], ["operator", " = "], ["string", "\"hello world\""]],
  [["keyword", "  "], ["property", "count"], ["operator", ": "], ["type", "u32"], ["operator", " = "], ["number", "42"]],
  [["keyword", "  "], ["property", "enabled"], ["operator", ": "], ["type", "bool"], ["operator", " = "], ["boolean", "true"]],
  [["keyword", "  "], ["property", "path"], ["operator", ": "], ["type", "String"], ["operator", " = "], ["string", "\"line 1"], ["escape", "\\n"], ["string", "line 2\""]],
  [["bracket", "}"]],
  [],
  [["comment", "// Global and output params"]],
  [["keyword", "let "], ["variable.global", "GLOBAL_STATE"], ["operator", " = "], ["number", "0"]],
  [["keyword", "fn "], ["function", "swap"], ["bracket", "("], ["parameter.output", "a"], ["operator", ": "], ["pointer", "*"], ["type", "u32"], ["operator", ", "], ["parameter.output", "b"], ["operator", ": "], ["pointer", "*"], ["type", "u32"], ["bracket", ")"], ["bracket", " {"]],
  [["keyword", "  let "], ["variable", "tmp"], ["operator", " = "], ["pointer", "*"], ["parameter.output", "a"]],
  [["keyword.control", "  "], ["pointer", "*"], ["parameter.output", "a"], ["operator", " = "], ["pointer", "*"], ["parameter.output", "b"]],
  [["keyword.control", "  "], ["pointer", "*"], ["parameter.output", "b"], ["operator", " = "], ["variable", "tmp"]],
  [["bracket", "}"]],
];

// ── rendering ───────────────────────────────────────────────────────────

const GAP = 2; // columns between side-by-side panels
const MIN_WIDTH = 40;
const DEFAULT_WIDTH = 60;

function renderTheme(theme, width = DEFAULT_WIDTH) {
  const bg = bgHex(theme.ui.background);
  const fgDefault = fgHex(theme.ui.foreground);
  const lineNumColor = fgHex(theme.ui.lineNumber);

  const lines = [];
  const title = ` ${theme.label || theme.name} (${theme.type}) `;
  const pad = Math.max(0, width - title.length);
  lines.push(bg + fgDefault + "─".repeat(Math.floor(pad / 2)) + title + "─".repeat(Math.ceil(pad / 2)) + RESET);

  for (let i = 0; i < SAMPLE.length; i++) {
    const tokens = SAMPLE[i];
    const lineNum = String(i + 1).padStart(3);
    let line = bg + lineNumColor + lineNum + " " + fgDefault;

    if (!tokens || !tokens.length) {
      line += " ".repeat(width - 4);
    } else {
      let col = 0;
      const maxCol = width - 4;
      for (const [role, text] of tokens) {
        if (col >= maxCol) break;
        const avail = maxCol - col;
        const display = text.length > avail ? text.slice(0, avail) : text;
        const val = theme.tokens[role];
        if (val) {
          const { color, fontStyle } = parseValue(val);
          line += style(color, fontStyle) + display + RESET + bg;
        } else {
          line += fgDefault + display;
        }
        col += display.length;
      }
      const remaining = maxCol - col;
      if (remaining > 0) line += " ".repeat(remaining);
    }

    lines.push(line + RESET);
  }

  lines.push(bg + fgDefault + "─".repeat(width) + RESET);
  return lines;
}

function showPalette(theme) {
  const { color: _, fontStyle: __ , ...rest } = theme;
  console.log(`\n  ╔══ ${theme.label || theme.name} ══╗\n`);

  const roles = Object.entries(theme.tokens);
  const maxLen = Math.max(...roles.map(([r]) => r.length));

  for (const [role, val] of roles) {
    const { color, fontStyle } = parseValue(val);
    const ansi = nearest256(color);
    const pad = " ".repeat(maxLen - role.length);
    const swatch = style(color, fontStyle) + "████" + RESET;
    const label = `${role}${pad}  ${swatch}  ${color}  → 256#${String(ansi.code).padStart(3)} ${ansi.hex}`;
    console.log(`  ${label}`);
  }

  console.log();
}

// ── main ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const showPaletteMode = args.includes("--palette");
const compactMode = args.includes("--compact");
const darkOnly = args.includes("--dark");
const lightOnly = args.includes("--light");
const fileArgs = args.filter((a) => !a.startsWith("--"));

let themes;
if (fileArgs.length) {
  themes = fileArgs.map((f) => {
    const path = f.includes("/") ? f : join(ROOT, f);
    return { file: f, ...loadTheme(path) };
  });
} else {
  themes = discoverThemes();
}

if (darkOnly) themes = themes.filter((t) => t.type === "dark");
if (lightOnly) themes = themes.filter((t) => t.type === "light");

if (!themes.length) {
  console.error("No themes found.");
  process.exit(1);
}

if (showPaletteMode) {
  for (const theme of themes) showPalette(theme);
} else if (compactMode) {
  // Auto-detect terminal width and fit as many columns as possible
  const termWidth = process.stdout.columns || parseInt(process.env.COLUMNS, 10) || 120;
  // Solve: cols * panelWidth + (cols - 1) * GAP <= termWidth
  // Start with max cols, shrink panel width to fit; ensure >= MIN_WIDTH
  const cols = Math.max(1, Math.min(themes.length, Math.floor((termWidth + GAP) / (MIN_WIDTH + GAP))));
  const panelWidth = Math.floor((termWidth - (cols - 1) * GAP) / cols);

  for (let g = 0; g < themes.length; g += cols) {
    const group = themes.slice(g, g + cols);
    const rendered = group.map((t) => renderTheme(t, panelWidth));
    const maxLines = Math.max(...rendered.map((r) => r.length));
    for (let i = 0; i < maxLines; i++) {
      let row = "";
      for (let c = 0; c < rendered.length; c++) {
        row += rendered[c][i] || "";
        if (c < rendered.length - 1) row += " ".repeat(GAP);
      }
      console.log(row);
    }
    if (g + cols < themes.length) console.log();
  }
} else {
  for (const theme of themes) {
    const lines = renderTheme(theme);
    for (const line of lines) console.log(line);
    console.log();
  }
}
