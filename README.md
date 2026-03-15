# Rack Builder v0.2.0

Visual rack planning tool for creating NetBox-compatible JSON imports. Plan your server rack layouts with drag & drop, collision detection, and bulk device creation — then export directly as JSON, YAML, or CSV.

## Quick Start

Open `index.html` in any modern browser. No build step, no dependencies, no server required.

```
git clone <repo-url>
cd rackbuilder
open index.html
```

Works offline as a PWA after the first visit.

## Features

- **Visual Rack Editor** — Front and rear view with color-coded device blocks
- **Drag & Drop** — Reposition devices by dragging, including cross-face (front ↔ rear)
- **Collision Detection** — Prevents overlapping devices with real-time visual feedback (green = valid, red = collision)
- **Bulk Creation** — Add multiple devices at once with auto-numbering (numeric 1,2,3 or alpha A,B,C) and sequential or specific position placement
- **NetBox Export** — JSON format compatible with `POST /api/dcim/devices/` (no `height` field — NetBox derives it from the device type)
- **YAML & CSV Export** — Alternative export formats for other workflows
- **JSON Import** — Re-import previously exported rack configurations
- **Light / Dark Mode** — Toggle between themes, preference saved in localStorage
- **DE / EN Language** — Full German and English UI translation
- **Offline PWA** — Service worker caches all assets; installable on mobile and desktop
- **Persistent State** — All rack data saved to localStorage automatically

## Export Format

The NetBox JSON export produces an array of device objects:

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

Fields like `serial`, `asset_tag`, `location`, and `comments` are included when set. The `height` field is intentionally omitted — NetBox determines device height from the device type definition.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Delete` / `Backspace` | Remove selected device |
| `Escape` | Deselect current device |

## File Structure

```
index.html          — App entry point (no build step)
css/style.css       — Styles, dark/light theme via CSS custom properties
js/
  app.js            — Bootstrap, theme/lang init, device list, settings
  state.js          — Pub/sub state store + localStorage persistence
  rack-model.js     — Data model, collision detection, NetBox export mapping
  rack-view.js      — Rack grid renderer (front/rear/unit columns)
  device-form.js    — Add/edit form + bulk creation logic
  drag-drop.js      — HTML5 drag & drop with rAF throttle
  export.js         — JSON, YAML, CSV export + JSON import
  i18n.js           — German/English translations
  utils.js          — UUID generation, naming sequences
sw.js               — Service worker (cache-first offline)
manifest.json       — PWA manifest
```

## Tech Stack

Zero-dependency vanilla HTML/CSS/JS with ES modules. No framework, no bundler, no Node.js.

## License

See [LICENSE](LICENSE).
