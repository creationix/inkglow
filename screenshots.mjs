#!/usr/bin/env node
// Generates SVG preview screenshots from declarative theme files.
// Outputs to screenshots/ and optionally updates README.md.
//
// Usage:
//   node screenshots.mjs            # generate SVGs
//   node screenshots.mjs --readme   # also update README.md

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = import.meta.dirname;
const SCREENSHOTS_DIR = join(ROOT, "screenshots");

// ── XML escaping ────────────────────────────────────────────────────────

function esc(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── theme loading ───────────────────────────────────────────────────────

function discoverThemes() {
  return readdirSync(ROOT)
    .filter((f) => f.startsWith("inkglow") && f.endsWith(".json"))
    .sort((a, b) => a.split("-").length - b.split("-").length || a.localeCompare(b))
    .map((f) => {
      const data = JSON.parse(readFileSync(join(ROOT, f), "utf-8"));
      if (data.tokens && data.ui && data.type) return { file: f, data };
      return null;
    })
    .filter(Boolean);
}

function parseValue(val) {
  const parts = val.split(/\s+/);
  return { color: parts[0], fontStyle: parts.slice(1).join(" ") || undefined };
}

// ── sample code ─────────────────────────────────────────────────────────

const SAMPLE = [
  [["keyword", "fn "], ["function", "fibonacci"], ["bracket", "("], ["parameter", "n"], ["operator", ": "], ["type", "u32"], ["bracket", ")"], ["operator", " -> "], ["type", "u32"], ["bracket", " {"]],
  [["keyword.control", "  if "], ["parameter", "n"], ["operator", " <= "], ["number", "1"], ["keyword.control", " return "], ["parameter", "n"]],
  [["keyword", "  let "], ["variable", "result"], ["operator", " = "], ["function", "fibonacci"], ["bracket", "("], ["parameter", "n"], ["operator", " - "], ["number", "1"], ["bracket", ")"]],
  [["keyword.control", "  return "], ["variable", "result"]],
  [["bracket", "}"]],
  [],
  [["keyword", "struct "], ["type.user", "Config"], ["bracket", " {"]],
  [["keyword", "  "], ["property", "name"], ["operator", ": "], ["type", "String"], ["operator", " = "], ["string", "\"hello world\""]],
  [["keyword", "  "], ["property", "count"], ["operator", ": "], ["type", "u32"], ["operator", " = "], ["number", "42"]],
  [["keyword", "  "], ["property", "enabled"], ["operator", ": "], ["type", "bool"], ["operator", " = "], ["boolean", "true"]],
  [["keyword", "  "], ["property", "path"], ["operator", ": "], ["type", "String"], ["operator", " = "], ["string", "\"line 1"], ["escape", "\\n"], ["string", "line 2\""]],
  [["bracket", "}"]],
  [],
  [["comment", "// Globals and output params"]],
  [["keyword", "let "], ["variable.global", "GLOBAL"], ["operator", " = "], ["number", "0"]],
  [["keyword", "fn "], ["function", "swap"], ["bracket", "("], ["parameter.output", "a"], ["operator", ": "], ["pointer", "*"], ["type", "u32"], ["operator", ", "], ["parameter.output", "b"], ["operator", ": "], ["pointer", "*"], ["type", "u32"], ["bracket", ")"], ["bracket", " {"]],
  [["keyword", "  let "], ["variable", "tmp"], ["operator", " = "], ["pointer", "*"], ["parameter.output", "a"]],
  [["keyword.control", "  "], ["pointer", "*"], ["parameter.output", "a"], ["operator", " = "], ["pointer", "*"], ["parameter.output", "b"]],
  [["keyword.control", "  "], ["pointer", "*"], ["parameter.output", "b"], ["operator", " = "], ["variable", "tmp"]],
  [["bracket", "}"]],
];

// ── SVG generation ──────────────────────────────────────────────────────

const FONT_SIZE = 14;
const LINE_HEIGHT = 20;
const PAD_X = 16;
const PAD_Y = 12;
const LINE_NUM_WIDTH = 30;
const TITLE_HEIGHT = 34;

function generateSVG(theme) {
  const { data } = theme;
  const bg = data.ui.background;
  const fg = data.ui.foreground;
  const lineNumColor = data.ui.lineNumber;
  const lineHighlight = data.ui.lineHighlight;

  const contentHeight = SAMPLE.length * LINE_HEIGHT;
  const width = 380;
  const height = TITLE_HEIGHT + PAD_Y * 2 + contentHeight + PAD_Y;

  // Slightly lighter/darker panel color for title bar
  const titleBg = data.ui.panel;

  let svg = "";
  svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n`;
  svg += `<defs><style>@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&amp;display=swap'); text { font-family: 'Fira Code', monospace; font-size: ${FONT_SIZE}px; font-variant-ligatures: contextual; }</style></defs>\n`;

  // Background
  svg += `<rect width="${width}" height="${height}" fill="${bg}" rx="6"/>\n`;

  // Title bar
  svg += `<rect width="${width}" height="${TITLE_HEIGHT}" fill="${titleBg}" rx="6"/>\n`;
  svg += `<rect y="${TITLE_HEIGHT - 6}" width="${width}" height="6" fill="${titleBg}"/>\n`;
  const titleColor = data.type === "dark" ? "#cccccc" : "#444444";
  svg += `<text x="${width / 2}" y="${TITLE_HEIGHT / 2 + 5}" text-anchor="middle" fill="${titleColor}" font-weight="bold" font-size="14">${esc(data.label || data.name)}</text>\n`;

  // Window dots
  svg += `<circle cx="16" cy="${TITLE_HEIGHT / 2}" r="5" fill="#ff5f57" opacity="0.8"/>\n`;
  svg += `<circle cx="32" cy="${TITLE_HEIGHT / 2}" r="5" fill="#febc2e" opacity="0.8"/>\n`;
  svg += `<circle cx="48" cy="${TITLE_HEIGHT / 2}" r="5" fill="#28c840" opacity="0.8"/>\n`;

  // Code lines
  const baseY = TITLE_HEIGHT + PAD_Y;

  for (let i = 0; i < SAMPLE.length; i++) {
    const tokens = SAMPLE[i];
    const y = baseY + i * LINE_HEIGHT + FONT_SIZE;
    const lineNum = String(i + 1).padStart(2);

    // Line number
    svg += `<text x="${PAD_X}" y="${y}" fill="${lineNumColor}">${lineNum}</text>\n`;

    if (!tokens || !tokens.length) continue;

    // Build tspans — only set x on the first tspan, let the rest flow naturally
    const x0 = PAD_X + LINE_NUM_WIDTH;
    svg += `<text y="${y}" xml:space="preserve">`;

    let first = true;
    for (const [role, text] of tokens) {
      const val = data.tokens[role];
      let fill = fg;
      let style = "";

      if (val) {
        const parsed = parseValue(val);
        fill = parsed.color;
        if (parsed.fontStyle) {
          if (parsed.fontStyle.includes("italic")) style += " font-style='italic'";
          if (parsed.fontStyle.includes("bold")) style += " font-weight='bold'";
        }
      }

      const xAttr = first ? ` x="${x0}"` : "";
      first = false;
      svg += `<tspan${xAttr} fill="${fill}"${style}>${esc(text)}</tspan>`;
    }

    svg += `</text>\n`;
  }

  svg += `</svg>\n`;
  return svg;
}

// ── README update ───────────────────────────────────────────────────────

function updateReadme(themes) {
  const readmePath = join(ROOT, "README.md");
  let readme = readFileSync(readmePath, "utf-8");

  const darks = themes.filter((t) => t.data.type === "dark");
  const lights = themes.filter((t) => t.data.type === "light");

  let preview = "## Preview\n\n";
  preview += "### Dark\n\n";
  for (const t of darks) {
    const name = basename(t.file, ".json");
    preview += `<img src="screenshots/${name}.svg" width="49%"> `;
  }
  preview += "\n\n### Light\n\n";
  for (const t of lights) {
    const name = basename(t.file, ".json");
    preview += `<img src="screenshots/${name}.svg" width="49%"> `;
  }
  preview += "\n";

  // Replace existing preview section or insert after first heading
  const previewRegex = /## Preview\n[\s\S]*?(?=\n## [^P]|\n## $|$)/;
  if (previewRegex.test(readme)) {
    readme = readme.replace(previewRegex, preview);
  } else {
    // Insert after the theme table
    const insertPoint = readme.indexOf("\n## Project structure");
    if (insertPoint !== -1) {
      readme = readme.slice(0, insertPoint) + "\n" + preview + readme.slice(insertPoint);
    } else {
      readme += "\n" + preview;
    }
  }

  writeFileSync(readmePath, readme);
  console.log("Updated README.md with preview section.");
}

// ── main ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const doReadme = args.includes("--readme");

const themes = discoverThemes();
if (!themes.length) {
  console.error("No themes found.");
  process.exit(1);
}

mkdirSync(SCREENSHOTS_DIR, { recursive: true });

for (const theme of themes) {
  const name = basename(theme.file, ".json");
  const svg = generateSVG(theme);
  const outPath = join(SCREENSHOTS_DIR, `${name}.svg`);
  writeFileSync(outPath, svg);
  console.log(`  → screenshots/${name}.svg`);
}

if (doReadme) {
  updateReadme(themes);
}

console.log("\nDone.");
