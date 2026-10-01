// NetBox module import wizard: profile + CSV → preview (12-bay slot view) → export → interface IDs.

import { t } from './i18n.js';
import { triggerDownload, closeDialogAnimated, generateId } from './utils.js';
import { parseCsvTable, writeCsv } from './csv.js';
import { createZip } from './zip.js';
import {
  loadProfiles, saveProfiles, createEmptyProfile, createSeedProfile, duplicateProfile,
  exportProfileJson, importProfileJson, validateProfile, expandSequence,
  SPLIT_STRATEGIES, CONDITION_OPS, CONDITION_FIELDS, INTERNAL_FIELDS,
} from './import-profiles.js';
import {
  cleanTable, analyzeCsv, buildModuleImportRows, buildInterfaceRename, readInterfaceTable,
  expectedInterfaces, MODULE_IMPORT_HEADERS, INTERFACE_RENAME_HEADERS,
} from './import-engine.js';
import { getModuleTypes, getDeviceTypes, getApiCredentials, apiFetchPages } from './netbox-autocomplete.js';

const S = {
  profiles: [],
  activeId: null,
  draft: null,
  editorTab: 'general',
  table: null,
  fileName: '',
  ignoredCols: 0,
  analysis: null,
  rename: null,
};

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clone = o => JSON.parse(JSON.stringify(o));
const activeProfile = () => S.profiles.find(p => p.id === S.activeId) || S.profiles[0];
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile';

