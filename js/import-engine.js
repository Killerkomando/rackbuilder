// NetBox module import engine: CSV table + profile → devices with module-bay assignments.
// Pure logic (no DOM, no storage) so it can be tested in Node.

import { moduleSizeFor, fillPattern } from './import-profiles.js';

export const MODULE_IMPORT_HEADERS = ['device', 'module_bay', 'module_type', 'status'];
export const INTERFACE_RENAME_HEADERS = ['id', 'name'];

const miNorm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const MAX_LAN_PORTS = 99;

// ─── Table cleaning & value parsing ──────────────────────────────────────────

/**
 * Drop `#NAME?` columns (spreadsheet formula errors) from a parsed CSV table.
 * @param {{headers: string[], rows: Object[]}} table
 */
export function cleanTable(table) {
  const dropped = table.headers.filter(h => h.trim().startsWith('#NAME?'));
  const headers = table.headers.filter(h => !dropped.includes(h));
  const rows = table.rows.map(r => {
    const o = {};
    for (const h of headers) o[h] = r[h] ?? '';
    return o;
  });
  return { headers, rows, dropped };
}

/**
 * Parse a numeric cell. Empty, "x" and "-" count as empty (null).
 * @returns {{value: number|null, invalid: boolean}}
 */
export function parseNumeric(raw) {
  const s = String(raw ?? '').trim();
  if (s === '' || /^x$/i.test(s) || s === '-') return { value: null, invalid: false };
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? { value: n, invalid: false } : { value: null, invalid: true };
}

// ─── Rule conditions ─────────────────────────────────────────────────────────

function conditionMatches(c, ctx) {
  const actual = ctx[c.field];
  const isEmpty = actual === undefined || actual === null || String(actual).trim() === '';
  switch (c.op) {
    case 'empty': return isEmpty;
    case 'notempty': return !isEmpty;
    case 'eq': return miNorm(actual) === miNorm(c.value);
    case 'neq': return miNorm(actual) !== miNorm(c.value);
    case 'in': return Array.isArray(c.value) && c.value.some(v => miNorm(v) === miNorm(actual));
    case 'gt': return Number(actual) > Number(c.value);
    case 'gte': return Number(actual) >= Number(c.value);
    case 'lt': return Number(actual) < Number(c.value);
    case 'lte': return Number(actual) <= Number(c.value);
    default: return false;
  }
}

const rulesInOrder = profile =>
  (profile.rules || [])
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (Number(a.r.priority) - Number(b.r.priority)) || (a.i - b.i))
    .map(x => x.r);

// ─── Splitting a port count across modules ───────────────────────────────────

/** Module sizes usable for a category (and colour), derived from "port_count eq N" conditions. */
function availableSizes(profile, category, color) {
  const sizes = new Set();
  for (const r of profile.rules || []) {
    const conds = r.conditions || [];
    const cat = conds.find(c => c.field === 'category' && c.op === 'eq');
    if (cat && miNorm(cat.value) !== miNorm(category)) continue;
    const col = conds.find(c => c.field === 'socket_color' && c.op === 'eq');
    if (col && color && miNorm(col.value) !== miNorm(color)) continue;
    const pc = conds.find(c => c.field === 'port_count' && c.op === 'eq');
    if (pc && Number(pc.value) > 0) sizes.add(Number(pc.value));
  }
  return [...sizes];
}

/**
 * Find a sequence of module sizes summing exactly to `total`, preferring the order
 * given by `strategy`. Returns null when impossible (never pads or guesses).
 */
export function composeSizes(total, sizes, strategy) {
  const usable = sizes.filter(s => s > 0 && s <= total);
  if (usable.length === 0) return null;

  if (strategy === 'fewest_modules') {
    const best = new Array(total + 1).fill(Infinity);
    best[0] = 0;
    for (let n = 1; n <= total; n++) {
      for (const s of usable) if (s <= n && best[n - s] + 1 < best[n]) best[n] = best[n - s] + 1;
    }
    if (!Number.isFinite(best[total])) return null;
    const desc = [...usable].sort((a, b) => b - a);
    const out = [];
    let rem = total;
    while (rem > 0) {
      const s = desc.find(x => x <= rem && best[rem - x] === best[rem] - 1);
      out.push(s);
      rem -= s;
    }
    return out;
  }

  const order = [...usable].sort((a, b) => (strategy === 'smallest_first' ? a - b : b - a));
  const dfs = rem => {
    if (rem === 0) return [];
    for (const s of order) {
      if (s > rem) continue;
      const rest = dfs(rem - s);
      if (rest) return [s, ...rest];
    }
    return null;
  };
  return dfs(total);
}

// ─── Analysis ────────────────────────────────────────────────────────────────

/**
 * @typedef {{rowIndex:number, device:string|null, bay:number|null, code:string, params?:object}} ImportIssue
 * @typedef {{bay:number, moduleType:string, category:string, color:string, size:number, ports:string[]|null}} BayAssignment
 * @typedef {{name:string, rowIndex:number, block:string, bays:(BayAssignment|null)[], issues:ImportIssue[]}} ImportDevice
 */

