#!/usr/bin/env node
// Build script — reads declarative theme files + scopes.json, generates
// VSCode color-theme JSON files into themes/, and validates scope coverage.
//
// Usage:
//   node build.mjs            # build all themes
//   node build.mjs --check    # validate only, don't write files

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = import.meta.dirname;
const THEMES_DIR = join(ROOT, "themes");

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

for (const theme of themes) {
  const outName = basename(theme.file);
  const outPath = join(THEMES_DIR, outName);
  const vsTheme = buildVSCodeTheme(theme, scopes);
  writeFileSync(outPath, JSON.stringify(vsTheme, null, 2) + "\n");
  console.log(`  → themes/${outName}`);
}

console.log("\nDone.");
