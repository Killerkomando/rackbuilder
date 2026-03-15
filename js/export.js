// NetBox JSON export + YAML + CSV + download/clipboard

import { getState, dispatch } from './state.js';
import { toNetBoxJSON } from './rack-model.js';
import { t } from './i18n.js';

export function initExport() {
  document.getElementById('export-json-btn').addEventListener('click', downloadJSON);
  document.getElementById('export-yaml-btn').addEventListener('click', downloadYAML);
  document.getElementById('export-csv-btn').addEventListener('click', downloadCSV);
  document.getElementById('copy-btn').addEventListener('click', copyToClipboard);
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', importJSON);
}

function getExportData() {
  const state = getState();
  return toNetBoxJSON(state.devices, state.rackConfig);
}

function getRackName() {
  return getState().rackConfig.name;
}

// ─── JSON ───────────────────────────────────────────────────────────────────

function downloadJSON() {
  const data = getExportData();
  if (!data.length) { alert(t('msg_no_export')); return; }
  triggerDownload(
    JSON.stringify(data, null, 2),
    `${getRackName()}_import.json`,
    'application/json'
  );
}

// ─── YAML ───────────────────────────────────────────────────────────────────

function downloadYAML() {
  const data = getExportData();
  if (!data.length) { alert(t('msg_no_export')); return; }
  triggerDownload(
    toYAML(data),
    `${getRackName()}_import.yaml`,
    'text/yaml'
  );
}

function toYAML(items) {
  return items.map(item => {
    const entries = Object.entries(item);
    return entries.map(([k, v], i) => {
      const prefix = i === 0 ? '- ' : '  ';
      return `${prefix}${k}: ${yamlValue(v)}`;
    }).join('\n');
  }).join('\n');
}

function yamlValue(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  // Quote if needed: contains special chars, starts with digit, reserved words
  if (
    s === '' ||
    s === 'true' || s === 'false' || s === 'null' ||
    /^[\d]/.test(s) ||
    /[:\[\]{},#&*!|>'"%@`\n\r]/.test(s) ||
    /^\s|\s$/.test(s)
  ) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

// ─── CSV ────────────────────────────────────────────────────────────────────

function downloadCSV() {
  const data = getExportData();
  if (!data.length) { alert(t('msg_no_export')); return; }
  triggerDownload(
    toCSV(data),
    `${getRackName()}_import.csv`,
    'text/csv'
  );
}

function toCSV(items) {
  const headers = Object.keys(items[0]);
  const escape = v => {
    const s = String(v ?? '');
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [
    headers.join(','),
    ...items.map(item => headers.map(h => escape(item[h])).join(',')),
  ].join('\n');
}

// ─── Copy ───────────────────────────────────────────────────────────────────

async function copyToClipboard() {
  const data = getExportData();
  if (!data.length) { alert(t('msg_no_export')); return; }

  const json = JSON.stringify(data, null, 2);
  try {
    await navigator.clipboard.writeText(json);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = json;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  const btn = document.getElementById('copy-btn');
  const original = btn.textContent;
  btn.textContent = t('msg_copied');
  setTimeout(() => { btn.textContent = original; }, 2000);
}

// ─── Import ─────────────────────────────────────────────────────────────────

function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (!Array.isArray(data)) {
        alert(t('msg_import_invalid'));
        return;
      }

      const devices = data.map(d => ({
        name: d.name || '',
        deviceType: d.device_type || '',
        role: d.role || '',
        position: d.position || 1,
        height: 1,
        face: d.face || 'front',
        status: d.status || 'planned',
        serial: d.serial || '',
        assetTag: d.asset_tag || '',
        comments: d.comments || '',
        _color: d.face === 'rear' ? '#f97316' : '#3b82f6',
      }));

      const result = dispatch('BULK_ADD_DEVICES', { devices });
      if (result.ok) {
        const placed = result.results.filter(r => r.ok).length;
        alert(t('msg_import_success', { placed, total: devices.length }));
      }
    } catch (err) {
      alert('Failed to parse JSON file: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
