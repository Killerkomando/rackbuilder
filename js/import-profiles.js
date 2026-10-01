// Import profiles for the NetBox module import (stored separately from the undo state).
// Pure data logic: only the load/save helpers touch localStorage (injectable for tests).

import { generateId } from './utils.js';

export const PROFILES_KEY = 'rackbuilder_import_profiles';

export const SPLIT_STRATEGIES = ['largest_first', 'smallest_first', 'fewest_modules'];
export const CONDITION_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'empty', 'notempty'];
export const INTERNAL_FIELDS = ['sockets_white', 'sockets_orange', 'lan_port_name'];
/** Fields a MappingRule condition can test (derived by the engine). */
export const CONDITION_FIELDS = ['category', 'port_count', 'socket_color', 'block', 'row'];


// ─── Factories ───────────────────────────────────────────────────────────────

export function createEmptyProfile(name = 'New profile') {
  return {
    id: generateId(),
    name,
    netbox_device_type_id: '',
    default_split_strategy: 'largest_first',
    is_default: false,
    slot_count: 12,
    bay_name_pattern: '{n}',
    interface_name_template: 'Gi{module}/0/{n}',
    created_at: new Date().toISOString(),
    rules: [],
    splitRules: [],
    blocks: [],
    columns: [],
  };
}

function makeSeedRule(priority, category, color, ports, moduleType, minBay, maxBay) {
  const conditions = [{ field: 'category', op: 'eq', value: category }];
  if (color) conditions.push({ field: 'socket_color', op: 'eq', value: color });
  conditions.push({ field: 'port_count', op: 'eq', value: ports });
  return { id: generateId(), priority, conditions, netbox_module_type_id: moduleType, min_bay: minBay, max_bay: maxBay };
}

/** The bundled starting point (is_default). Names follow the spec's module type proposal. */
export function createSeedProfile() {
  const p = createEmptyProfile('NetBox Standard (12-Bay)');
  p.id = 'default-12bay';
  p.is_default = true;
  p.blocks = [{
    id: generateId(),
    count_column: 'Anzahl Bodentanks',
    prefix_pattern: 'Bodentank {block}',
    block_sequence: 'ABCDEFGHIJK'.split(''),
    row_name_column: 'Raum',
  }];
  p.columns = [
    { id: generateId(), internal_field: 'sockets_white', column_suffix_pattern: '{prefix} Steckdosen weiß' },
    { id: generateId(), internal_field: 'sockets_orange', column_suffix_pattern: '{prefix} Steckdosen orange' },
    { id: generateId(), internal_field: 'lan_port_name', column_suffix_pattern: '{prefix} Buchse {n}' },
  ];
  p.rules = [
    makeSeedRule(10, 'LAN', null, 3, 'LAN-Modul 3-Port', 1, 12),
    makeSeedRule(20, 'LAN', null, 2, 'LAN-Modul 2-Port', 1, 12),
    makeSeedRule(30, 'Strom', 'white', 3, 'Steckdosenmodul 3-fach Weiß', 6, 12),
    makeSeedRule(40, 'Strom', 'white', 2, 'Steckdosenmodul 2-fach Weiß', 6, 12),
    makeSeedRule(50, 'Strom', 'orange', 3, 'Steckdosenmodul 3-fach Orange', 6, 12),
    makeSeedRule(60, 'Strom', 'orange', 2, 'Steckdosenmodul 2-fach Orange', 6, 12),
  ];
  return p;
}

// ─── Helpers shared with the engine ──────────────────────────────────────────

/**
 * Port count of a module type, derived from the profile's rules ("port_count eq N").
 * @returns {number|null}
 */
export function moduleSizeFor(profile, moduleName) {
  for (const r of profile.rules || []) {
    if (r.netbox_module_type_id !== moduleName) continue;
    const c = (r.conditions || []).find(c => c.field === 'port_count' && c.op === 'eq');
    if (c && Number.isFinite(Number(c.value))) return Number(c.value);
  }
  return null;
}

