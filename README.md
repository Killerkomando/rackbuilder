# Rack Builder v0.8.0

Visual rack planning tool for creating NetBox-compatible JSON imports. Plan your server rack layouts with drag & drop, collision detection, and bulk device creation — then export directly as JSON, YAML, CSV, or PNG.

## Quick Start

Open `index.html` in any modern browser. No build step, no dependencies, no server required.

```
git clone <repo-url>
cd rackbuilder
open index.html
```

Works offline as a PWA after the first visit.

### Minimalist Version

A single-file version with all CSS and JS inlined is available under `minimalist/index.html`. It has **full feature parity** with the main app — including NetBox autocomplete (Device Types, Roles, Manufacturers, Module Types), the module import, the modern custom autocomplete dropdown, accordion sidebar, and all other features. No external dependencies and no service worker — just open the file directly:

```
open minimalist/index.html
```

This is useful for quick deployment, embedding, or environments where multiple files are impractical.

### Cable Manager

Port-to-port cable management with NetBox integration. Available under `cablemanager/index.html`:

```
open cablemanager/index.html
```

Loads live data from a NetBox instance (uses the same API token as the main app). Lets you visualize existing cables and plan new port-to-port connections across all cable types (Ethernet, Fiber, Power, Console). Planned cables can be exported as JSON (NetBox-compatible) or YAML.

## Features

### Rack Visualization

- **Visual Rack Editor** — Front and rear view with color-coded device blocks
- **Dynamic Rack Sizing** — Racks up to 46U+ fit on screen without scrolling; unit height scales automatically based on viewport
- **Configurable Face Colors** — Set default colors for front and rear devices in Settings; custom per-device colors are preserved
- **Multi-Rack Mode** — Manage multiple racks in a single project with tab-based switching; each rack has independent config (name, units, colors) and scoped devices
- **Light / Dark Mode** — Toggle between themes, preference saved in localStorage
- **DE / EN Language** — Full German and English UI translation

### Device Placement & Validation

- **Drag & Drop** — Reposition devices by dragging, including cross-face (front ↔ rear) with U-snap guidelines and automatic color swap
- **U-Snap Guidelines** — Visual dashed-border overlay shows exactly where a device will land during drag & drop
- **Collision Detection** — Prevents overlapping devices with real-time visual feedback (green = valid, red = collision)
- **Depth Validation** — Full-depth devices are checked for cross-face collisions (front vs rear at the same U position)
- **Depth Blockade Visualization** — Full-depth devices show a persistent hatched blockade overlay on the opposite rack face, making blocked positions immediately visible at a glance — no dragging needed
- **Auto Color Swap** — Dragging a device between front and rear automatically applies the target face's default color (custom colors stay unchanged)

### HE Unit Selection & Bulk Creation

- **HE Unit Selection** — Click on empty rack cells to select/reserve positions; the system auto-fills the position field, sets the correct face, and highlights the selected unit with a hatched pattern
- **Bulk Position Preview** — When entering specific positions for bulk creation (e.g. "10, 20, 24"), all target positions are highlighted in the rack with hatched overlays, making it easy to spot conflicts before placing devices. Clicking cells in bulk mode adds to the position list.
- **Bulk Creation** — Add multiple devices at once with auto-numbering (numeric 1,2,3 or alpha A,B,C) and sequential or specific position placement

### State Management & History

- **Undo / Redo** — Full undo/redo history (up to 50 steps) via Ctrl+Z / Ctrl+Y or header buttons
- **Persistent State** — All rack data saved to localStorage automatically
- **Storage Monitor** — Shows localStorage usage with visual indicator and "Clear Cache" button to free up space
- **Clear Devices / Reset All** — "Clear Devices" removes all devices but keeps rack settings; "Reset All" returns everything to defaults

### Export & Import

- **NetBox Export** — JSON format compatible with `POST /api/dcim/devices/` (no `height` field — NetBox derives it from the device type)
- **YAML & CSV Export** — Alternative export formats for other workflows
- **CSV Import** — Import devices from CSV files; supports comma, semicolon (European/Excel default), and tab-separated formats with headers: `name, device_type, role, position, height, face, status, serial, asset_tag, full_depth, manufacturer, comments`
- **Project Save / Load** — Save and restore full rack projects including device heights, colors, depth settings, rack configuration, and multi-rack state
- **NetBox JSON Import** — Re-import previously exported NetBox device lists; reads `u_height`, `height`, and `full_depth` when present

