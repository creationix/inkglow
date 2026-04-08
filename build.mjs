#!/usr/bin/env node
// Build script — reads declarative theme files + scopes.json, generates
// VSCode color-theme JSON files into themes/ and Neovim colorschemes into colors/.
//
// Usage:
//   node build.mjs            # build all themes
//   node build.mjs --check    # validate only, don't write files

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = import.meta.dirname;
const THEMES_DIR = join(ROOT, "themes");
const COLORS_DIR = join(ROOT, "colors");

// ── helpers ──────────────────────────────────────────────────────────────

/** Parse a compact token value like "#ff9944 italic bold" into { foreground, fontStyle }. */
function parseTokenValue(value) {
  const parts = value.split(/\s+/);
  const foreground = parts[0]; // always the hex color
  const styles = parts.slice(1);
  const result = { foreground };
  if (styles.length) result.fontStyle = styles.join(" ");
  return result;
}

/** Load and parse a JSON file. */
function loadJSON(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** Discover theme source files — any root .json file that has a "tokens" key. */
function discoverThemes() {
  return readdirSync(ROOT)
    .filter((f) => f.endsWith(".json") && f !== "scopes.json" && f !== "package.json" && f !== "tsconfig.json")
    .sort((a, b) => a.split("-").length - b.split("-").length || a.localeCompare(b))
    .map((f) => {
      const data = loadJSON(join(ROOT, f));
      if (data.tokens && data.ui && data.type) return { file: f, data };
      return null;
    })
    .filter(Boolean);
}

// ── build a VSCode theme ─────────────────────────────────────────────────

function buildVSCodeTheme(theme, scopes) {
  const { tokenRoles, uiRoles } = scopes;

  // --- UI colors ---
  const colors = {};
  for (const [role, spec] of Object.entries(uiRoles)) {
    if (theme.data.ui[role] !== undefined) {
      colors[spec.key] = theme.data.ui[role];
    }
  }

  // Replicate panel color to related UI keys
  const panel = theme.data.ui.panel;
  if (panel) {
    if (!colors["sideBar.background"]) colors["sideBar.background"] = panel;
    if (!colors["statusBar.background"]) colors["statusBar.background"] = panel;
    if (!colors["titleBar.activeBackground"]) colors["titleBar.activeBackground"] = panel;
  }

  // --- Token colors ---
  const tokenColors = [];
  for (const [role, spec] of Object.entries(tokenRoles)) {
    const value = theme.data.tokens[role];
    if (value === undefined) continue;
    const settings = parseTokenValue(value);
    tokenColors.push({
      name: role,
      scope: spec.scopes,
      settings,
    });
  }

  // --- Semantic token colors ---
  const semanticTokenColors = {};
  if (theme.data.semantic) {
    for (const [token, value] of Object.entries(theme.data.semantic)) {
      const parsed = parseTokenValue(value);
      if (parsed.fontStyle) {
        semanticTokenColors[token] = { foreground: parsed.foreground, fontStyle: parsed.fontStyle };
      } else {
        semanticTokenColors[token] = parsed.foreground;
      }
    }
  }

  return {
    $schema: "vscode://schemas/color-theme",
    name: theme.data.label || theme.data.name,
    type: theme.data.type,
    colors,
    tokenColors,
    semanticHighlighting: true,
    semanticTokenColors,
  };
}

// ── validation ───────────────────────────────────────────────────────────

function validate(themes, scopes) {
  const { tokenRoles, semanticTokenTypes } = scopes;
  const tokenRoleNames = Object.keys(tokenRoles);
  const semanticNames = Object.keys(semanticTokenTypes);
  let ok = true;

  for (const theme of themes) {
    const name = theme.data.name;

    // Check for token roles in scopes.json not covered by this theme
    const missingTokens = tokenRoleNames.filter((r) => !(r in theme.data.tokens));
    if (missingTokens.length) {
      console.warn(`⚠ ${name}: missing token roles: ${missingTokens.join(", ")}`);
    }

    // Check for token roles in theme not defined in scopes.json
    const extraTokens = Object.keys(theme.data.tokens).filter((r) => !(r in tokenRoles));
    if (extraTokens.length) {
      console.error(`✗ ${name}: unknown token roles (not in scopes.json): ${extraTokens.join(", ")}`);
      ok = false;
    }

    // Check for semantic tokens in theme not defined in scopes.json
    if (theme.data.semantic) {
      const extraSemantic = Object.keys(theme.data.semantic).filter((s) => !(s in semanticTokenTypes));
      if (extraSemantic.length) {
        console.warn(`⚠ ${name}: semantic tokens not in registry: ${extraSemantic.join(", ")}`);
      }
    }
  }

  // Cross-theme consistency: ensure all themes define the same token roles
  if (themes.length > 1) {
    const allRoles = new Set(themes.flatMap((t) => Object.keys(t.data.tokens)));
    for (const role of allRoles) {
      const missing = themes.filter((t) => !(role in t.data.tokens)).map((t) => t.data.name);
      if (missing.length && missing.length < themes.length) {
        console.warn(`⚠ Token role "${role}" defined in some themes but missing from: ${missing.join(", ")}`);
      }
    }
  }

  return ok;
}

// ── build a Neovim colorscheme ────────────────────────────────────────────

// Maps token roles → Neovim highlight groups.
// Each entry is [role, ...groups]. Groups starting with @ are treesitter captures.
const VIM_TOKEN_MAP = [
  // Syntax
  ["comment",          "Comment", "@comment"],
  ["keyword",          "Keyword", "Statement", "StorageClass", "@keyword", "@keyword.type", "@keyword.function", "@keyword.modifier"],
  ["keyword.control",  "Conditional", "Repeat", "Exception", "@keyword.conditional", "@keyword.repeat", "@keyword.return", "@keyword.exception", "@keyword.coroutine"],
  ["operator",         "Operator", "@operator", "@keyword.operator"],
  ["string",           "String", "@string"],
  ["string.regexp",    "@string.regexp"],
  ["escape",           "SpecialChar", "@string.escape", "@character.special"],
  ["interpolation",    "@punctuation.special"],
  ["number",           "Number", "Float", "@number", "@number.float"],
  ["constant",         "Constant", "@constant", "@constant.builtin", "@variable.builtin"],
  ["boolean",          "Boolean", "@boolean"],
  ["type",             "Type", "@type", "@type.builtin"],
  ["type.user",        "Structure", "@type.definition", "@constructor"],
  ["type.nominal",     "@type"],       // falls back, custom langs can override
  ["type.comptime",    "@attribute"],   // closest standard match
  ["typeParameter",    "@type"],
  ["function",         "Function", "@function", "@function.call", "@function.builtin", "@function.method", "@function.method.call"],
  ["variable",         "Identifier", "@variable"],
  ["variable.constant","@constant", "@constant.macro", "@variable.member"],
  ["parameter",        "@variable.parameter", "@variable.parameter.builtin"],
  ["parameter.output", "@variable.parameter"],
  ["variable.global",  "@variable.builtin"],
  ["property",         "@property", "@variable.member"],
  ["tag",              "Tag", "@tag", "@tag.builtin"],
  ["tag.punctuation",  "@tag.delimiter"],
  ["attribute",        "@attribute", "@attribute.builtin", "@tag.attribute"],
  ["accessor",         "@punctuation.delimiter"],
  ["bracket",          "@punctuation.bracket"],
  ["pointer",          "@punctuation.special"],
  ["typepun",          "@punctuation.special"],
  ["punctuation",      "Delimiter", "@punctuation.delimiter"],
  ["invalid",          "Error"],
  ["deprecated",       "DiagnosticDeprecated"],
  ["support",          "Special"],
  ["preprocessor",     "PreProc", "Include", "Define", "Macro", "@keyword.directive", "@keyword.directive.define", "@keyword.import"],
  ["label",            "Label", "@label"],
  ["link",             "Underlined", "@markup.link.url", "@string.special.url"],

  // Markup
  ["markup.heading",   "Title", "@markup.heading", "@markup.heading.1", "@markup.heading.2", "@markup.heading.3", "@markup.heading.4", "@markup.heading.5", "@markup.heading.6"],
  ["markup.bold",      "@markup.strong"],
  ["markup.italic",    "@markup.italic"],
  ["markup.boldItalic","@markup.strong"],  // neovim doesn't have a bolditalic group
  ["markup.underline", "@markup.underline"],
  ["markup.strikethrough", "@markup.strikethrough"],
  ["markup.link",      "@markup.link"],
  ["markup.link.text", "@markup.link.label"],
  ["markup.code.inline","@markup.raw"],
  ["markup.code.block","@markup.raw.block"],
  ["markup.quote",     "@markup.quote"],
  ["markup.list",      "@markup.list", "@markup.list.checked", "@markup.list.unchecked"],
  ["markup.separator", "@punctuation.special"],
  ["markup.inserted",  "DiffAdd", "@diff.plus"],
  ["markup.deleted",   "DiffDelete", "@diff.minus"],
  ["markup.changed",   "DiffChange", "@diff.delta"],
  ["diff.range",       "DiffText"],
  ["diff.header",      "DiffText"],

  // Language-specific
  ["json.property",    "@property"],
  ["css.property",     "@property"],
  ["css.selector",     "@type"],
  ["css.value",        "@string"],
];

// Maps semantic token types → @lsp.type.* groups
const VIM_SEMANTIC_MAP = {
  "parameter":                "@lsp.type.parameter",
  "parameter.output":         "@lsp.type.parameter",
  "variable":                 "@lsp.type.variable",
  "variable.readonly":        "@lsp.mod.readonly",
  "variable.static":          "@lsp.mod.static",
  "variable.static.readonly": "@lsp.mod.static",
  "function":                 "@lsp.type.function",
  "function.declaration":     "@lsp.type.function",
  "type":                     "@lsp.type.type",
  "type.declaration":         "@lsp.type.type",
};

function buildNeovimTheme(theme) {
  const { data } = theme;
  const name = basename(theme.file, ".json");
  const label = data.label || data.name;

  /** Convert parsed token value to Lua hl opts string. */
  function hlOpts(value) {
    const parsed = parseTokenValue(value);
    const parts = [`fg = "${parsed.foreground}"`];
    if (parsed.fontStyle) {
      if (parsed.fontStyle.includes("italic")) parts.push("italic = true");
      if (parsed.fontStyle.includes("bold")) parts.push("bold = true");
      if (parsed.fontStyle.includes("strikethrough")) parts.push("strikethrough = true");
      if (parsed.fontStyle.includes("underline")) parts.push("underline = true");
    }
    return `{ ${parts.join(", ")} }`;
  }

  let lua = `-- ${label} — generated by build.mjs, do not edit\n`;
  lua += `vim.cmd("hi clear")\n`;
  lua += `vim.g.colors_name = "${name}"\n`;
  lua += `local h = vim.api.nvim_set_hl\n\n`;

  // UI highlights
  lua += `-- UI\n`;
  lua += `h(0, "Normal", { fg = "${data.ui.foreground}", bg = "${data.ui.background}" })\n`;
  lua += `h(0, "NormalFloat", { fg = "${data.ui.foreground}", bg = "${data.ui.panel}" })\n`;
  lua += `h(0, "FloatBorder", { fg = "${data.ui.lineNumber}", bg = "${data.ui.panel}" })\n`;
  lua += `h(0, "CursorLine", { bg = "${data.ui.lineHighlight}" })\n`;
  lua += `h(0, "CursorLineNr", { fg = "${data.ui.lineNumberActive}" })\n`;
  lua += `h(0, "Visual", { bg = "${data.ui.selection}" })\n`;
  lua += `h(0, "LineNr", { fg = "${data.ui.lineNumber}" })\n`;
  lua += `h(0, "SignColumn", { bg = "${data.ui.background}" })\n`;
  lua += `h(0, "FoldColumn", { fg = "${data.ui.lineNumber}", bg = "${data.ui.background}" })\n`;
  lua += `h(0, "Folded", { fg = "${data.ui.lineNumberActive}", bg = "${data.ui.lineHighlight}" })\n`;
  lua += `h(0, "MatchParen", { bg = "${data.ui.bracketMatchBg}" })\n`;
  lua += `h(0, "Pmenu", { fg = "${data.ui.foreground}", bg = "${data.ui.panel}" })\n`;
  lua += `h(0, "PmenuSel", { bg = "${data.ui.selection}" })\n`;
  lua += `h(0, "PmenuSbar", { bg = "${data.ui.panel}" })\n`;
  lua += `h(0, "PmenuThumb", { bg = "${data.ui.lineNumber}" })\n`;
  lua += `h(0, "StatusLine", { fg = "${data.ui.foreground}", bg = "${data.ui.panel}" })\n`;
  lua += `h(0, "StatusLineNC", { fg = "${data.ui.lineNumber}", bg = "${data.ui.panel}" })\n`;
  lua += `h(0, "TabLine", { fg = "${data.ui.lineNumber}", bg = "${data.ui.tabInactive}" })\n`;
  lua += `h(0, "TabLineSel", { fg = "${data.ui.foreground}", bg = "${data.ui.tabActive}" })\n`;
  lua += `h(0, "TabLineFill", { bg = "${data.ui.panel}" })\n`;
  lua += `h(0, "WinSeparator", { fg = "${data.ui.indentGuide}" })\n`;
  lua += `h(0, "NonText", { fg = "${data.ui.indentGuide}" })\n`;
  lua += `h(0, "SpecialKey", { fg = "${data.ui.indentGuide}" })\n`;
  lua += `h(0, "EndOfBuffer", { fg = "${data.ui.indentGuide}" })\n`;
  lua += `h(0, "Search", { bg = "${data.ui.selection}" })\n`;
  lua += `h(0, "IncSearch", { bg = "${data.ui.bracketMatchBg}" })\n`;

  // Diagnostics — derive from theme colors
  const errorColor = data.tokens.invalid?.split(/\s+/)[0] || "#ff4444";
  const warnColor = data.tokens.number?.split(/\s+/)[0] || "#eebb55";
  const infoColor = data.tokens["keyword.control"]?.split(/\s+/)[0] || "#77bbff";
  const hintColor = data.tokens.comment?.split(/\s+/)[0] || "#888888";
  lua += `\n-- Diagnostics\n`;
  lua += `h(0, "DiagnosticError", { fg = "${errorColor}" })\n`;
  lua += `h(0, "DiagnosticWarn", { fg = "${warnColor}" })\n`;
  lua += `h(0, "DiagnosticInfo", { fg = "${infoColor}" })\n`;
  lua += `h(0, "DiagnosticHint", { fg = "${hintColor}" })\n`;
  lua += `h(0, "DiagnosticUnderlineError", { undercurl = true, sp = "${errorColor}" })\n`;
  lua += `h(0, "DiagnosticUnderlineWarn", { undercurl = true, sp = "${warnColor}" })\n`;
  lua += `h(0, "DiagnosticUnderlineInfo", { undercurl = true, sp = "${infoColor}" })\n`;
  lua += `h(0, "DiagnosticUnderlineHint", { undercurl = true, sp = "${hintColor}" })\n`;

  // Token highlights — syntax + treesitter
  lua += `\n-- Syntax & Treesitter\n`;
  const seen = new Set();
  for (const [role, ...groups] of VIM_TOKEN_MAP) {
    const value = data.tokens[role];
    if (!value) continue;
    const opts = hlOpts(value);
    for (const group of groups) {
      if (seen.has(group)) continue;
      seen.add(group);
      lua += `h(0, "${group}", ${opts})\n`;
    }
  }

  // Semantic / LSP highlights
  if (data.semantic) {
    lua += `\n-- LSP semantic tokens\n`;
    for (const [semRole, group] of Object.entries(VIM_SEMANTIC_MAP)) {
      const value = data.semantic[semRole];
      if (!value || seen.has(group)) continue;
      seen.add(group);
      lua += `h(0, "${group}", ${hlOpts(value)})\n`;
    }
  }

  return lua;
}

// ── ANSI 256 color utilities ─────────────────────────────────────────────

const CUBE_VALUES = [0, 0x5f, 0x87, 0xaf, 0xd7, 0xff];

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function nearestCubeIndex(v) {
  let best = 0;
  let bestDist = Math.abs(v - CUBE_VALUES[0]);
  for (let i = 1; i < 6; i++) {
    const d = Math.abs(v - CUBE_VALUES[i]);
    if (d < bestDist) { best = i; bestDist = d; }
  }
  return best;
}

function nearest256(hex) {
  const [r, g, b] = hexToRgb(hex);

  // Try color cube (16-231)
  const ri = nearestCubeIndex(r), gi = nearestCubeIndex(g), bi = nearestCubeIndex(b);
  const cr = CUBE_VALUES[ri], cg = CUBE_VALUES[gi], cb = CUBE_VALUES[bi];
  const cubeDist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
  const cubeCode = 16 + 36 * ri + 6 * gi + bi;

  // Try grayscale ramp (232-255)
  const gray = Math.round((r + g + b) / 3);
  const gi2 = Math.max(0, Math.min(23, Math.round((gray - 8) / 10)));
  const gv = 8 + gi2 * 10;
  const grayDist = (r - gv) ** 2 + (g - gv) ** 2 + (b - gv) ** 2;
  const grayCode = 232 + gi2;

  if (grayDist < cubeDist) return { code: grayCode, r: gv, g: gv, b: gv, dist: Math.sqrt(grayDist) };
  return { code: cubeCode, r: cr, g: cg, b: cb, dist: Math.sqrt(cubeDist) };
}

function reportColorFidelity(themes) {
  console.log("\n── 256-color fidelity report ──\n");
  for (const theme of themes) {
    const colors = new Map();
    for (const [role, value] of Object.entries(theme.data.tokens)) {
      const hex = value.split(/\s+/)[0];
      if (!colors.has(hex)) colors.set(hex, []);
      colors.get(hex).push(role);
    }
    for (const [role, value] of Object.entries(theme.data.ui)) {
      if (typeof value === "string" && value.startsWith("#")) {
        if (!colors.has(value)) colors.set(value, []);
        colors.get(value).push(`ui.${role}`);
      }
    }

    const drifted = [];
    for (const [hex] of colors) {
      const match = nearest256(hex);
      if (match.dist > 20) {
        drifted.push({ hex, code: match.code, dist: Math.round(match.dist) });
      }
    }

    if (drifted.length) {
      console.log(`${theme.data.name}: ${drifted.length} color(s) with dist > 20 from nearest 256-color:`);
      for (const { hex, code, dist } of drifted.sort((a, b) => b.dist - a.dist)) {
        console.log(`  ${hex} → 256#${code} (dist ${dist})`);
      }
    } else {
      console.log(`${theme.data.name}: all colors within 256-color range ✓`);
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const report256 = args.includes("--report-256");

const scopes = loadJSON(join(ROOT, "scopes.json"));
const themes = discoverThemes();

if (!themes.length) {
  console.error("No theme files found at root.");
  process.exit(1);
}

console.log(`Found ${themes.length} theme(s): ${themes.map((t) => t.data.name).join(", ")}`);

const valid = validate(themes, scopes);

if (report256) {
  reportColorFidelity(themes);
}

if (checkOnly) {
  process.exit(valid ? 0 : 1);
}

// Write generated themes
mkdirSync(THEMES_DIR, { recursive: true });
mkdirSync(COLORS_DIR, { recursive: true });

for (const theme of themes) {
  const outName = basename(theme.file);
  const baseName = basename(theme.file, ".json");

  // VSCode
  const vsTheme = buildVSCodeTheme(theme, scopes);
  writeFileSync(join(THEMES_DIR, outName), JSON.stringify(vsTheme, null, 2) + "\n");
  console.log(`  → themes/${outName}`);

  // Neovim
  const lua = buildNeovimTheme(theme);
  writeFileSync(join(COLORS_DIR, `${baseName}.lua`), lua);
  console.log(`  → colors/${baseName}.lua`);
}

console.log("\nDone.");