/**
 * @param {{headers:string[], rows:Object[]}} table already cleaned (see cleanTable)
 * @param {object} profile
 * @returns {{devices: ImportDevice[], errors: ImportIssue[], warnings: ImportIssue[],
 *            summary: {rows:number, devices:number, baysUsed:number, errors:number, warnings:number}}}
 */
export function analyzeCsv(table, profile) {
  const errors = [];
  const warnings = [];
  const devices = [];
  const slots = Number(profile.slot_count) || 12;
  const headerMap = new Map(table.headers.map(h => [miNorm(h), h]));
  const findHeader = name => headerMap.get(miNorm(name));
  const fileLevelReported = new Set();

  const reportFile = (code, params) => {
    const key = code + JSON.stringify(params);
    if (fileLevelReported.has(key)) return;
    fileLevelReported.add(key);
    errors.push({ rowIndex: 0, device: null, bay: null, code, params });
  };

  const colPattern = field => (profile.columns || []).find(c => c.internal_field === field)?.column_suffix_pattern;
  const orderedRules = rulesInOrder(profile);

  for (const block of profile.blocks || []) {
    const countHeader = findHeader(block.count_column);
    if (!countHeader) { reportFile('column_missing', { column: block.count_column }); continue; }
    const seq = block.block_sequence || [];

    table.rows.forEach((row, rIdx) => {
      const rowIndex = rIdx + 1;
      const count = parseNumeric(row[countHeader]);
      if (count.invalid || (count.value !== null && (!Number.isInteger(count.value) || count.value < 0))) {
        errors.push({ rowIndex, device: null, bay: null, code: 'block_count_invalid', params: { value: row[countHeader], max: seq.length } });
        return;
      }
      const n = count.value ?? 0;
      if (n > seq.length) {
        errors.push({ rowIndex, device: null, bay: null, code: 'block_count_invalid', params: { value: n, max: seq.length } });
        return;
      }
      const rowName = block.row_name_column ? (row[findHeader(block.row_name_column)] || '').trim() : '';

      for (const blockId of seq.slice(0, n)) {
        const prefix = fillPattern(block.prefix_pattern, { block: blockId });
        const name = [rowName, prefix].filter(Boolean).join(' ');
        const device = { name, rowIndex, block: blockId, bays: new Array(slots).fill(null), issues: [] };
        const fail = (code, params, bay = null) => {
          const issue = { rowIndex, device: name, bay, code, params };
          errors.push(issue);
          device.issues.push(issue);
        };

        // ── read the block's columns ──
        const readCount = field => {
          const pattern = colPattern(field);
          if (!pattern) return 0;
          const header = findHeader(fillPattern(pattern, { prefix, block: blockId }));
          if (!header) { reportFile('column_missing', { column: fillPattern(pattern, { prefix, block: blockId }) }); return 0; }
          const v = parseNumeric(row[header]);
          if (v.invalid) { fail('column_value_invalid', { column: header, value: row[header] }); return 0; }
          return v.value ?? 0;
        };
        const white = readCount('sockets_white');
        const orange = readCount('sockets_orange');

        const lanNames = [];
        const lanPattern = colPattern('lan_port_name');
        if (lanPattern) {
          let foundAny = false;
          for (let i = 1; i <= MAX_LAN_PORTS; i++) {
            const header = findHeader(fillPattern(lanPattern, { prefix, block: blockId, n: i }));
            if (!header) break;
            foundAny = true;
            const v = (row[header] || '').trim();
            if (v !== '') lanNames.push(v);
          }
          if (!foundAny) reportFile('column_missing', { column: fillPattern(lanPattern, { prefix, block: blockId, n: 1 }) });
        }

        // ── demands → chunks → bays ──
        const demands = [
          { category: 'LAN', color: '', total: lanNames.length, names: lanNames },
          { category: 'Strom', color: 'white', total: white, names: null },
          { category: 'Strom', color: 'orange', total: orange, names: null },
        ];
        const occupied = new Set();

        for (const d of demands) {
          if (!d.total || d.total <= 0) continue;
          if (!Number.isInteger(d.total)) { fail('column_value_invalid', { column: d.category, value: d.total }); continue; }

          const chunks = splitDemand(profile, d, fail);
          if (!chunks) continue;
          let offset = 0;
          for (const ch of chunks) {
            const ports = d.names ? d.names.slice(offset, offset + ch.size) : null;
            offset += ch.size;
            const ctx = { category: d.category, port_count: ch.size, socket_color: d.color, block: blockId, row: rowName };
            const candidates = orderedRules.filter(r =>
              (!ch.forcedModule || r.netbox_module_type_id === ch.forcedModule) &&
              (r.conditions || []).every(c => conditionMatches(c, ctx)));
            if (candidates.length === 0) { fail('no_rule', { category: d.category, size: ch.size, color: d.color }); continue; }

            let placed = false;
            for (const r of candidates) {
              const lo = Math.max(1, Number(r.min_bay));
              const hi = Math.min(slots, Number(r.max_bay));
              for (let bay = lo; bay <= hi; bay++) {
                if (occupied.has(bay)) continue;
                occupied.add(bay);
                device.bays[bay - 1] = {
                  bay, moduleType: r.netbox_module_type_id, category: d.category,
                  color: d.color, size: ch.size, ports,
                };
                placed = true;
                break;
              }
              if (placed) break;
            }
            if (!placed) {
              const allOutside = candidates.every(r => Number(r.min_bay) > slots);
              fail(allOutside ? 'bay_out_of_range' : 'no_free_bay',
                { category: d.category, size: ch.size, color: d.color });
            }
          }
        }

        if (!device.bays.some(Boolean) && device.issues.length === 0) {
          warnings.push({ rowIndex, device: name, bay: null, code: 'device_no_modules' });
        }
        devices.push(device);
      }
    });
  }

  return {
    devices, errors, warnings,
    summary: {
      rows: table.rows.length,
      devices: devices.length,
      baysUsed: devices.reduce((s, d) => s + d.bays.filter(Boolean).length, 0),
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}

/** Turn a demand into module chunks [{size, forcedModule?}] or null (after reporting via fail). */
function splitDemand(profile, demand, fail) {
  const { category, color, total } = demand;

  const split = (profile.splitRules || []).find(s =>
    s.category === category && Number(s.total_count) === total && (!s.color || miNorm(s.color) === miNorm(color)));
  if (split) {
    const chunks = (split.module_type_sequence || []).map(name => ({ size: moduleSizeFor(profile, name), forcedModule: name }));
    if (chunks.length === 0 || chunks.some(c => c.size === null) ||
        chunks.reduce((s, c) => s + c.size, 0) !== total) {
      fail('split_unresolvable', { category, total });
      return null;
    }
    return chunks;
  }

  const sizes = availableSizes(profile, category, color);
  if (sizes.length === 0) { fail('no_rule', { category, size: total, color }); return null; }
  const composed = composeSizes(total, sizes, profile.default_split_strategy || 'largest_first');
  if (!composed) { fail('split_unresolvable', { category, total }); return null; }
  return composed.map(size => ({ size }));
}

// ─── Output builders ─────────────────────────────────────────────────────────

/** Rows for `module-import.csv`: one row per bay that receives a module. */
export function buildModuleImportRows(devices, profile) {
  const rows = [];
  for (const d of devices) {
    for (const b of d.bays) {
      if (!b) continue;
      rows.push({
        device: d.name,
        module_bay: fillPattern(profile.bay_name_pattern || '{n}', { n: b.bay }),
        module_type: b.moduleType,
        status: 'active',
      });
    }
  }
  return rows;
}

/**
 * Interfaces NetBox will create for LAN modules, with the target name from the source file.
 * @returns {Array<{device:string, bay:number, expected:string, newName:string}>}
 */
export function expectedInterfaces(devices, profile) {
  const out = [];
  for (const d of devices) {
    for (const b of d.bays) {
      if (!b || b.category !== 'LAN' || !b.ports) continue;
      b.ports.forEach((portName, i) => {
        out.push({
          device: d.name,
          bay: b.bay,
          expected: fillPattern(profile.interface_name_template || 'Gi{module}/0/{n}', { module: b.bay, n: i + 1 }),
          newName: portName,
        });
      });
    }
  }
  return out;
}

/**
 * Read an interface list exported from NetBox (needs id, device, name columns).
 * @returns {{interfaces: Array<{id:string, device:string, name:string}>, missing: string[]}}
 */
export function readInterfaceTable(table) {
  const find = key => table.headers.find(h => miNorm(h) === key);
  const idH = find('id'), devH = find('device'), nameH = find('name');
  const missing = [['id', idH], ['device', devH], ['name', nameH]].filter(([, h]) => !h).map(([k]) => k);
  if (missing.length) return { interfaces: [], missing };
  return {
    interfaces: table.rows
      .filter(r => (r[idH] || '').trim() !== '')
      .map(r => ({ id: r[idH].trim(), device: (r[devH] || '').trim(), name: (r[nameH] || '').trim() })),
    missing: [],
  };
}

/**
 * Match expected interfaces to NetBox interfaces (device + name) and build the rename rows.
 * @returns {{rows: Array<{id:string,name:string}>, unmatched: object[], unchanged: number}}
 */
export function buildInterfaceRename(devices, profile, interfaces) {
  const byKey = new Map();
  for (const i of interfaces) {
    const key = `${i.device}\u0000${i.name}`;
    if (!byKey.has(key)) byKey.set(key, i);
  }
  const rows = [];
  const unmatched = [];
  let unchanged = 0;
  for (const e of expectedInterfaces(devices, profile)) {
    const hit = byKey.get(`${e.device}\u0000${e.expected}`);
    if (!hit) { unmatched.push(e); continue; }
    if (hit.name === e.newName) { unchanged++; continue; }
    rows.push({ id: hit.id, name: e.newName });
  }
  return { rows, unmatched, unchanged };
}
