// NetBox JSON export + YAML + CSV + Project save/load + download/clipboard

import { getState, dispatch, getActiveRackConfig, getActiveDevices } from './state.js';
import { toNetBoxJSON, getRackUtilization } from './rack-model.js';
import { t, getCurrentLang } from './i18n.js';
import { triggerDownload, uiAlert } from './utils.js';
import { APP_VERSION, APP_CODENAME } from './version.js';

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
        uiAlert(t('msg_import_success', { placed, total: pendingImportDevices.length }));
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
  if (!devices || devices.length === 0) { uiAlert(t('msg_import_invalid')); return; }

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
  if (!data.length) { uiAlert(t('msg_no_export')); return; }
  triggerDownload(
    JSON.stringify(data, null, 2),
    `${getRackName()}_netbox_import.json`,
    'application/json'
  );
}

// ─── YAML ───────────────────────────────────────────────────────────────────

function downloadYAML() {
  const data = getExportData();
  if (!data.length) { uiAlert(t('msg_no_export')); return; }
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
  if (!data.length) { uiAlert(t('msg_no_export')); return; }
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
  if (!data.length) { uiAlert(t('msg_no_export')); return; }

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
  if (!state.devices.length) { uiAlert(t('msg_no_export')); return; }

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
    _version: APP_VERSION,
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
        uiAlert(t('msg_import_success', { placed, total: placed }));
      } else {
        uiAlert(t('msg_import_invalid'));
      }
    } catch (err) {
      uiAlert('Failed to parse project file: ' + err.message);
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
      if (data._format === 'rackbuilder-project') { uiAlert(t('msg_use_load_project')); return; }
      if (!Array.isArray(data)) { uiAlert(t('msg_import_invalid')); return; }
      showImportPreview(parseNetBoxDevices(data));
    } catch (err) {
      uiAlert('Failed to parse JSON file: ' + err.message);
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
      if (!devices || devices.length === 0) { uiAlert(t('msg_import_invalid')); return; }
      showImportPreview(devices);
    } catch (err) {
      uiAlert('Failed to parse CSV file: ' + err.message);
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

  // Theme colours come straight from the app's CSS tokens so the image matches what is on screen
  const probe = document.createElement('canvas').getContext('2d');
  const cs = getComputedStyle(document.documentElement);
  const tok = (name, fb) => {
    const v = cs.getPropertyValue(name).trim() || fb;
    probe.fillStyle = '#000';
    probe.fillStyle = v;
    return probe.fillStyle;
  };
  const rgb = (c) => {
    if (c[0] === '#') return [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    const m = c.match(/[\d.]+/g) || [0, 0, 0];
    return [+m[0], +m[1], +m[2]];
  };
  const mix = (a, b, p) => {
    const x = rgb(a), y = rgb(b);
    return `rgb(${x.map((v, i) => Math.round(v * p + y[i] * (1 - p))).join(',')})`;
  };
  const C = {
    bg:     tok('--bg-primary', '#0c0f14'),
    panel:  tok('--bg-secondary', '#121720'),
    rack:   tok('--bg-rack', '#090b0f'),
    cell:   tok('--bg-rack-cell', '#12171e'),
    line:   tok('--rack-line', '#2b3443'),
    border: tok('--color-border', '#2b3443'),
    text:   tok('--color-text', '#e8edf5'),
    muted:  tok('--color-text-muted', '#8b97a8'),
    accent: tok('--color-accent', '#5eead4'),
    front:  tok('--color-front', '#5b9cff'),
    rear:   tok('--color-rear', '#ffab4a'),
    hatch:  tok('--hatch', '#2a3342'),
  };
  const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
  const MONO = 'ui-monospace, "JetBrains Mono", Consolas, monospace';

  const UH = totalUnits > 48 ? 20 : 26;
  const NUM_W = 34;
  const FACE_W = 270;
  const RAIL = 10;
  const PAD = 32;
  const GAP = 28;
  const HEAD_H = 76;
  const PANEL_HEAD = 40;
  const FOOT_H = 44;
  const PANEL_W = RAIL + NUM_W + FACE_W + RAIL;
  const W = PAD * 2 + PANEL_W * 2 + GAP;
  const H = PAD + HEAD_H + PANEL_HEAD + RAIL * 2 + totalUnits * UH + FOOT_H + PAD / 2;
  const DPR = Math.max(2, window.devicePixelRatio || 1);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  ctx.textBaseline = 'middle';

  const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
  const fit = (str, maxW) => {
    if (ctx.measureText(str).width <= maxW) return str;
    let s = str;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  };

  // Background
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Header: rack name, meta line, utilisation chips
  const util = getRackUtilization(devices, totalUnits);
  ctx.textAlign = 'left';
  ctx.fillStyle = C.text;
  ctx.font = `700 24px ${FONT}`;
  ctx.fillText(fit(cfg.name || 'Rack', W - PAD * 2 - 220), PAD, PAD + 16);
  const meta = [cfg.site, cfg.location].filter(Boolean).join(' · ');
  const dirTxt = numberingDirection === 'bottom-to-top' ? t('dir_bottom') : t('dir_top');
  ctx.fillStyle = C.muted;
  ctx.font = `13px ${FONT}`;
  ctx.fillText([meta, `${totalUnits} U`, dirTxt, `${devices.length} ${t('png_devices')}`].filter(Boolean).join('  ·  '), PAD, PAD + 44);

  // Accent rule under the header
  const grad = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  grad.addColorStop(0, C.accent);
  grad.addColorStop(1, mix(C.accent, C.bg, 0.0));
  ctx.fillStyle = C.border;
  ctx.fillRect(PAD, PAD + HEAD_H - 14, W - PAD * 2, 1);
  ctx.fillStyle = grad;
  ctx.fillRect(PAD, PAD + HEAD_H - 14, 64, 2);

  const unitOrder = [];
  if (numberingDirection === 'bottom-to-top') for (let u = totalUnits; u >= 1; u--) unitOrder.push(u);
  else for (let u = 1; u <= totalUnits; u++) unitOrder.push(u);

  const panelTop = PAD + HEAD_H;
  const bodyY = panelTop + PANEL_HEAD + RAIL;

  for (const face of ['front', 'rear']) {
    const px = PAD + (face === 'front' ? 0 : PANEL_W + GAP);
    const faceCol = face === 'front' ? C.front : C.rear;
    const faceDevs = devices.filter(d => d.face === face);
    const usedU = util[face === 'front' ? 'front' : 'rear'];

    // Panel card
    rr(px, panelTop, PANEL_W, PANEL_HEAD + RAIL * 2 + totalUnits * UH, 14);
    ctx.fillStyle = C.panel;
    ctx.fill();
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Panel header: dot + label + used units
    ctx.fillStyle = faceCol;
    ctx.beginPath();
    ctx.arc(px + RAIL + 8, panelTop + PANEL_HEAD / 2 + 1, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.text;
    ctx.font = `600 14px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(t(face === 'front' ? 'png_front' : 'png_rear'), px + RAIL + 22, panelTop + PANEL_HEAD / 2 + 1);
    ctx.fillStyle = C.muted;
    ctx.font = `11px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${usedU ?? 0} / ${totalUnits} U`, px + PANEL_W - RAIL - 4, panelTop + PANEL_HEAD / 2 + 1);

    // Rack frame
    const fx = px + RAIL;
    const fw = NUM_W + FACE_W;
    rr(fx, bodyY - 4, fw, totalUnits * UH + 8, 8);
    ctx.fillStyle = C.rack;
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.stroke();

    const cx = fx + NUM_W;
    for (let i = 0; i < unitOrder.length; i++) {
      const u = unitOrder[i];
      const y = bodyY + i * UH;
      ctx.fillStyle = (i % 2 === 0) ? C.cell : mix(C.cell, C.rack, 0.55);
      ctx.fillRect(cx, y, FACE_W - 4, UH);
      ctx.fillStyle = C.line;
      ctx.fillRect(cx, y + UH - 1, FACE_W - 4, 1);
      ctx.fillStyle = C.muted;
      ctx.font = `10px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText(String(u), fx + NUM_W / 2 - 1, y + UH / 2 + 1);
    }

    // Units blocked by a full-depth device on the other face: hatch
    const other = devices.filter(d => d.face !== face && d.fullDepth);
    ctx.save();
    for (const d of other) {
      const topIdx = unitOrder.indexOf(d.position + d.height - 1);
      const botIdx = unitOrder.indexOf(d.position);
      if (topIdx === -1 || botIdx === -1) continue;
      const y = bodyY + Math.min(topIdx, botIdx) * UH;
      const h = d.height * UH;
      ctx.save();
      ctx.beginPath(); ctx.rect(cx, y, FACE_W - 4, h); ctx.clip();
      ctx.strokeStyle = C.hatch;
      ctx.lineWidth = 3;
      for (let k = -h; k < FACE_W; k += 10) {
        ctx.beginPath(); ctx.moveTo(cx + k, y + h); ctx.lineTo(cx + k + h, y); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();

    // Devices
    for (const d of faceDevs) {
      const topIdx = unitOrder.indexOf(d.position + d.height - 1);
      const botIdx = unitOrder.indexOf(d.position);
      if (topIdx === -1 || botIdx === -1) continue;
      const y = bodyY + Math.min(topIdx, botIdx) * UH + 2;
      const h = d.height * UH - 4;
      const color = d._color || faceCol;
      const col = (() => { probe.fillStyle = '#000'; probe.fillStyle = color; return probe.fillStyle; })();
      const x0 = cx + 2, w0 = FACE_W - 8;

      rr(x0, y, w0, h, 6);
      ctx.fillStyle = mix(col, C.cell, 0.30);
      ctx.fill();
      ctx.strokeStyle = mix(col, C.cell, 0.75);
      ctx.lineWidth = 1;
      ctx.stroke();
      // left colour stripe
      ctx.save();
      rr(x0, y, w0, h, 6); ctx.clip();
      ctx.fillStyle = col;
      ctx.fillRect(x0, y, 5, h);
      ctx.restore();

      ctx.save();
      rr(x0, y, w0, h, 6); ctx.clip();
      const tx = x0 + 14;
      const maxW = w0 - 26;
      ctx.textAlign = 'left';
      ctx.fillStyle = C.text;
      const big = h >= UH * 1.5;
      ctx.font = `600 ${h < 20 ? 11 : 12.5}px ${FONT}`;
      const sub = (d.deviceType || d.role || '').toString();
      if (big && sub) {
        ctx.fillText(fit(d.name || t('png_unnamed'), maxW), tx, y + h / 2 - 8);
        ctx.fillStyle = C.muted;
        ctx.font = `11px ${FONT}`;
        ctx.fillText(fit(sub, maxW), tx, y + h / 2 + 9);
      } else {
        const nm = d.name || t('png_unnamed');
        ctx.fillText(fit(nm, sub && h >= 20 ? maxW * 0.62 : maxW), tx, y + h / 2 + 0.5);
        if (sub && h >= 20) {
          ctx.fillStyle = C.muted;
          ctx.font = `11px ${FONT}`;
          ctx.textAlign = 'right';
          ctx.fillText(fit(sub, maxW * 0.36), x0 + w0 - 10, y + h / 2 + 0.5);
        }
      }
      ctx.restore();
    }
  }

  // Footer
  const fy = H - FOOT_H / 2 - PAD / 4;
  ctx.textAlign = 'left';
  ctx.fillStyle = C.muted;
  ctx.font = `11px ${MONO}`;
  ctx.fillText(`Rack Builder v${APP_VERSION} · ${APP_CODENAME}`, PAD, fy);
  ctx.textAlign = 'right';
  ctx.fillText(new Date().toLocaleDateString(getCurrentLang() === 'de' ? 'de-DE' : 'en-GB'), W - PAD, fy);
  if (devices.some(d => d.fullDepth)) {
    ctx.textAlign = 'center';
    ctx.fillText(t('leg_blocked'), W / 2, fy);
  }

  canvas.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${getRackName()}_rack.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}
