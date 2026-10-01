// Run: node testing/module-import.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCsvTable, writeCsv } from '../js/csv.js';
import {
  analyzeCsv, cleanTable, composeSizes, parseNumeric, buildModuleImportRows,
  buildInterfaceRename, readInterfaceTable, expectedInterfaces,
  MODULE_IMPORT_HEADERS, INTERFACE_RENAME_HEADERS,
} from '../js/import-engine.js';
import {
  createSeedProfile, validateProfile, duplicateProfile, exportProfileJson, importProfileJson,
  loadProfiles, saveProfiles, PROFILES_KEY, expandSequence,
} from '../js/import-profiles.js';

const dir = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

// ── helpers ──
test('parseNumeric treats x / empty / dash as empty, accepts decimal comma', () => {
  assert.deepEqual(parseNumeric('x'), { value: null, invalid: false });
  assert.deepEqual(parseNumeric(''), { value: null, invalid: false });
  assert.deepEqual(parseNumeric('-'), { value: null, invalid: false });
  assert.deepEqual(parseNumeric('3,5'), { value: 3.5, invalid: false });
  assert.equal(parseNumeric('abc').invalid, true);
});

test('composeSizes strategies', () => {
  assert.deepEqual(composeSizes(5, [2, 3], 'largest_first'), [3, 2]);
  assert.deepEqual(composeSizes(4, [2, 3], 'largest_first'), [2, 2]); // backtracks 3+1
  assert.deepEqual(composeSizes(5, [2, 3], 'smallest_first'), [2, 3]);
  assert.deepEqual(composeSizes(6, [2, 3], 'fewest_modules'), [3, 3]);
  assert.equal(composeSizes(1, [2, 3], 'largest_first'), null);
  assert.equal(composeSizes(3, [], 'largest_first'), null);
});

test('expandSequence handles letter/number ranges and plain lists', () => {
  assert.deepEqual(expandSequence('A-D'), ['A', 'B', 'C', 'D']);
  assert.deepEqual(expandSequence('1-3, X'), ['1', '2', '3', 'X']);
  assert.deepEqual(expandSequence('a-c'), ['a', 'b', 'c']);
  assert.deepEqual(expandSequence('D-A'), ['D-A']); // descending is not a range
  assert.deepEqual(expandSequence(' Nord , Süd '), ['Nord', 'Süd']);
});

// ── profile ──
const profile = createSeedProfile();

test('seed profile validates without errors', () => {
  const { errors } = validateProfile(profile);
  assert.deepEqual(errors, []);
});

test('validator catches broken profiles', () => {
  const p = createSeedProfile();
  p.rules[0].min_bay = 9; p.rules[0].max_bay = 3;
  p.splitRules.push({ id: 'x', category: 'LAN', total_count: 5, module_type_sequence: ['LAN-Modul 3-Port', 'LAN-Modul 3-Port'] });
  p.blocks[0].block_sequence = ['A', 'A'];
  const codes = validateProfile(p).errors.map(e => e.code);
  assert.ok(codes.includes('rule_bay_range'));
  assert.ok(codes.includes('split_sum_mismatch'));
  assert.ok(codes.includes('block_sequence_duplicate'));
});

test('profile persistence, duplicate and JSON round trip', () => {
  const mem = new Map();
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const first = loadProfiles(storage);
  assert.equal(first.length, 1);
  assert.equal(first[0].is_default, true);
  assert.ok(mem.has(PROFILES_KEY));
  const dup = duplicateProfile(first[0]);
  assert.notEqual(dup.id, first[0].id);
  assert.equal(dup.is_default, false);
  saveProfiles([...first, dup], storage);
  assert.equal(loadProfiles(storage).length, 2);
  const imported = importProfileJson(exportProfileJson(dup));
  assert.equal(imported.name, dup.name);
  assert.equal(imported.rules.length, dup.rules.length);
  assert.equal(importProfileJson('{"nope":1}'), null);
});

// ── engine on the sample CSV ──
const table = cleanTable(parseCsvTable(readFileSync(join(dir, 'module-import-sample.csv'), 'utf8')));
const result = analyzeCsv(table, profile);
const dev = name => result.devices.find(d => d.name === name);
const bay = (d, n) => d.bays[n - 1];

test('#NAME? column is ignored', () => {
  assert.ok(!table.headers.some(h => h.startsWith('#NAME?')));
  assert.equal(table.dropped.length, 1);
});