/** Fill `{prefix}`, `{block}`, `{n}` placeholders. */
export function fillPattern(pattern, vars) {
  return String(pattern ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/**
 * Expand a block sequence typed by the user: "A-K", "1-12", "A, C, Nord" or a mix.
 * Ranges must be ascending single letters of the same case or integers (max 500 entries).
 * @param {string} text
 * @returns {string[]}
 */
export function expandSequence(text) {
  const out = [];
  for (const raw of String(text ?? '').split(',')) {
    const tok = raw.trim();
    if (!tok) continue;
    let m = tok.match(/^([A-Za-z])\s*-\s*([A-Za-z])$/);
    if (m && (m[1] === m[1].toUpperCase()) === (m[2] === m[2].toUpperCase()) && m[1] <= m[2]) {
      for (let c = m[1].charCodeAt(0); c <= m[2].charCodeAt(0); c++) out.push(String.fromCharCode(c));
      continue;
    }
    m = tok.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m && Number(m[1]) <= Number(m[2]) && Number(m[2]) - Number(m[1]) < 500) {
      for (let n = Number(m[1]); n <= Number(m[2]); n++) out.push(String(n));
      continue;
    }
    out.push(tok);
  }
  return out;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * @param {object} profile
 * @param {string[]} [knownModuleTypes] names from the uploaded NetBox module types (optional)
 * @returns {{errors: Array<{code:string, params?:object}>, warnings: Array<{code:string, params?:object}>}}
 */
export function validateProfile(profile, knownModuleTypes = []) {
  const errors = [];
  const warnings = [];
  const err = (code, params) => errors.push({ code, params });
  const warn = (code, params) => warnings.push({ code, params });

  if (!profile.name || !String(profile.name).trim()) err('name_required');
  const slots = Number(profile.slot_count);
  if (!Number.isInteger(slots) || slots < 1 || slots > 99) err('slot_count_invalid');
  if (!SPLIT_STRATEGIES.includes(profile.default_split_strategy)) err('strategy_invalid');

  const known = new Set(knownModuleTypes);
  const prios = new Set();
  (profile.rules || []).forEach((r, i) => {
    const idx = i + 1;
    if (!r.netbox_module_type_id) err('rule_module_required', { rule: idx });
    else if (known.size && !known.has(r.netbox_module_type_id)) warn('rule_module_unknown', { rule: idx, name: r.netbox_module_type_id });
    const min = Number(r.min_bay), max = Number(r.max_bay);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) err('rule_bay_range', { rule: idx });
    else if (max > slots) warn('rule_bay_beyond_slots', { rule: idx });
    for (const c of r.conditions || []) {
      if (!CONDITION_OPS.includes(c.op) || !c.field) err('rule_condition_invalid', { rule: idx });
      else if (c.op === 'in' && !Array.isArray(c.value)) err('rule_condition_invalid', { rule: idx });
    }
    if (prios.has(r.priority)) warn('rule_priority_duplicate', { rule: idx, priority: r.priority });
    prios.add(r.priority);
  });

  (profile.splitRules || []).forEach((s, i) => {
    const idx = i + 1;
    if (!['LAN', 'Strom'].includes(s.category)) err('split_category_invalid', { split: idx });
    const seq = s.module_type_sequence || [];
    if (!Number.isInteger(Number(s.total_count)) || Number(s.total_count) < 1) err('split_total_invalid', { split: idx });
    if (seq.length === 0) { err('split_sequence_empty', { split: idx }); return; }
    const sizes = seq.map(n => moduleSizeFor(profile, n));
    if (sizes.some(x => x === null)) err('split_size_unknown', { split: idx });
    else if (sizes.reduce((a, b) => a + b, 0) !== Number(s.total_count)) err('split_sum_mismatch', { split: idx });
  });

  (profile.blocks || []).forEach((b, i) => {
    const idx = i + 1;
    if (!b.count_column) err('block_count_column_required', { block: idx });
    if (!b.prefix_pattern) err('block_prefix_required', { block: idx });
    const seq = b.block_sequence || [];
    if (seq.length === 0) err('block_sequence_empty', { block: idx });
    else if (new Set(seq).size !== seq.length) err('block_sequence_duplicate', { block: idx });
  });

  const fields = new Set();
  for (const c of profile.columns || []) {
    if (!INTERNAL_FIELDS.includes(c.internal_field)) err('column_field_invalid');
    if (!c.column_suffix_pattern) err('column_pattern_required', { field: c.internal_field });
    fields.add(c.internal_field);
  }
  if ((profile.blocks || []).length === 0) warn('no_blocks');
  if (!fields.has('lan_port_name') && !fields.has('sockets_white') && !fields.has('sockets_orange')) warn('no_columns');

  return { errors, warnings };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/** Load profiles; seeds the default profile when nothing is stored. */
export function loadProfiles(storage = globalThis.localStorage) {
  let profiles = [];
  try {
    const raw = storage?.getItem(PROFILES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.profiles)) profiles = parsed.profiles;
    }
  } catch { /* corrupted → reseed */ }
  if (profiles.length === 0) {
    profiles = [createSeedProfile()];
    saveProfiles(profiles, storage);
  }
  return profiles;
}

export function saveProfiles(profiles, storage = globalThis.localStorage) {
  try {
    storage?.setItem(PROFILES_KEY, JSON.stringify({ version: 1, profiles }));
  } catch (e) {
    console.warn('Failed to save import profiles:', e);
  }
}

export function duplicateProfile(profile) {
  const copy = JSON.parse(JSON.stringify(profile));
  copy.id = generateId();
  copy.name = `${profile.name} (copy)`;
  copy.is_default = false;
  copy.created_at = new Date().toISOString();
  for (const list of [copy.rules, copy.splitRules, copy.blocks, copy.columns]) {
    (list || []).forEach(x => { x.id = generateId(); });
  }
  return copy;
}

export function exportProfileJson(profile) {
  return JSON.stringify({ _format: 'rackbuilder-import-profile', version: 1, profile }, null, 2);
}

/** @returns {object|null} a fresh profile (new ids, never is_default) or null when invalid */
export function importProfileJson(text) {
  try {
    const data = JSON.parse(text);
    if (data?._format !== 'rackbuilder-import-profile' || !data.profile) return null;
    const p = { ...createEmptyProfile(data.profile.name || 'Imported'), ...data.profile };
    p.id = generateId();
    p.is_default = false;
    for (const list of [p.rules, p.splitRules, p.blocks, p.columns]) {
      (list || []).forEach(x => { x.id = generateId(); });
    }
    return p;
  } catch { return null; }
}