function moduleColor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 38%)`;
}

function issueText(issue) {
  const parts = [];
  if (issue.rowIndex) parts.push(t('mi_pv_row', { row: issue.rowIndex }));
  if (issue.bay) parts.push(t('mi_pv_bay', { bay: issue.bay }));
  const msg = t('mi_err_' + issue.code, issue.params || {});
  return (parts.length ? parts.join(' · ') + ': ' : '') + msg;
}

function validationText(item) {
  return t('mi_val_' + item.code, item.params || {});
}

// ─── Steps ───────────────────────────────────────────────────────────────────

function showStep(n) {
  document.querySelectorAll('#module-import-dialog .mi-step').forEach(el =>
    el.classList.toggle('active', Number(el.dataset.step) === n));
  document.querySelectorAll('#mi-steps li').forEach(el => {
    const s = Number(el.dataset.step);
    el.classList.toggle('active', s === n);
    el.classList.toggle('done', s < n);
  });
  $('module-import-dialog').scrollTop = 0;
}

// ─── Step 1: profile & file ──────────────────────────────────────────────────

function renderProfileSelect() {
  const sel = $('mi-profile');
  sel.innerHTML = S.profiles.map(p =>
    `<option value="${esc(p.id)}"${p.id === S.activeId ? ' selected' : ''}>${esc(p.name)}${p.is_default ? ' · ' + esc(t('mi_default_badge')) : ''}</option>`
  ).join('');
}

function setActive(id) {
  S.activeId = id;
  renderProfileSelect();
}

function persistProfiles() {
  saveProfiles(S.profiles);
}

function openEditor() {
  S.draft = clone(activeProfile());
  S.editorTab = 'general';
  $('mi-editor').hidden = false;
  $('mi-editor-msg').innerHTML = '';
  renderEditor();
}

function closeEditor() {
  S.draft = null;
  $('mi-editor').hidden = true;
}

async function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

async function onCsvChosen(file) {
  if (!file) return;
  const text = await readTextFile(file);
  const parsed = parseCsvTable(text);
  const cleaned = cleanTable(parsed);
  S.table = cleaned;
  S.fileName = file.name;
  S.ignoredCols = cleaned.dropped.length;
  let info = t('mi_file_info', { name: file.name, rows: cleaned.rows.length, cols: cleaned.headers.length });
  if (S.ignoredCols) info += ' · ' + t('mi_file_ignored', { count: S.ignoredCols });
  $('mi-file-info').textContent = info;
  $('mi-analyse-btn').disabled = false;
  if (S.draft) renderEditor(); // refresh header suggestions
}

function runAnalysis() {
  if (!S.table) { alert(t('mi_no_file')); return; }
  const profile = activeProfile();
  const { errors } = validateProfile(profile, getModuleTypes().map(m => m.name));
  if (errors.length) {
    alert(t('mi_profile_invalid') + '\n\n' + errors.map(validationText).join('\n'));
    return;
  }
  S.analysis = analyzeCsv(S.table, profile);
  S.rename = null;
  $('mi-pv-errors-only').checked = false;
  renderPreview();
  showStep(2);
}

// ─── Profile editor ──────────────────────────────────────────────────────────

const EDITOR_TABS = ['general', 'rules', 'splits', 'blocks', 'columns'];

function dataLists() {
  const mods = getModuleTypes();
  const types = getDeviceTypes();
  const headers = S.table?.headers || [];
  return `
    <datalist id="mi-dl-modtypes">${mods.map(m => `<option value="${esc(m.name)}">`).join('')}</datalist>
    <datalist id="mi-dl-devtypes">${types.map(m => `<option value="${esc(m.name)}">`).join('')}</datalist>
    <datalist id="mi-dl-headers">${headers.map(h => `<option value="${esc(h)}">`).join('')}</datalist>`;
}

function selectHtml(options, value, attrs, labelFn = o => o) {
  return `<select ${attrs}>${options.map(o =>
    `<option value="${esc(o)}"${String(o) === String(value) ? ' selected' : ''}>${esc(labelFn(o))}</option>`).join('')}</select>`;
}

function renderGeneral(d) {
  return `
    <div class="form-group"><label>${esc(t('mi_ed_name'))}</label>
      <input type="text" data-k="name" value="${esc(d.name)}"></div>
    <div class="form-row">
      <div class="form-group"><label>${esc(t('mi_ed_device_type'))}</label>
        <input type="text" data-k="netbox_device_type_id" list="mi-dl-devtypes" value="${esc(d.netbox_device_type_id)}" autocomplete="off"></div>
      <div class="form-group"><label>${esc(t('mi_ed_slots'))}</label>
        <input type="number" min="1" max="99" data-k="slot_count" value="${esc(d.slot_count)}"></div>
    </div>
    <div class="form-group"><label>${esc(t('mi_ed_strategy'))}</label>
      ${selectHtml(SPLIT_STRATEGIES, d.default_split_strategy, 'data-k="default_split_strategy"', s => t('mi_strategy_' + s))}</div>
    <div class="form-row">
      <div class="form-group"><label>${esc(t('mi_ed_bay_pattern'))}</label>
        <input type="text" data-k="bay_name_pattern" value="${esc(d.bay_name_pattern)}"></div>
      <div class="form-group"><label>${esc(t('mi_ed_iface_template'))}</label>
        <input type="text" data-k="interface_name_template" value="${esc(d.interface_name_template)}"></div>
    </div>
    <p class="settings-section-desc">${esc(t('mi_ed_iface_hint'))}</p>`;
}

function conditionRow(c, ri, ci) {
  const valueText = Array.isArray(c.value) ? c.value.join(', ') : c.value ?? '';
  const needsValue = c.op !== 'empty' && c.op !== 'notempty';
  return `<div class="mi-cond">
    ${selectHtml(CONDITION_FIELDS, c.field, `data-list="rules" data-i="${ri}" data-ci="${ci}" data-k="field"`)}
    ${selectHtml(CONDITION_OPS, c.op, `data-list="rules" data-i="${ri}" data-ci="${ci}" data-k="op" data-rerender="1"`)}
    ${needsValue ? `<input type="text" data-list="rules" data-i="${ri}" data-ci="${ci}" data-k="value" value="${esc(valueText)}">` : ''}
    <button type="button" class="mi-x" data-act="del-cond" data-i="${ri}" data-ci="${ci}" title="${esc(t('mi_ed_remove'))}">×</button>
  </div>`;
}

function renderRules(d) {
  const known = getModuleTypes().length > 0;
  return `
    ${known ? '' : `<p class="settings-section-desc">${esc(t('mi_ed_no_modtypes'))}</p>`}
    ${d.rules.map((r, i) => `
      <div class="mi-item">
        <div class="mi-item-head">
          <label>${esc(t('mi_ed_priority'))}</label>
          <input type="number" class="mi-num" data-list="rules" data-i="${i}" data-k="priority" value="${esc(r.priority)}">
          <button type="button" class="mi-x" data-act="del-rule" data-i="${i}" title="${esc(t('mi_ed_remove'))}">×</button>
        </div>
        <div class="mi-conds">
          <label>${esc(t('mi_ed_conditions'))}</label>
          ${(r.conditions || []).map((c, ci) => conditionRow(c, i, ci)).join('')}
          <button type="button" class="btn btn-secondary btn-sm" data-act="add-cond" data-i="${i}">+ ${esc(t('mi_ed_add_condition'))}</button>
        </div>
        <div class="form-row">
          <div class="form-group"><label>${esc(t('mi_ed_module_type'))}</label>
            <input type="text" list="mi-dl-modtypes" autocomplete="off" data-list="rules" data-i="${i}" data-k="netbox_module_type_id" value="${esc(r.netbox_module_type_id)}"></div>
          <div class="form-group mi-narrow"><label>${esc(t('mi_ed_min_bay'))}</label>
            <input type="number" min="1" data-list="rules" data-i="${i}" data-k="min_bay" value="${esc(r.min_bay)}"></div>
          <div class="form-group mi-narrow"><label>${esc(t('mi_ed_max_bay'))}</label>
            <input type="number" min="1" data-list="rules" data-i="${i}" data-k="max_bay" value="${esc(r.max_bay)}"></div>
        </div>
      </div>`).join('')}
    <button type="button" class="btn btn-secondary btn-sm" data-act="add-rule">+ ${esc(t('mi_ed_add_rule'))}</button>`;
}

function renderSplits(d) {
  return `
    <p class="settings-section-desc">${esc(t('mi_ed_splits_hint'))}</p>
    ${d.splitRules.map((s, i) => `
      <div class="mi-item">
        <div class="mi-item-head">
          <span></span>
          <button type="button" class="mi-x" data-act="del-split" data-i="${i}" title="${esc(t('mi_ed_remove'))}">×</button>
        </div>
        <div class="form-row">
          <div class="form-group"><label>${esc(t('mi_ed_category'))}</label>
            ${selectHtml(['LAN', 'Strom'], s.category, `data-list="splitRules" data-i="${i}" data-k="category"`)}</div>
          <div class="form-group"><label>${esc(t('mi_ed_color'))}</label>
            ${selectHtml(['', 'white', 'orange'], s.color || '', `data-list="splitRules" data-i="${i}" data-k="color"`, o => o || '—')}</div>
          <div class="form-group mi-narrow"><label>${esc(t('mi_ed_total'))}</label>
            <input type="number" min="1" data-list="splitRules" data-i="${i}" data-k="total_count" value="${esc(s.total_count)}"></div>
        </div>
        <div class="form-group"><label>${esc(t('mi_ed_sequence'))}</label>
          <input type="text" data-list="splitRules" data-i="${i}" data-k="module_type_sequence" value="${esc((s.module_type_sequence || []).join(', '))}">
        </div>
      </div>`).join('')}
    <button type="button" class="btn btn-secondary btn-sm" data-act="add-split">+ ${esc(t('mi_ed_add_split'))}</button>`;
}

function renderBlocks(d) {
  return `
    ${d.blocks.map((b, i) => `
      <div class="mi-item">
        <div class="mi-item-head"><span></span>
          <button type="button" class="mi-x" data-act="del-block" data-i="${i}" title="${esc(t('mi_ed_remove'))}">×</button></div>
        <div class="form-row">
          <div class="form-group"><label>${esc(t('mi_ed_count_col'))}</label>
            <input type="text" list="mi-dl-headers" autocomplete="off" data-list="blocks" data-i="${i}" data-k="count_column" value="${esc(b.count_column)}"></div>
          <div class="form-group"><label>${esc(t('mi_ed_row_col'))}</label>
            <input type="text" list="mi-dl-headers" autocomplete="off" data-list="blocks" data-i="${i}" data-k="row_name_column" value="${esc(b.row_name_column || '')}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>${esc(t('mi_ed_prefix'))}</label>
            <input type="text" data-list="blocks" data-i="${i}" data-k="prefix_pattern" value="${esc(b.prefix_pattern)}"></div>
          <div class="form-group"><label>${esc(t('mi_ed_block_seq'))}</label>
            <input type="text" data-list="blocks" data-i="${i}" data-k="block_sequence" value="${esc((b.block_sequence || []).join(', '))}"></div>
        </div>
        <p class="settings-section-desc">${esc(t('mi_ed_block_seq_hint'))}</p>
      </div>`).join('')}
    <button type="button" class="btn btn-secondary btn-sm" data-act="add-block">+ ${esc(t('mi_ed_add_block'))}</button>`;
}

function renderColumns(d) {
  return `
    <p class="settings-section-desc">${esc(t('mi_ed_pattern_hint'))}</p>
    ${d.columns.map((c, i) => `
      <div class="mi-item mi-item--row">
        ${selectHtml(INTERNAL_FIELDS, c.internal_field, `data-list="columns" data-i="${i}" data-k="internal_field"`)}
        <input type="text" list="mi-dl-headers" autocomplete="off" data-list="columns" data-i="${i}" data-k="column_suffix_pattern" value="${esc(c.column_suffix_pattern)}">
        <button type="button" class="mi-x" data-act="del-col" data-i="${i}" title="${esc(t('mi_ed_remove'))}">×</button>
      </div>`).join('')}
    <button type="button" class="btn btn-secondary btn-sm" data-act="add-col">+ ${esc(t('mi_ed_add_column'))}</button>`;
}

function renderEditor() {
  const d = S.draft;
  if (!d) return;
  document.querySelectorAll('#mi-editor [data-mi-tab]').forEach(b =>
    b.classList.toggle('active', b.dataset.miTab === S.editorTab));
  const body = {
    general: renderGeneral, rules: renderRules, splits: renderSplits, blocks: renderBlocks, columns: renderColumns,
  }[S.editorTab](d);
  $('mi-editor-body').innerHTML = dataLists() + body;
}

function onEditorInput(e) {
  const el = e.target;
  const k = el.dataset.k;
  if (!k || !S.draft) return;
  let val = el.value;
  if (el.type === 'number') val = val === '' ? '' : Number(val);

  if (!el.dataset.list) { S.draft[k] = val; return; }
  const item = S.draft[el.dataset.list][Number(el.dataset.i)];
  if (!item) return;
  if (el.dataset.ci !== undefined) {
    const c = item.conditions[Number(el.dataset.ci)];
    if (k === 'value') c.value = c.op === 'in' ? String(val).split(',').map(s => s.trim()).filter(Boolean) : val;
    else {
      c[k] = val;
      if (k === 'op') {
        if (val === 'in' && !Array.isArray(c.value)) c.value = String(c.value ?? '').split(',').map(s => s.trim()).filter(Boolean);
        if (val !== 'in' && Array.isArray(c.value)) c.value = c.value.join(', ');
      }
    }
    if (el.dataset.rerender) renderEditor();
  } else if (k === 'module_type_sequence') {
    item[k] = String(val).split(',').map(s => s.trim()).filter(Boolean);
  } else if (k === 'block_sequence') {
    item[k] = expandSequence(val);
  } else {
    item[k] = val;
  }
}

function onEditorClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn || !S.draft) return;
  const d = S.draft;
  const i = Number(btn.dataset.i);
  switch (btn.dataset.act) {
    case 'add-rule': {
      const maxPrio = d.rules.reduce((m, r) => Math.max(m, Number(r.priority) || 0), 0);
      d.rules.push({ id: generateId(), priority: maxPrio + 10, conditions: [], netbox_module_type_id: '', min_bay: 1, max_bay: Number(d.slot_count) || 12 });
      break;
    }
    case 'del-rule': d.rules.splice(i, 1); break;
    case 'add-cond': d.rules[i].conditions.push({ field: 'category', op: 'eq', value: '' }); break;
    case 'del-cond': d.rules[i].conditions.splice(Number(btn.dataset.ci), 1); break;
    case 'add-split': d.splitRules.push({ id: generateId(), category: 'LAN', color: '', total_count: 2, module_type_sequence: [] }); break;
    case 'del-split': d.splitRules.splice(i, 1); break;
    case 'add-block': d.blocks.push({ id: generateId(), count_column: '', prefix_pattern: 'Block {block}', block_sequence: ['A', 'B', 'C'], row_name_column: '' }); break;
    case 'del-block': d.blocks.splice(i, 1); break;
    case 'add-col': d.columns.push({ id: generateId(), internal_field: 'lan_port_name', column_suffix_pattern: '{prefix} ' }); break;
    case 'del-col': d.columns.splice(i, 1); break;
    default: return;
  }
  renderEditor();
}

function saveDraft() {
  const d = S.draft;
  if (!d) return;
  const { errors, warnings } = validateProfile(d, getModuleTypes().map(m => m.name));
  const msg = $('mi-editor-msg');
  if (errors.length) {
    msg.innerHTML = `<div class="message message-error">${errors.map(x => esc(validationText(x))).join('<br>')}</div>`;
    return;
  }
  d.slot_count = Number(d.slot_count);
  d.rules.sort((a, b) => Number(a.priority) - Number(b.priority));
  const idx = S.profiles.findIndex(p => p.id === d.id);
  if (idx >= 0) S.profiles[idx] = clone(d);
  persistProfiles();
  renderProfileSelect();
  msg.innerHTML = warnings.length
    ? `<div class="message message-info">${esc(t('mi_ed_saved'))}<br>${warnings.map(x => esc(validationText(x))).join('<br>')}</div>`
    : `<div class="message message-success">${esc(t('mi_ed_saved'))}</div>`;
  S.draft = clone(S.profiles[idx]);
  renderEditor();
}

// ─── Step 2: preview ─────────────────────────────────────────────────────────

function renderPreview() {
  const a = S.analysis;
  const profile = activeProfile();
  const slots = Number(profile.slot_count) || 12;
  const s = a.summary;
  $('mi-pv-summary').textContent = t('mi_pv_summary', {
    devices: s.devices, bays: s.baysUsed, errors: s.errors, warnings: s.warnings,
  });
  $('mi-pv-summary').classList.toggle('mi-has-errors', s.errors > 0);

  const fileLevel = a.errors.filter(e => e.rowIndex === 0);
  const fl = $('mi-pv-file-issues');
  fl.innerHTML = fileLevel.length
    ? `<div class="message message-error"><strong>${esc(t('mi_pv_file_errors'))}</strong><br>${fileLevel.map(i => esc(issueText(i))).join('<br>')}</div>`
    : '';

  const rowErrors = a.errors.filter(e => e.rowIndex && !e.device);
  const rl = $('mi-pv-row-issues');
  rl.innerHTML = rowErrors.length
    ? `<div class="message message-error">${rowErrors.map(i => esc(issueText(i))).join('<br>')}</div>`
    : '';

  const types = new Set();
  a.devices.forEach(d => d.bays.forEach(b => b && types.add(b.moduleType)));
  $('mi-pv-legend').innerHTML = [...types].map(n =>
    `<span class="mi-chip"><i style="background:${moduleColor(n)}"></i>${esc(n)}</span>`).join('');

  const onlyErrors = $('mi-pv-errors-only').checked;
  const list = a.devices.filter(d => !onlyErrors || d.issues.length);
  $('mi-pv-cards').innerHTML = list.length ? list.map(d => {
    const cells = [];
    for (let n = 1; n <= slots; n++) {
      const b = d.bays[n - 1];
      const hasErr = d.issues.some(i => i.bay === n);
      const title = b ? `${b.moduleType}${b.ports ? '\n' + b.ports.join(', ') : ''}` : '';
      cells.push(`<div class="slot-cell${hasErr ? ' slot-cell--error' : ''}" title="${esc(title)}">
        <span class="slot-no">${n}</span>
        ${b ? `<span class="slot-module" style="background:${moduleColor(b.moduleType)}">${esc(b.moduleType)}${b.ports ? ` <small>(${esc(b.ports.join(', '))})</small>` : ''}</span>`
            : '<span class="slot-module slot-empty"></span>'}
      </div>`);
    }
    return `<div class="mi-card${d.issues.length ? ' mi-card--error' : ''}">
      <div class="mi-card-head"><strong>${esc(d.name)}</strong><small>${esc(t('mi_pv_row', { row: d.rowIndex }))}</small></div>
      ${d.issues.length ? `<ul class="mi-card-issues">${d.issues.map(i => `<li>${esc(issueText({ ...i, rowIndex: 0 }))}</li>`).join('')}</ul>` : ''}
      <div class="slot-preview">${cells.join('')}</div>
    </div>`;
  }).join('') : `<p class="settings-section-desc">${esc(t(a.devices.length ? 'mi_pv_no_errors' : 'mi_pv_none'))}</p>`;

  $('mi-pv-continue').disabled = s.errors > 0 || s.devices === 0;
}

// ─── Step 3: export ──────────────────────────────────────────────────────────

function moduleCsv() {
  return writeCsv(buildModuleImportRows(S.analysis.devices, activeProfile()), MODULE_IMPORT_HEADERS);
}

function renderExport() {
  const rows = buildModuleImportRows(S.analysis.devices, activeProfile()).length;
  $('mi-ex-summary').textContent = t('mi_ex_summary', { rows, devices: S.analysis.devices.length });
}

// ─── Step 4: interface IDs ───────────────────────────────────────────────────

function renderRenameResult() {
  const r = S.rename;
  const box = $('mi-if-result');
  if (!r) { box.innerHTML = ''; $('mi-if-download').disabled = true; $('mi-if-zip').disabled = true; return; }
  const unmatched = r.unmatched.slice(0, 15).map(u => `${esc(u.device)} · ${esc(u.expected)}`).join('<br>');
  box.innerHTML = `
    <div class="message ${r.unmatched.length ? 'message-info' : 'message-success'}">
      ${esc(t('mi_if_result', { matched: r.rows.length, unchanged: r.unchanged, unmatched: r.unmatched.length }))}
      ${r.unmatched.length ? `<br><small>${esc(t('mi_if_unmatched_title'))}</small><br><small>${unmatched}${r.unmatched.length > 15 ? '<br>…' : ''}</small>` : ''}
    </div>`;
  $('mi-if-download').disabled = r.rows.length === 0;
  $('mi-if-zip').disabled = false;
}

function applyInterfaces(interfaces) {
  S.rename = buildInterfaceRename(S.analysis.devices, activeProfile(), interfaces);
  renderRenameResult();
}

function renderInterfaceStep() {
  const expected = expectedInterfaces(S.analysis.devices, activeProfile());
  const none = expected.length === 0;
  $('mi-if-none').hidden = !none;
  $('mi-if-actions').hidden = none;
  renderRenameResult();
}

async function fetchInterfacesFromApi() {
  const { baseUrl, token } = await getApiCredentials();
  if (!baseUrl || !token) { alert(t('netbox_api_missing_creds')); return; }
  const names = [...new Set(expectedInterfaces(S.analysis.devices, activeProfile()).map(e => e.device))];
  const btn = $('mi-if-api-btn');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('netbox_api_fetching');
  try {
    const all = [];
    for (let i = 0; i < names.length; i += 20) {
      const query = names.slice(i, i + 20).map(n => `device=${encodeURIComponent(n)}`).join('&');
      const items = await apiFetchPages(baseUrl, token, 'dcim/interfaces', query);
      for (const it of items) all.push({ id: String(it.id), device: it.device?.name || '', name: it.name });
    }
    applyInterfaces(all);
  } catch (err) {
    alert(err instanceof TypeError ? t('netbox_api_cors_error') : `${t('netbox_api_error')}: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

