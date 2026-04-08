# Inkglow

Color themes for VS Code and terminal tools. 9 themes across dark/light variants with curated retro palettes.

## Themes

| Theme | Type | Palette |
|-------|------|---------|
| Inkglow | dark | Gel-pen neons on black |
| Inkglow Quill | light | Warm earthtone inks |
| Inkglow Storm | light | Blue/orange contrast |
| Inkglow Charm | dark | Sweetie-16 retro palette |
| Inkglow Frost | light | Sweetie-16 retro palette |
| Inkglow Blaze | dark | PICO-8 game palette |
| Inkglow Hearth | light | PICO-8 game palette |
| Inkglow Dusk | dark | NA16 retro palette |
| Inkglow Gilt | light | NA16 retro palette |

## Preview

### Dark

<img src="screenshots/inkglow-blaze.svg" width="49%"> <img src="screenshots/inkglow-charm.svg" width="49%"> <img src="screenshots/inkglow-dusk.svg" width="49%"> <img src="screenshots/inkglow.svg" width="49%"> 

### Light

<img src="screenshots/inkglow-frost.svg" width="49%"> <img src="screenshots/inkglow-gilt.svg" width="49%"> <img src="screenshots/inkglow-hearth.svg" width="49%"> <img src="screenshots/inkglow-quill.svg" width="49%"> <img src="screenshots/inkglow-storm.svg" width="49%"> 

## Declarative theme format

Each theme file at the root is a compact JSON mapping of token roles to `"#color style"` values:

```json
{
  "tokens": {
    "comment":          "#8877aa italic",
    "keyword":          "#ff9944",
    "keyword.control":  "#77bbff",
    "string":           "#55cc99",
    "function":         "#a6e22e",
    "variable":         "#99ccff"
  }
}
```

The role names map to TextMate scopes via `scopes.json`. This makes themes easy to compare side-by-side.

## Development

Open this repo in VS Code, then:

- **F5** — launches an Extension Development Host with the themes loaded (runs `build` automatically)
- **Cmd+Shift+B** — run the default build task (`node build.mjs`)

Additional tasks available via **Terminal > Run Task**:

| Task | Description |
|------|-------------|
| `build` | Generate VSCode theme JSON into `themes/` |
| `check` | Validate scope coverage without writing files |
| `report-256` | Show 256-color fidelity for each theme |
| `preview` | TUI preview in the integrated terminal |

### CLI

```sh
node build.mjs              # Generate VSCode themes into themes/
node build.mjs --check      # Validate scope coverage without writing
node build.mjs --report-256 # Show 256-color fidelity for each theme

node preview.mjs            # Preview all themes in terminal (256-color)
node preview.mjs inkglow.json  # Preview a specific theme
node preview.mjs --compact  # Side-by-side view (auto-fits terminal width)
node preview.mjs --dark     # Only dark themes
node preview.mjs --light    # Only light themes
node preview.mjs --palette  # Show color palette with 256-color mappings
```

## Using in CLI tools

```js
import { getTheme, colorize, toAnsi256, getAnsi256Map } from "@creationix/inkglow";

const dark = getTheme("Inkglow");
process.stdout.write(colorize(dark, "keyword", "fn "));
process.stdout.write(colorize(dark, "function", "main"));
```

## Scope registry

`scopes.json` lists every TextMate scope and semantic token type that themes target. Use it to:
- Cross-reference when building language grammars
- Validate that themes cover all scopes consistently
- Understand which roles are available for coloring