### NetBox Autocomplete (Optional)

- **NetBox Data Upload** — Upload exported Device Types, Roles, Manufacturers, and Module Types from NetBox (JSON, YAML, or CSV) in Settings to enable autocomplete; supports comma-, semicolon-, and tab-separated files
- **NetBox Live API** — Alternatively connect directly to a running NetBox instance via URL + API token; test the connection and fetch Device Types, Roles, and Manufacturers with paginated API calls (no CORS proxy required when NetBox is on the same network)
- **Encrypted API Token Storage** — The NetBox API token is encrypted with AES-256-GCM before being written to `localStorage`; the encryption key lives only in `sessionStorage` and is never persisted to disk
- **Multi-Document YAML Support** — Supports the NetBox direct-export YAML format where multiple device types are separated by `---` document markers; each entry is parsed as an individual device type
- **Modern Autocomplete Dropdown** — Custom-styled dropdown with fuzzy search, highlighted matches, keyboard navigation (Arrow Up/Down, Enter, Escape), and two-column layout showing name + slug. Dropdown is body-appended and repositions on scroll, so it is never clipped by sidebar overflow.
- **Autocomplete Meta Badges** — Device Type entries show U height and Full Depth badges in the dropdown. Selecting a device type auto-fills the height and depth fields in the form.
- **Per-Field Autocomplete** — Device Type, Role, and Manufacturer fields each get their own autocomplete backed by uploaded or API-fetched NetBox data
- **Module Types** — A fourth category (upload or `dcim/module-types` via API) supplies the module type suggestions for the module import profiles

### NetBox Module Import (CSV)

Generates the NetBox module assignments for devices with several module bays (e.g. twelve) from a CSV file. Open it via **NetBox Import → Module import (CSV)…**.

- **Import profiles** — One profile per device variant, stored in `localStorage` (`rackbuilder_import_profiles`, separate from the undo state, kept when you clear the cache unless you confirm deleting them). A default profile ("NetBox Standard (12-Bay)") is bundled as a starting point; duplicate, edit, import and export profiles as JSON.
- **Rules instead of hard-wired logic** — Mapping rules (priority, conditions on `category`, `port_count`, `socket_color`, `block`, `row`; target module type; `min_bay`/`max_bay`), port splits (explicit module sequence for a total port count), block mappings (count column, prefix pattern, free block sequence like `A-K` or `1-12`) and column mappings (`{prefix}`, `{block}`, `{n}` placeholders).
- **One device per occupied block** — A CSV row can yield several devices; the count column says how many blocks are occupied. `x` in numeric columns counts as empty, `#NAME?` columns are ignored, LAN port names are taken 1:1 from the file.
- **No guessing** — Rows without a matching rule, port counts that cannot be split exactly, or exhausted bay ranges are flagged as errors and block the export. Default split strategies: largest modules first, smallest first, fewest modules.
- **12-bay slot preview** — Per device a colour-coded slot view (red = error), plus a summary and an errors-only filter. Go back, adjust the profile and analyse again without re-uploading.
- **Output** — `module-import.csv` (`device, module_bay, module_type, status`; one row per bay that receives a module) for *Dcim → Modules → Import*, then `interface-rename.csv` (`id, name`) for *Dcim → Interfaces → Import* in update mode. Download single files or as ZIP.
- **Interface IDs** — Either fetched read-only from the NetBox API (URL and token from Settings → NetBox; needs CORS) or from an interface export (CSV with `id`, `device`, `name`) that you upload. Interfaces are matched by device and the expected generated name (`interface_name_template`, default `Gi{module}/0/{n}` with the bay position as `{module}`).
- Rackbuilder never writes to NetBox; both files are imported manually.

### Live Feedback

- **Live Statistics** — Real-time rack utilization percentage broken down by front and rear face
- **Utilization Bar** — Visual bar below the rack showing front/rear fill ratio at a glance
- **Device Search** — Search box in the rack view filters and highlights matching devices; non-matching devices are dimmed
- **Auto-fill Toast** — Brief toast notification confirms when clicking a rack cell auto-fills the position field
- **Live JSON Preview** — Toggle panel showing the NetBox JSON output in real-time as devices are added or moved

