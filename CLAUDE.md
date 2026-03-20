# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

No build step required. Open `index.html` directly in a browser or serve it with any static file server:

```bash
# Using Laravel Herd or any HTTP server
# Or just open index.html directly in a browser
```

The `minimalist/index.html` is a single self-contained file (all CSS and JS inlined) that must be kept in full feature parity with the main app.

## Architecture

**Zero-dependency vanilla HTML/CSS/JS** — no npm, no bundler, no framework. All JS files are ES modules loaded via `<script type="module">` in `index.html`.

### Module Responsibilities

- **`js/state.js`** — Central pub/sub store. All state lives here. Provides `subscribe(event, fn)`, `publish(event, data)`, `getState()`, `setState()`. Handles localStorage persistence (`rackbuilder_state` key) and undo/redo history (50 steps, deep cloned).
- **`js/app.js`** — App bootstrap. Initializes modules, wires up settings modal, theme/lang toggles, device list panel, stats display.
- **`js/rack-model.js`** — Pure data logic: `Device` and `RackConfig` classes, collision detection (range overlap), depth validation (full-depth devices block opposite face), next-free-slot finder, NetBox export shape.
- **`js/rack-view.js`** — Renders the rack grid DOM. Handles dynamic unit-height scaling, depth blockade overlays (hatched CSS), reserved unit highlighting.
- **`js/device-form.js`** — Add/edit form logic. Bulk creation with numeric/alpha auto-numbering. Clicking an empty rack cell auto-fills the position field.
- **`js/drag-drop.js`** — HTML5 drag & drop with `requestAnimationFrame` throttle. Cross-face drag swaps colors. Snap guidelines rendered as DOM overlay. Collision feedback (green/red).
- **`js/export.js`** — NetBox JSON, YAML, CSV export. Project save/load (full state JSON). NetBox JSON re-import.
- **`js/netbox-autocomplete.js`** — Optional NetBox data upload (Device Types, Roles, Manufacturers). Accepts JSON, YAML, CSV. Custom two-column dropdown with fuzzy search and keyboard navigation.
- **`js/i18n.js`** — EN/DE translations (~80 keys). Applied to DOM via `data-i18n` attributes. Call `applyTranslations()` after dynamic DOM changes.
- **`js/utils.js`** — UUID generation, naming sequences, localStorage helpers.

### Layout

3-column flexbox layout:
- **Left sidebar** (320px): Device form + bulk creation
- **Center**: Rack visualization with face tabs (front/rear) and rack tabs (multi-rack mode)
- **Right sidebar** (320px): Collapsible accordions — Export, Save/Load, Import, JSON Preview, Device List, Storage Monitor

### State Shape

State is a single object persisted to localStorage. Key fields:
- `racks[]` — array of rack configs (name, totalUnits, numberingDirection, colors, site, location)
- `devices[]` — scoped per rack by `rackId`
- `activeRackId` — currently viewed rack
- `multiRackMode` — boolean toggle
- `reservedUnits` — UI-only selection state (not persisted)
- Undo stack maintained separately in `state.js`, not in persisted state

### Theming

Dark/light mode via `data-theme` attribute on `<html>`. CSS custom properties defined for both in `css/style.css`. Default is dark (`#0f172a` navy background). Toggle updates `localStorage.theme`.

### Service Worker

`sw.js` uses cache-first strategy (`CACHE_NAME: 'rackbuilder-v4'`). When adding new assets, update the asset list in `sw.js` and bump the cache version to force cache invalidation.

### Minimalist Version

`minimalist/index.html` is a standalone single-file version. After modifying the main app's JS or CSS files, the equivalent changes must also be applied inline in `minimalist/index.html`. The minimalist version has all CSS in a `<style>` block and all JS in `<script>` blocks at the bottom.