test('one device per occupied block, none for count 0 / x', () => {
  assert.deepEqual(result.devices.map(d => d.name).sort(), [
    'Raum 1, EG Bodentank A', 'Raum 1, EG Bodentank B', 'Raum 3 Bodentank A', 'Raum 6 Bodentank A',
  ]);
});

test('port count 5 splits 3+2 and sockets follow the bay range (power from bay 6)', () => {
  const a = dev('Raum 1, EG Bodentank A');
  assert.equal(bay(a, 1).moduleType, 'LAN-Modul 3-Port');
  assert.deepEqual(bay(a, 1).ports, ['P1', 'P2', 'P3']);
  assert.equal(bay(a, 2).moduleType, 'LAN-Modul 2-Port');
  assert.deepEqual(bay(a, 2).ports, ['P4', 'P5']);
  assert.equal(bay(a, 6).moduleType, 'Steckdosenmodul 3-fach Weiß');
  assert.equal(bay(a, 7).moduleType, 'Steckdosenmodul 2-fach Weiß');
  assert.equal(bay(a, 8).moduleType, 'Steckdosenmodul 2-fach Orange');
  assert.equal(a.issues.length, 0);
});

test('"x" in a numeric socket column counts as empty', () => {
  const b = dev('Raum 1, EG Bodentank B');
  assert.equal(bay(b, 1).moduleType, 'LAN-Modul 2-Port');
  assert.equal(bay(b, 6).moduleType, 'Steckdosenmodul 3-fach Orange');
  assert.equal(b.bays.filter(Boolean).length, 2);
});

test('unresolvable split and invalid block count become errors, never guesses', () => {
  const codes = result.errors.map(e => `${e.code}@${e.device ?? e.rowIndex}`);
  assert.ok(codes.includes('split_unresolvable@Raum 3 Bodentank A'), codes.join());
  assert.ok(codes.includes('block_count_invalid@4'), codes.join());
});

test('bay range exhausted reports no_free_bay for the overflow chunk', () => {
  const d = dev('Raum 6 Bodentank A');
  assert.equal(d.bays.filter(Boolean).length, 7); // bays 6..12
  assert.ok(d.bays.slice(0, 5).every(b => b === null));
  const issue = d.issues.find(i => i.code === 'no_free_bay');
  assert.ok(issue, JSON.stringify(d.issues));
});

test('missing count column is a file-level error', () => {
  const t = { headers: ['Foo'], rows: [{ Foo: '1' }] };
  const r = analyzeCsv(t, profile);
  assert.equal(r.errors[0].code, 'column_missing');
  assert.equal(r.devices.length, 0);
});

test('PortSplitRule overrides the default strategy', () => {
  const p = createSeedProfile();
  p.splitRules.push({ id: 's', category: 'LAN', total_count: 5, module_type_sequence: ['LAN-Modul 2-Port', 'LAN-Modul 3-Port'] });
  const a = analyzeCsv(table, p).devices.find(d => d.name === 'Raum 1, EG Bodentank A');
  assert.equal(a.bays[0].moduleType, 'LAN-Modul 2-Port');
  assert.deepEqual(a.bays[0].ports, ['P1', 'P2']);
  assert.equal(a.bays[1].moduleType, 'LAN-Modul 3-Port');
  assert.deepEqual(a.bays[1].ports, ['P3', 'P4', 'P5']);
});

test('rule range beyond the slot count reports bay_out_of_range', () => {
  const p = createSeedProfile();
  p.rules.find(r => r.netbox_module_type_id === 'Steckdosenmodul 3-fach Orange').min_bay = 13;
  const r = analyzeCsv(table, p);
  const b = r.devices.find(d => d.name === 'Raum 1, EG Bodentank B');
  assert.ok(b.issues.some(i => i.code === 'bay_out_of_range'));
});

// ── exports ──
test('module-import.csv has one row per used bay with NetBox columns', () => {
  const only = { devices: [dev('Raum 1, EG Bodentank B')] };
  const rows = buildModuleImportRows(only.devices, profile);
  assert.deepEqual(rows, [
    { device: 'Raum 1, EG Bodentank B', module_bay: '1', module_type: 'LAN-Modul 2-Port', status: 'active' },
    { device: 'Raum 1, EG Bodentank B', module_bay: '6', module_type: 'Steckdosenmodul 3-fach Orange', status: 'active' },
  ]);
  assert.equal(writeCsv(rows, MODULE_IMPORT_HEADERS).split('\n')[0], 'device,module_bay,module_type,status');
  // the device name contains a comma, so it must be quoted for NetBox's CSV import
  assert.ok(writeCsv(rows, MODULE_IMPORT_HEADERS).split('\n')[1].startsWith('"Raum 1, EG Bodentank B",1,'));
});

