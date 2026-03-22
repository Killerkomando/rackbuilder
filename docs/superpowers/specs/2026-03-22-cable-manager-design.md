# Cable Manager — Design Spec
**Datum:** 2026-03-22
**Status:** Approved
**Version:** 1.0

---

## Ziel

Eigenständiges Sub-Tool (`cablemanager/index.html`) für Port-zu-Port Kabelverwaltung. Lädt den Ist-Stand aller Kabel aus NetBox und erlaubt das lokale Planen neuer Verbindungen. Geplante Kabel werden als JSON/YAML exportiert — NetBox-Push ist für später vorgesehen, aber nicht Teil dieses Releases.

---

## Scope

**In Scope:**
- Laden aller Racks, Geräte und Kabel aus NetBox per API (read-only)
- Port-zu-Port Kabelplanung für alle NetBox-Kabeltypen (Ethernet, Power, Console, Fiber)
- Import von Rack Builder Projektdateien (lokal geplante Geräte einblenden)
- Export geplanter Kabel als JSON und YAML
- Navigation zwischen Standorten, Räumen und Racks

**Out of Scope (später optional):**
- Direktes Pushen von Kabeln nach NetBox (`POST /api/dcim/cables/`)
- Echtzeit-Kollaboration
- Kabel-Routing-Visualisierung (Linien zwischen Geräten)
- IP- oder VLAN-Zuweisung

---

## Architektur

Vanilla HTML/CSS/JS, keine Abhängigkeiten — konsistent mit dem Hauptprojekt. Eigene Datei `cablemanager/index.html` mit inlinetem CSS und JS (wie `minimalist/index.html`). Teilt keine Module mit dem Rack Builder, kommuniziert aber über:
- **Gemeinsamer NetBox-Token:** liest `sessionStorage` Key des Rack Builders (gleicher Origin), kein erneutes Eingeben nötig falls Rack Builder bereits verbunden
- **Rack Builder Import:** File-Picker für `.json` Projektdateien

---

## Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ 🔌 Cable Manager │ [Standort ▾] › [Raum ▾] › [Rack ▾]  [A-01][A-02][A-03]  [Alle|Netz|Power|Console]  [Projekt laden]  [NetBox ✓] │
├────────────────────────────────┬─────────────────────────────────┤
│                                │                                  │
│         Rack-Elevation         │         Port-Panel               │
│            (52%)               │           (48%)                  │
│                                │  ┌──────────┬───┬──────────┐    │
│  U1  [Switch-Core-01]  🔌3     │  │  ◀ Front │ ↔ │  Rear ▶  │    │
│  U2  (leer)                    │  │          │   │          │    │
│  U3  [Server-ESX-01]  🔌2 ←   │  │  Port 1  │ ↔ │  Port 1  │    │
│  U4  [Server-ESX-02]  🔌2      │  │  Port 2  │ ↔ │  Port 2  │    │
│  U5  [PDU-Front-01]   ⚡6      │  │  + Plan  │   │          │    │
│  ...                           │  └──────────┴───┴──────────┘    │
├────────────────────────────────┴─────────────────────────────────┤
│ Rack A-01 · 42U · 14 Geräte · 47 Kabel  ● 44 NetBox  ● 3 geplant │
└──────────────────────────────────────────────────────────────────┘
```

---

## Komponenten

### 1. Toolbar

| Element | Beschreibung |
|---|---|
| Breadcrumb-Dropdowns | Standort → Raum → Rack; kaskadierend (Raum-Liste filtert nach gewähltem Standort) |
| Quick-Switch-Tabs | Alle Racks des aktuellen Raums als Tabs — ein Klick wechselt ohne Dropdown |
| Kabeltyp-Filter | Toggle-Buttons: Alle / Netzwerk / Power / Console. Filtert Port-Panel und Rack-Badges |
| Projekt laden | File-Picker für Rack Builder `.json` Projektdateien |
| NetBox-Badge | Grün = verbunden; Rot = Fehler mit Tooltip; Klick = Reload-Dialog |

### 2. Rack-Elevation

- Geräte aus NetBox als farbige Blöcke, U-Position und Name sichtbar
- Kabel-Badge (`🔌 N`) zeigt Anzahl Kabelverbindungen pro Gerät — nach Kabeltyp-Filter aktualisiert
- Lokal geplante Geräte (aus Rack Builder Import) mit gestrichelter Border dargestellt
- Klick auf Gerät → öffnet dessen Port-Panel rechts
- Ausgewähltes Gerät wird mit gelbem Rahmen hervorgehoben

### 3. Port-Panel — Front/Rear Split

Dreispaltig: **Front-Ports | Pass-Through-Indicator | Rear-Ports**

**Port-Karte (pro Port):**
- Port-Name + Typ (RJ45, SFP, C13, …)
- Verbindungsziel: Gerätename + Port-Name (klickbar → navigiert zu Zielgerät)
- Kabeltyp-Badge (Ethernet / Power / Console / Fiber)
- Farbkodierung:
  - Grün: verbunden (aus NetBox)
  - Gelb: geplant (lokal)
  - Grau/ausgegraut: frei

**Pass-Through-Spalte** (nur relevant für Patch-Panels):
- `↔` Symbole zeigen die 1:1 Zuordnung Front Port N → Rear Port N
- Bei normalen Geräten (Server, Switches): Rear-Spalte zeigt Hinweis "Kein Rear-Port"

**Freie Ports:**
- Zeigen `+ Kabel planen` Button

### 4. Kabel-Planen-Flow

1. Klick auf `+ Kabel planen` bei freiem Port
2. Inline-Suchfeld öffnet sich im Port-Panel (kein Modal)
3. Freitextsuche: Gerätename oder Port-Name (fuzzy, wie bestehende Autocomplete im Rack Builder)
4. Suchergebnis zeigt: Gerätename · Rack + U-Position · Port-Name · Belegungsstatus
5. Kabeltyp wählen (Dropdown: Ethernet / Power / Console / Fiber / DAC / AOC)
6. Bestätigen → Kabel erscheint gelb auf beiden Seiten (Quelle + Ziel)
7. Geplante Kabel sind editierbar und löschbar

### 5. NetBox Datenfluss

**Genutzte Endpoints (alle `GET`, paginiert):**
- `GET /api/dcim/sites/` — Standorte
- `GET /api/dcim/locations/` — Räume
- `GET /api/dcim/racks/` — Racks
- `GET /api/dcim/devices/` — Geräte (gefiltert nach `rack_id`)
- `GET /api/dcim/cables/` — Kabel
- `GET /api/dcim/interfaces/` — Netzwerk-Ports
- `GET /api/dcim/front-ports/` — Patch-Panel Front
- `GET /api/dcim/rear-ports/` — Patch-Panel Rear
- `GET /api/dcim/power-ports/` — Power
- `GET /api/dcim/console-ports/` — Console

**Token-Sharing:**
Versucht `sessionStorage.getItem('netbox_key')` (gleicher Origin wie Rack Builder). Falls nicht vorhanden: eigenes Eingabefeld mit Verschlüsselung (gleiche AES-256-GCM Methode wie Rack Builder).

**Caching:**
Alle NetBox-Daten in `sessionStorage` gecacht. Manueller Reload via NetBox-Badge. Kein automatisches Polling.

### 6. Rack Builder Import

- `Projekt laden` öffnet File-Picker (`.json`)
- Liest `_format: "rackbuilder-project"` Dateien
- Lokal geplante Geräte werden über NetBox-Geräte gelegt (gleiche Rack-Ansicht, andere Darstellung)
- Bei Namensübereinstimmung mit NetBox-Gerät: Zusammenführung (NetBox-Ports + lokale Position)
- Bei reinen Planungsgeräten (nicht in NetBox): grau dargestellt, keine NetBox-Ports

### 7. Export

- **JSON:** Array von geplanten Kabel-Objekten im NetBox-`POST /api/dcim/cables/`-Format (vorbereitet für späteren Push)
- **YAML:** Gleiche Struktur, YAML-serialisiert
- Export nur für geplante (lokale) Kabel — NetBox-Kabel nicht re-exportiert

---

## Datenmodell (lokal)

```js
// Geplantes Kabel
{
  id: "uuid",
  status: "planned",           // immer "planned" für lokale Kabel
  type: "cat6",                // ethernet | power | console | fiber | dac | aoc
  a_terminations: [{
    object_type: "dcim.interface",  // oder front-port, rear-port, power-port, console-port
    object_id: 123,                 // NetBox ID oder null für lokale Geräte
    // Fallback-Felder für lokale Geräte:
    device_name: "Server-01",
    port_name: "eth0"
  }],
  b_terminations: [{ ... }],
  label: "",
  color: ""
}
```

---

## Dateistruktur

```
cablemanager/
  index.html    — Standalone Single-File (CSS + JS inline, wie minimalist/)
```

---

## Technische Entscheidungen

| Entscheidung | Begründung |
|---|---|
| Eigenständige Datei statt Integration | Komplexität der Kabeldaten würde den Rack Builder überladen |
| Lose Kopplung via Projektdatei-Import | Maximale Flexibilität, keine geteilte State-Architektur nötig |
| sessionStorage Token-Sharing | Gleicher Origin, kein erneutes Eingeben des Tokens nötig |
| Kein NetBox-Push in v1 | Erst Visualisierung validieren, dann Schreibzugriff |
| Single-File analog zu minimalist/ | Gleiche Deployment-Story: einfach öffnen, keine Build-Pipeline |

---

## Nicht-funktionale Anforderungen

- Funktioniert offline nach erstem Laden (Service Worker optional, nicht zwingend)
- Responsiv: auf schmalen Viewports stapeln sich Rack und Port-Panel vertikal
- Gleiche Dark/Light-Theme Logik wie Rack Builder (`data-theme` auf `<html>`)
- Gleiches DE/EN i18n-Muster wie Rack Builder
