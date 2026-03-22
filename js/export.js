// NetBox JSON export + YAML + CSV + Project save/load + download/clipboard

import { getState, dispatch, getActiveRackConfig, getActiveDevices } from './state.js';
import { toNetBoxJSON } from './rack-model.js';
import { t } from './i18n.js';

export function initExport() {
  document.getElementById('export-json-btn').addEventListener('click', downloadJSON);
  document.getElementById('export-yaml-btn').addEventListener('click', downloadYAML);
  document.getElementById('export-csv-btn').addEventListener('click', downloadCSV);
  document.getElementById('copy-btn').addEventListener('click', copyToClipboard);
  document.getElementById('export-png-btn').addEventListener('click', downloadPNG);
  document.getElementById('print-btn').addEventListener('click', () => window.print());
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', importJSON);

  // CSV import
  document.getElementById('import-csv-btn').addEventListener('click', () => {
    document.getElementById('import-csv-file').click();
  });
  document.getElementById('import-csv-file').addEventListener('change', importCSV);

  // Import preview dialog buttons
  document.getElementById('import-preview-cancel').addEventListener('click', () => {
    document.getElementById('import-preview-dialog').close();
    pendingImportDevices = null;
  });
  document.getElementById('import-preview-confirm').addEventListener('click', () => {
    document.getElementById('import-preview-dialog').close();
    if (pendingImportDevices) {
      const result = dispatch('BULK_ADD_DEVICES', { devices: pendingImportDevices });
      if (result.ok) {
        const placed = result.results.filter(r => r.ok).length;
        alert(t('msg_import_success', { placed, total: pendingImportDevices.length }));
      }
      pendingImportDevices = null;
    }
  });

  // Project save/load
  document.getElementById('save-project-btn').addEventListener('click', saveProject);
  document.getElementById('load-project-btn').addEventListener('click', () => {
    document.getElementById('load-project-file').click();
  });
  document.getElementById('load-project-file').addEventListener('change', loadProject);
}

// ─── Import preview ──────────────────────────────────────────────────────────

let pendingImportDevices = null;

function showImportPreview(devices) {
  if (!devices || devices.length === 0) { alert(t('msg_import_invalid')); return; }

  const state = getState();
  const existing = getActiveDevices(state);

  // Check for position conflicts
  const conflicts = [];
  for (const d of devices) {
    const pos = parseInt(d.position) || 1;
    const h = parseInt(d.height) || 1;
    const face = d.face || 'front';
    const clash = existing.find(ex =>
      ex.face === face && pos < ex.position + ex.height && pos + h > ex.position
    );
    if (clash) conflicts.push({ d, clash });
  }

  const dialog = document.getElementById('import-preview-dialog');
  document.getElementById('import-preview-summary').textContent =
    t('import_preview_summary', { count: devices.length });

  const conflictsWrap = document.getElementById('import-preview-conflicts-wrap');
  if (conflicts.length > 0) {
    conflictsWrap.style.display = '';
    document.getElementById('import-preview-conflicts-label').textContent =
      t('import_preview_conflicts', { count: conflicts.length });
    document.getElementById('import-preview-conflict-list').innerHTML =
      conflicts.map(({ d, clash }) =>
        `<li>U${d.position} ${d.face}: <strong>${d.name || '(unnamed)'}</strong> ↔ ${clash.name || '(unnamed)'}</li>`
      ).join('');
    document.getElementById('import-preview-confirm').textContent = t('import_preview_confirm');
  } else {
    conflictsWrap.style.display = 'none';
    document.getElementById('import-preview-confirm').textContent = t('import_preview_ok');
  }

  pendingImportDevices = devices;
  dialog.showModal();
}

function getExportData() {
  const state = getState();
  if (state.multiRackEnabled && state.racks.length > 0) {
    const allData = [];
    for (const rack of state.racks) {
      const devs = state.devices.filter(d => d.rackId === rack.id);
      allData.push(...toNetBoxJSON(devs, rack));
    }
    return allData;
  }
  return toNetBoxJSON(state.devices, state.rackConfig);
}

function getRackName() {
  const state = getState();
  if (state.multiRackEnabled && state.racks.length > 0) {
    return state.rackConfig.site || state.racks[0].name || 'multi-rack';
  }
  return state.rackConfig.name;
}