async function onInterfaceFile(file) {
  if (!file) return;
  const table = parseCsvTable(await readTextFile(file));
  const { interfaces, missing } = readInterfaceTable(table);
  if (missing.length) { alert(t('mi_if_missing_cols', { cols: missing.join(', ') })); return; }
  applyInterfaces(interfaces);
}

function renameCsv() {
  return writeCsv(S.rename.rows, INTERFACE_RENAME_HEADERS);
}

// ─── Init ────────────────────────────────────────────────────────────────────

export function initModuleImport() {
  const dialog = $('module-import-dialog');
  if (!dialog) return;

  $('module-import-btn')?.addEventListener('click', () => {
    S.profiles = loadProfiles();
    if (!S.profiles.some(p => p.id === S.activeId)) S.activeId = S.profiles[0].id;
    renderProfileSelect();
    closeEditor();
    showStep(1);
    dialog.showModal();
  });
  $('mi-close-btn').addEventListener('click', () => closeDialogAnimated(dialog));

  // Profile toolbar
  $('mi-profile').addEventListener('change', e => { S.activeId = e.target.value; if (S.draft) openEditor(); });
  $('mi-profile-new').addEventListener('click', () => {
    const p = createEmptyProfile(t('mi_new_profile_name'));
    const seed = createSeedProfile();
    p.blocks = seed.blocks; p.columns = seed.columns;
    S.profiles.push(p);
    persistProfiles();
    setActive(p.id);
    openEditor();
  });
  $('mi-profile-dup').addEventListener('click', () => {
    const copy = duplicateProfile(activeProfile());
    S.profiles.push(copy);
    persistProfiles();
    setActive(copy.id);
  });
  $('mi-profile-del').addEventListener('click', () => {
    const p = activeProfile();
    if (p.is_default) { alert(t('mi_cannot_delete_default')); return; }
    if (!confirm(t('mi_confirm_delete_profile', { name: p.name }))) return;
    S.profiles = S.profiles.filter(x => x.id !== p.id);
    persistProfiles();
    closeEditor();
    setActive(S.profiles[0].id);
  });
  $('mi-profile-edit').addEventListener('click', openEditor);
  $('mi-profile-export').addEventListener('click', () => {
    const p = activeProfile();
    triggerDownload(exportProfileJson(p), `${slug(p.name)}.profile.json`, 'application/json');
  });
  $('mi-profile-import').addEventListener('click', () => $('mi-profile-file').click());
  $('mi-profile-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const p = importProfileJson(await readTextFile(file));
    if (!p) { alert(t('mi_profile_import_invalid')); return; }
    S.profiles.push(p);
    persistProfiles();
    setActive(p.id);
  });

  // Editor
  document.querySelectorAll('#mi-editor [data-mi-tab]').forEach(b =>
    b.addEventListener('click', () => { S.editorTab = b.dataset.miTab; renderEditor(); }));
  $('mi-editor-body').addEventListener('input', onEditorInput);
  $('mi-editor-body').addEventListener('change', onEditorInput);
  $('mi-editor-body').addEventListener('click', onEditorClick);
  $('mi-editor-save').addEventListener('click', saveDraft);
  $('mi-editor-cancel').addEventListener('click', closeEditor);

  // File + analyse
  $('mi-csv-btn').addEventListener('click', () => $('mi-csv-file').click());
  $('mi-csv-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    await onCsvChosen(file);
  });
  $('mi-analyse-btn').addEventListener('click', runAnalysis);

  // Preview
  $('mi-pv-errors-only').addEventListener('change', renderPreview);
  $('mi-pv-back').addEventListener('click', () => showStep(1));
  $('mi-pv-continue').addEventListener('click', () => { renderExport(); showStep(3); });

  // Export
  $('mi-ex-csv').addEventListener('click', () =>
    triggerDownload(moduleCsv(), 'module-import.csv', 'text/csv'));
  $('mi-ex-zip').addEventListener('click', () =>
    triggerDownload(createZip([{ name: 'module-import.csv', data: moduleCsv() }]), 'module-import.zip', 'application/zip'));
  $('mi-ex-back').addEventListener('click', () => showStep(2));
  $('mi-ex-next').addEventListener('click', () => { renderInterfaceStep(); showStep(4); });

  // Interfaces
  $('mi-if-api-btn').addEventListener('click', fetchInterfacesFromApi);
  $('mi-if-file-btn').addEventListener('click', () => $('mi-if-file').click());
  $('mi-if-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    await onInterfaceFile(file);
  });
  $('mi-if-download').addEventListener('click', () =>
    triggerDownload(renameCsv(), 'interface-rename.csv', 'text/csv'));
  $('mi-if-zip').addEventListener('click', () => {
    const files = [{ name: 'module-import.csv', data: moduleCsv() }];
    if (S.rename && S.rename.rows.length) files.push({ name: 'interface-rename.csv', data: renameCsv() });
    triggerDownload(createZip(files), 'module-import-bundle.zip', 'application/zip');
  });
  $('mi-if-back').addEventListener('click', () => showStep(3));
}