test('interface-rename.csv maps NetBox interface ids to the source port names', () => {
  const a = dev('Raum 1, EG Bodentank A');
  const exp = expectedInterfaces([a], profile);
  assert.deepEqual(exp.map(e => e.expected), ['Gi1/0/1', 'Gi1/0/2', 'Gi1/0/3', 'Gi2/0/1', 'Gi2/0/2']);

  const netbox = parseCsvTable([
    'id,device,name,type',
    '101,"Raum 1, EG Bodentank A",Gi1/0/1,1000base-t',
    '102,"Raum 1, EG Bodentank A",Gi1/0/2,1000base-t',
    '103,"Raum 1, EG Bodentank A",Gi1/0/3,1000base-t',
    '104,"Raum 1, EG Bodentank A",Gi2/0/1,1000base-t',
    '999,Other,Gi2/0/2,1000base-t',
  ].join('\n'));
  const { interfaces, missing } = readInterfaceTable(netbox);
  assert.deepEqual(missing, []);
  const res = buildInterfaceRename([a], profile, interfaces);
  assert.deepEqual(res.rows, [
    { id: '101', name: 'P1' }, { id: '102', name: 'P2' }, { id: '103', name: 'P3' }, { id: '104', name: 'P4' },
  ]);
  assert.equal(res.unmatched.length, 1);
  assert.equal(res.unmatched[0].expected, 'Gi2/0/2');
  assert.equal(writeCsv(res.rows, INTERFACE_RENAME_HEADERS).split('\n')[0], 'id,name');
});

test('interface export without required columns is reported', () => {
  const { missing } = readInterfaceTable(parseCsvTable('foo,bar\n1,2'));
  assert.deepEqual(missing, ['id', 'device', 'name']);
});

// ── i18n completeness ──
const i18nSrc = readFileSync(join(dir, '../js/i18n.js'), 'utf8');
const cut = i18nSrc.indexOf('\n  de: {');
const keysOf = src => new Set([...src.matchAll(/^ {4}(\w+):/gm)].map(m => m[1]));
const enKeys = keysOf(i18nSrc.slice(0, cut));
const deKeys = keysOf(i18nSrc.slice(cut));

test('EN and DE have the same keys', () => {
  const onlyEn = [...enKeys].filter(k => !deKeys.has(k));
  const onlyDe = [...deKeys].filter(k => !enKeys.has(k));
  assert.deepEqual({ onlyEn, onlyDe }, { onlyEn: [], onlyDe: [] });
});

test('every literal t() key in the wizard and every data-i18n key in the dialog exists', () => {
  const ui = readFileSync(join(dir, '../js/module-import.js'), 'utf8');
  const html = readFileSync(join(dir, '../index.html'), 'utf8');
  const dialog = html.slice(html.indexOf('id="module-import-dialog"'), html.indexOf('<!-- Settings Modal -->'));
  const used = new Set([
    ...[...ui.matchAll(/\bt\('([\w]+)'/g)].map(m => m[1]),
    ...[...dialog.matchAll(/data-i18n="([\w]+)"/g)].map(m => m[1]),
    ...[...ui.matchAll(/'(mi_\w+)'/g)].map(m => m[1]),
  ]);
  const missing = [...used].filter(k => !enKeys.has(k) && !k.endsWith('_'));
  assert.deepEqual(missing, []);
});

test('every engine error code and validator code has a translation', () => {
  const engine = readFileSync(join(dir, '../js/import-engine.js'), 'utf8');
  const prof = readFileSync(join(dir, '../js/import-profiles.js'), 'utf8');
  const engineCodes = new Set([
    ...[...engine.matchAll(/(?:fail|reportFile)\('(\w+)'/g)].map(m => m[1]),
    ...[...engine.matchAll(/code: '(\w+)'/g)].map(m => m[1]),
    ...[...engine.matchAll(/fail\(allOutside \? '(\w+)' : '(\w+)'/g)].flatMap(m => [m[1], m[2]]),
  ]);
  const valCodes = new Set([...prof.matchAll(/\b(?:err|warn)\('(\w+)'/g)].map(m => m[1]));
  assert.ok(engineCodes.size >= 8 && valCodes.size >= 20, `${engineCodes.size}/${valCodes.size}`);
  assert.deepEqual([...engineCodes].filter(c => !enKeys.has('mi_err_' + c)), []);
  assert.deepEqual([...valCodes].filter(c => !enKeys.has('mi_val_' + c)), []);
});

console.log(`\n${passed} tests passed`);
