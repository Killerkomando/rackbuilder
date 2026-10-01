# Rackbuilder: NetBox Modul-Import per CSV — Spezifikation für Claude Code

Sep 28, 2026 · @Rafael

## Kontext & Ziel

Rackbuilder ist das bestehende, backend-lose Rack-Planungs-Tool auf Basis von Vanilla-JS ([github.com/Killerkomando/rackbuilder](https://github.com/Killerkomando/rackbuilder)) — reine ES-Module, kein Framework, kein Server, Zustand in localStorage. Es exportiert Geräte bereits heute als NetBox-kompatibles JSON/YAML/CSV zum manuellen Import in NetBox und ruft die NetBox-API nie selbst auf. Dieses Feature ergänzt Rackbuilder um ein Modul, das für Geräte mit mehreren Modul-Bays (hier: zwölf) aus einer hochgeladenen CSV/XLSX automatisch die passenden NetBox-Modul-Typen je Bay ermittelt und daraus die passenden Export-Dateien erzeugt.

Der Nutzer definiert die Erkennungsregeln vorher selbst im Tool (ein Import-Profil pro Geräte-Variante), statt dass die Zuordnung fest im Code verdrahtet ist. Die Portnamen der LAN-Module stehen bereits in der Quelldatei und werden 1:1 übernommen, statt sie über NetBox-Namensvorlagen zu generieren. Eine Zeile der Quelldatei kann dabei mehrere Geräte ergeben — in deiner Beispieldatei entspricht ein Raum mehreren Bodentänken (Blöcke A–K), von denen laut einer Anzahl-Spalte nur ein Teil tatsächlich belegt ist; jeder belegte Bodentank wird zu einem eigenen NetBox-Gerät. Ergebnis ist, wie beim bestehenden Geräte-Export, eine herunterladbare CSV-Datei zum Import in NetBox — kein direkter API-Schreibzugriff.

## Voraussetzungen in NetBox

Bevor der Import funktioniert, müssen folgende Stammdaten in NetBox einmalig angelegt sein:

- Ein **Device Type** mit den zwölf Modul-Bays für das Ziel-Gerät.
- Pro Geräte-Variante ein eigener **Module Type** mit Component-Templates (Interfaces bzw. Power Outlets), die den Platzhalter `{module}` in der Namensvorlage nutzen — NetBox ersetzt ihn beim Einbau eines Moduls automatisch durch die Bay-Position und benennt die Ports damit selbstständig korrekt.
- Pro Geräte-Variante ist zusätzlich hinterlegt, welche Bay-Bereiche welche Modul-Kategorie erlauben (z. B. Strom-Module nur ab Bay 6) — im Import-Profil als `min_bay`/`max_bay` je Regel.
- Modul-Typen werden vollständig über die Rackbuilder-Oberfläche ausgewählt bzw. benannt, bevor eine Regel sie referenzieren kann — z. B. über die vorhandene NetBox-Daten-Upload-Funktion für Module Types, analog zu Device Types/Roles/Manufacturers.

Vorschlag für die benötigten Modul-Typen (Namen und genaue Ports/Farben bitte bei Bedarf anpassen):

| Modul-Typ (Vorschlag) | Komponente | Anzahl | Naming-Pattern-Beispiel |
| --- | --- | --- | --- |
| LAN-Modul 2-Port | Interface | 2 | `Gi{module}/0/[1-2]` |
| LAN-Modul 3-Port | Interface | 3 | `Gi{module}/0/[1-3]` |
| Steckdosenmodul 2-fach Weiß | Power Outlet | 2 | `PWR{module}-W[1-2]` |
| Steckdosenmodul 2-fach Orange | Power Outlet | 2 | `PWR{module}-O[1-2]` |
| Steckdosenmodul 3-fach Weiß | Power Outlet | 3 | `PWR{module}-W[1-3]` |
| Steckdosenmodul 3-fach Orange | Power Outlet | 3 | `PWR{module}-O[1-3]` |

Sobald ein Modul eines dieser Typen in eine Bay eingebaut wird, erzeugt NetBox die passenden Ports automatisch nach dem Namensschema der Vorlage. Für LAN-Module reicht das nicht aus: Die tatsächlichen Portnamen stehen schon in der Quelldatei und müssen nach dem Modul-Import per zweitem Abgleich auf Interface-Ebene (Namens-Update anhand der Bay-Position) auf die gewünschten Werte gesetzt werden — siehe Technischer Ablauf weiter unten.

## Datenmodell in Rackbuilder

Statt die Erkennungslogik im Code zu verdrahten, legt der Nutzer sie über mehrere neue Entitäten selbst fest:

| Entität | Zweck | Wichtige Felder |
| --- | --- | --- |
| `ImportProfile` | Ein wiederverwendbares Profil pro Geräte-Variante | `id`, `name`, `netbox_device_type_id`, `default_split_strategy` (z. B. „größte Module zuerst“, frei je Profil), `is_default` (markiert ein mitgeliefertes Standardprofil als Ausgangspunkt), `created_at` |
| `MappingRule` | Eine Regel innerhalb eines Profils: Bedingung → Ziel-Modul-Typ, optional mit Slot-Bereich | `id`, `import_profile_id`, `priority`, `conditions` (JSON), `netbox_module_type_id`, `min_bay`, `max_bay` |
| `PortSplitRule` | Legt explizit fest, wie eine Gesamt-Portzahl (LAN oder Strom) auf mehrere Module aufgeteilt wird | `id`, `import_profile_id`, `category` (LAN/Strom), `total_count`, `module_type_sequence` (geordnete Liste von Modul-Typen); ohne passenden Eintrag greift `default_split_strategy` |
| `BlockMapping` | Beschreibt wiederholte Geräte-Blöcke innerhalb einer Zeile (z. B. mehrere Bodentänke pro Raum) | `id`, `import_profile_id`, `count_column`, `prefix_pattern` (z. B. `Bodentank {block}`), `block_sequence` (frei definierbar: Buchstaben, Zahlen, beliebige Länge) |
| `ColumnMapping` | Zuordnung der Datei-Spaltenüberschriften zu internen Feldern, relativ zum Block-Präfix | `id`, `import_profile_id`, `internal_field`, `column_suffix_pattern` |

Beim Import wird pro Zeile die erste passende `MappingRule` eines Profils angewendet (nach `priority` sortiert); trifft keine Regel zu, wird die Zeile als Fehler markiert statt geraten. Für LAN-Module liest `ColumnMapping` zusätzlich die exakten Portnamen direkt aus der Quelldatei (eine Spalte je Port, z. B. `port1_name`, `port2_name`), statt sie zu generieren. Pro Zeile entstehen so 0 bis `block_sequence`-Länge Geräte, abhängig davon, wie viele Blöcke laut `count_column` tatsächlich belegt sind; sowohl `block_sequence` als auch die Anzahl der `(Buchse n)`-Spalten pro Block sind frei konfigurierbar — die Beispieldatei (A–K) zeigt nur ein mögliches Layout, keine feste Grenze.

## Workflow im Tool

**Ablauf-Diagramm (Workflow: 6 Schritte, 1 Entscheidungspunkt mit Rücksprung):**

1. Datei hochladen
2. Regeln anwenden
3. Vorschau prüfen
4. Entscheidung: Alle Zeilen ok? → **nein**: zurück zu "Regeln anpassen" (Schritt 2/3) → **ja**: weiter
5. CSV exportieren
6. Fehler markieren (parallel zu Schritt 4 bei "nein": betroffene Zeilen/Bays werden als Fehler markiert, bevor der Nutzer die Regeln anpasst)

Bleiben nach der Vorschau Zeilen ohne passende Regel oder außerhalb des erlaubten Slot-Bereichs übrig, springt der Nutzer zurück und passt Regeln, Slot-Grenzen oder Spalten-Mapping an. Die Vorschau zeigt dabei je Bodentank eine grafische Slot-Ansicht analog zur bestehenden Rack-Visualisierung (`rack-view.js`) — farbcodiert nach Modul-Typ, Fehler rot markiert. Erst wenn alle Geräte zugeordnet sind, wird die Export-Datei erzeugt.

## Technischer Ablauf des Imports

| Schritt | Aktion | Ergebnis |
| --- | --- | --- |
| 1 | Quelldatei (CSV) im Browser parsen; Werte wie `x` in eigentlich numerischen Spalten wie ein leeres Feld behandeln, die Spalte `#NAME?` ignorieren | Bereinigte Zeilen |
| 2 | Pro Zeile anhand `count_column` und `block_sequence` die belegten Blöcke auflösen | Liste von Geräten (ein Eintrag je belegtem Block) |
| 3 | Je Gerät die Spalten relativ zum Block-Präfix lesen (Steckdosen weiß/orange, Buchse 1..n) über `ColumnMapping` | Interne Felder je Gerät |
| 4 | Regeln des aktiven Import-Profils in `priority`-Reihenfolge prüfen; ein Treffer gilt nur, wenn die Ziel-Bay auch im erlaubten `min_bay`/`max_bay`-Bereich liegt; reicht eine Portzahl über mehrere Module, entscheidet `PortSplitRule` bzw. `default_split_strategy` | Modul-Typ(en) pro Bay, oder Fehler |
| 5 | Vorschau mit grafischer Slot-Ansicht je Gerät zeigen; Zeilen/Bays ohne gültigen Treffer als Fehler markieren | Nutzer-Bestätigung |
| 6 | Modul-Import-CSV erzeugen: eine Zeile je Bay mit Device-Name, `module_bay`, `module_type` | Datei `module-import.csv` |
| 7 | Nutzer importiert `module-import.csv` in NetBox. Für die Interface-IDs danach zwei Möglichkeiten: Rackbuilder fragt sie optional direkt per GET von der in den Einstellungen hinterlegten NetBox-Instanz ab, oder der Nutzer exportiert die entstandene Interface-Liste manuell aus NetBox und lädt sie als Datei in Rackbuilder hoch | Interface-IDs bekannt (per API-Abfrage oder Datei-Upload) |
| 8 | Interface-Update-CSV erzeugen: `id` (aus dem Re-Upload) + gewünschter `name` aus der Quelldatei | Datei `interface-rename.csv` |
| 9 | Beide Dateien einzeln oder als ZIP-Bundle zum Download anbieten | Download im Browser |
| 10 | Nutzer importiert die CSVs manuell über die NetBox-Bulk-Import-Ansichten (erst Module, danach Interfaces im Update-Modus) | Fertiges Gerät in NetBox |

## NetBox-Export-Dateiformate

Für das Anlegen von Geräten und Modulen gibt es weiterhin keinen direkten Schreibzugriff aus Rackbuilder heraus — die Ergebnisse kommen als CSV-Dateien zum manuellen NetBox-Import. Für den Zwischenschritt der ID-basierten Portumbenennung ist optional ein direkter lesender API-Aufruf möglich: Trägt der Nutzer NetBox-Basis-URL und API-Token in den Einstellungen ein, fragt Rackbuilder die entstandenen Interface-IDs per GET-Request selbst ab; ohne diese Angabe bleibt der Datei-Export/Re-Upload als Fallback. Modul-Typen können dabei wie Device Types/Roles/Manufacturers über die vorhandene NetBox-Daten-Upload-Funktion (`netbox-autocomplete.js`) als Dropdown-Vorschläge für die Import-Profil-Regeln bereitgestellt werden.

| Datei | NetBox-Bulk-Import-Ansicht | Wichtige Spalten |
| --- | --- | --- |
| `module-import.csv` | Dcim → Modules → Import | `device`, `module_bay`, `module_type`, `status` |
| `interface-rename.csv` | Dcim → Interfaces → Import (Update-Modus, Matching auf `id`) | `id`, `name` (neuer Wert) |

## Offene Fragen & Annahmen

- Bestätigt: Block-Bezeichner (`block_sequence`) und Spaltenanzahl pro Block sind frei konfigurierbar (Buchstaben oder Zahlen, beliebige Länge) — die Beispieldatei zeigt nur ein mögliches Layout, keine feste Grenze.
- Bestätigt: Wie eine Gesamt-Portzahl auf einzelne Module aufgeteilt wird, ist über `PortSplitRule`/`default_split_strategy` konfigurierbar, kein fest verdrahteter Algorithmus.
- Bestätigt: Spalte `#NAME?` wird ignoriert, Wert `x` in numerischen Feldern wird wie leer behandelt.
- Bestätigt: Modul-Typen werden vollständig vorab über die Oberfläche ausgewählt/benannt, bevor eine Regel sie referenzieren kann.
- Bestätigt: `module-import.csv` und `interface-rename.csv` sind einzeln UND als Bundle herunterladbar.
- Bestätigt: Der Zwischenschritt zur ID-basierten Portumbenennung unterstützt beide Wege — optionale direkte API-Abfrage (NetBox-URL + Token in den Einstellungen) und manueller Datei-Export/Re-Upload als Fallback.
- Bestätigt: `default_split_strategy` ist frei je Import-Profil einstellbar; zusätzlich liefert Rackbuilder ein auswählbares Standardprofil (`is_default`) als Ausgangspunkt.