// ─── NetBox JSON ────────────────────────────────────────────────────────────

function downloadJSON() {
  const data = getExportData();
  if (!data.length) { alert(t('msg_no_export')); return; }
  triggerDownload(
    JSON.stringify(data, null, 2),
    `${getRackName()}_netbox_import.json`,
    'application/json'
  );
}

// ─── YAML ───────────────────────────────────────────────────────────────────

function downloadYAML() {
  const data = getExportData();
  if (!data.length) { alert(t('msg_no_export')); return; }
  triggerDownload(
    toYAML(data),
    `${getRackName()}_netbox_import.yaml`,
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
    `${getRackName()}_netbox_import.csv`,
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

// ─── Project Save/Load (internal format, preserves height + color + config) ─

function saveProject() {
  const state = getState();
  if (!state.devices.length) { alert(t('msg_no_export')); return; }

  const mapDevice = d => ({
    name: d.name,
    manufacturer: d.manufacturer,
    deviceType: d.deviceType,
    role: d.role,
    position: d.position,
    height: d.height,
    face: d.face,
    status: d.status,
    serial: d.serial,
    assetTag: d.assetTag,
    fullDepth: d.fullDepth,
    comments: d.comments,
    _color: d._color,
    ...(d.rackId ? { rackId: d.rackId } : {}),
  });

  const project = {
    _format: 'rackbuilder-project',
    _version: '0.7.0',
    rackConfig: state.rackConfig,
    multiRackEnabled: state.multiRackEnabled,
    racks: state.racks,
    activeRackId: state.activeRackId,
    devices: state.devices.map(mapDevice),
  };

  triggerDownload(
    JSON.stringify(project, null, 2),
    `${getRackName()}_project.json`,
    'application/json'
  );
}

function loadProject(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);

      if (data._format === 'rackbuilder-project') {
        // Internal project format — load full state
        dispatch('LOAD_STATE', {
          rackConfig: data.rackConfig || {},
          devices: data.devices || [],
          multiRackEnabled: data.multiRackEnabled || false,
          racks: data.racks || [],
          activeRackId: data.activeRackId || null,
        });
        const placed = (data.devices || []).length;
        alert(t('msg_import_success', { placed, total: placed }));
      } else {
        alert(t('msg_import_invalid'));
      }
    } catch (err) {
      alert('Failed to parse project file: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ─── NetBox Import ──────────────────────────────────────────────────────────

function parseNetBoxDevices(data) {
  return data.map(d => ({
    name: d.name || '',
    manufacturer: d.manufacturer || '',
    deviceType: d.device_type || '',
    role: d.role || '',
    position: d.position || 1,
    height: d.u_height || d.height || 1,
    face: d.face || 'front',
    status: d.status || 'planned',
    serial: d.serial || '',
    assetTag: d.asset_tag || '',
    fullDepth: d.full_depth || false,
    comments: d.comments || '',
    _color: (d.face === 'rear') ? '#f97316' : '#3b82f6',
  }));
}

function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (data._format === 'rackbuilder-project') { alert(t('msg_use_load_project')); return; }
      if (!Array.isArray(data)) { alert(t('msg_import_invalid')); return; }
      showImportPreview(parseNetBoxDevices(data));
    } catch (err) {
      alert('Failed to parse JSON file: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function importCSV(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const devices = parseImportCSV(event.target.result);
      if (!devices || devices.length === 0) { alert(t('msg_import_invalid')); return; }
      showImportPreview(devices);
    } catch (err) {
      alert('Failed to parse CSV file: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function parseImportCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';

  function splitCSVLine(line) {
    const fields = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === sep && !inQuotes) {
        fields.push(cur.trim()); cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    return fields;
  }

  const headers = splitCSVLine(lines[0]).map(h => h.toLowerCase().replace(/^["']|["']$/g, ''));
  const devices = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = splitCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] ?? ''; });
    const face = row.face === 'rear' ? 'rear' : 'front';
    devices.push({
      name: row.name || '',
      manufacturer: row.manufacturer || '',
      deviceType: row.device_type || row.devicetype || '',
      role: row.role || '',
      position: parseInt(row.position) || 1,
      height: parseInt(row.height || row.u_height) || 1,
      face,
      status: row.status || 'planned',
      serial: row.serial || '',
      assetTag: row.asset_tag || row.assettag || '',
      fullDepth: row.full_depth === 'true' || row.full_depth === '1',
      comments: row.comments || '',
      _color: face === 'rear' ? '#f97316' : '#3b82f6',
    });
  }
  return devices.length > 0 ? devices : null;
}

// ─── PNG Export ─────────────────────────────────────────────────────────────

function downloadPNG() {
  const state = getState();
  const cfg = getActiveRackConfig(state);
  const devices = getActiveDevices(state);
  const { totalUnits, numberingDirection } = cfg;

  const UH = 28;
  const FACE_W = 220;
  const LABEL_W = 36;
  const HEADER_H = 22;
  const TITLE_H = 32;
  const PAD = 12;
  const DPR = window.devicePixelRatio || 1;

  const W = PAD * 2 + FACE_W * 2 + LABEL_W;
  const H = TITLE_H + HEADER_H + totalUnits * UH + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);

  const isDark = document.documentElement.dataset.theme === 'dark';
  const bg      = isDark ? '#0f172a' : '#f8fafc';
  const bgCell  = isDark ? '#1e293b' : '#f1f5f9';
  const bgHead  = isDark ? '#1e293b' : '#e2e8f0';
  const border  = isDark ? '#334155' : '#cbd5e1';
  const txtMut  = isDark ? '#64748b' : '#94a3b8';
  const txtMain = isDark ? '#e2e8f0' : '#1e293b';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Title
  ctx.fillStyle = txtMain;
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(cfg.name, PAD, TITLE_H - 8);

  const unitOrder = [];
  if (numberingDirection === 'bottom-to-top') {
    for (let u = totalUnits; u >= 1; u--) unitOrder.push(u);
  } else {
    for (let u = 1; u <= totalUnits; u++) unitOrder.push(u);
  }

  const frontX = PAD;
  const labelX = PAD + FACE_W;
  const rearX  = PAD + FACE_W + LABEL_W;
  const bodyY  = TITLE_H + HEADER_H;

  // Column headers
  ctx.fillStyle = bgHead;
  ctx.fillRect(frontX, TITLE_H, FACE_W, HEADER_H);
  ctx.fillRect(rearX,  TITLE_H, FACE_W, HEADER_H);
  ctx.fillStyle = txtMain;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Front', frontX + FACE_W / 2, TITLE_H + 15);
  ctx.fillText('Rear',  rearX  + FACE_W / 2, TITLE_H + 15);

  // Cells and unit labels
  for (let i = 0; i < unitOrder.length; i++) {
    const u = unitOrder[i];
    const y = bodyY + i * UH;
    const stripe = i % 2 === 0;
    const cellBg = stripe ? bgCell : bg;

    ctx.fillStyle = cellBg;
    ctx.fillRect(frontX, y, FACE_W, UH);
    ctx.fillRect(rearX,  y, FACE_W, UH);

    ctx.strokeStyle = border;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(frontX, y, FACE_W, UH);
    ctx.strokeRect(rearX,  y, FACE_W, UH);

    ctx.fillStyle = txtMut;
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(u), labelX + LABEL_W / 2, y + UH / 2 + 3);
  }

  // Devices
  for (const face of ['front', 'rear']) {
    const faceX = face === 'front' ? frontX : rearX;
    for (const device of devices.filter(d => d.face === face)) {
      const topIdx = unitOrder.indexOf(device.position + device.height - 1);
      if (topIdx === -1) continue;
      const y = bodyY + topIdx * UH;
      const h = device.height * UH - 1;
      const color = device._color || (face === 'front' ? '#3b82f6' : '#f97316');

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(faceX + 1, y + 1, FACE_W - 2, h - 1, 3);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.font = `${h < 20 ? 9 : 11}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.save();
      ctx.beginPath();
      ctx.rect(faceX + 1, y + 1, FACE_W - 2, h - 1);
      ctx.clip();
      ctx.fillText(device.name || '(unnamed)', faceX + FACE_W / 2, y + Math.min(h / 2 + 4, h - 3));
      ctx.restore();
    }
  }

  canvas.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${getRackName()}_rack.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
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