### Responsive Layout

- **Sidebar Drawers** — On narrow viewports, sidebars slide in as drawers via hamburger toggle buttons with a backdrop overlay
- **Settings Modal Tabs** — Tabbed settings dialog with a sliding pill indicator for smooth tab switching
- **Custom Keyboard Shortcuts** — Record and reassign keyboard shortcuts from within the Settings dialog; conflicts are flagged inline

### Export

- **PNG Export** — Download the current rack view as a PNG image (respects dark/light theme)

### Offline & PWA

- **Offline PWA** — Service worker caches all assets; installable on mobile and desktop

## Export Formats

### NetBox JSON

Produces an array of device objects compatible with the NetBox API:

```json
[
  {
    "name": "Switch-01",
    "device_type": "catalyst-9300",
    "role": "access-switch",
    "site": "dc1",
    "rack": "Rack-01",
    "position": 1,
    "face": "front",
    "status": "planned"
  }
]
```

Fields like `serial`, `asset_tag`, `full_depth`, `location`, and `comments` are included when set. The `height` field is intentionally omitted — NetBox determines device height from the device type definition.

### Project Format

The "Save Project" function exports a self-contained file that preserves all data including device heights, colors, and depth settings:

```json
{
  "_format": "rackbuilder-project",
  "_version": "0.8.0",
  "rackConfig": {
    "name": "Rack-01",
    "totalUnits": 42,
    "numberingDirection": "bottom-to-top",
    "site": "dc1",
    "location": "hall-a",
    "frontColor": "#3b82f6",
    "rearColor": "#f97316"
  },
  "multiRackEnabled": false,
  "racks": [],
  "devices": [ ... ]
}
```

Use "Load Project" to restore from a project file. NetBox JSON files should be imported via "Import NetBox JSON" instead.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+Z` | Undo last action |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Delete` / `Backspace` | Remove selected device |
| `Escape` | Deselect current device |
| Click on empty rack cell | Select/reserve HE position |

## File Structure

```
index.html          — App entry point (no build step)
css/style.css       — Styles, dark/light theme via CSS custom properties
js/
  app.js            — Bootstrap, theme/lang init, device list, settings, stats, HE selection sync, rack tabs
  state.js          — Pub/sub state store + undo/redo + localStorage persistence + multi-rack management
  rack-model.js     — Data model, collision + depth detection, NetBox export, stats
  rack-view.js      — Rack grid renderer, depth blockades, reserved unit overlays
  device-form.js    — Add/edit form + bulk creation logic
  drag-drop.js      — HTML5 drag & drop with rAF throttle + snap guides
  export.js         — JSON, YAML, CSV export + project save/load + NetBox import
  netbox-autocomplete.js — NetBox data upload, parsing, custom autocomplete dropdown, API helpers
  csv.js            — RFC 4180 CSV reader/writer
  zip.js            — Store-only ZIP writer (CRC-32)
  import-profiles.js — Module import profiles: model, validation, localStorage persistence
  import-engine.js  — Module import logic: blocks, port splits, bay allocation, CSV output
  module-import.js  — Module import wizard UI (profile editor, slot preview, exports)
  i18n.js           — German/English translations
  utils.js          — UUID generation, naming sequences, storage utilities
sw.js               — Service worker (cache-first offline)
manifest.json       — PWA manifest
testing/
  csv-zip.test.mjs  — Node tests for the CSV and ZIP libraries
  module-import.test.mjs — Node tests for profiles, engine, i18n completeness
  module-import-sample.csv — Sample source file for the module import
minimalist/
  index.html        — Single-file version (all CSS + JS inlined, no dependencies)
```

## Tests

The pure logic (CSV, ZIP, profiles, import engine) has dependency-free Node tests:

```
node testing/csv-zip.test.mjs
node testing/module-import.test.mjs
```

## Tech Stack

Zero-dependency vanilla HTML/CSS/JS with ES modules. No framework, no bundler, no Node.js (Node is only used to run the optional tests).

## License

See [LICENSE](LICENSE).
