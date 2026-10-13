// Rack visualization renderer

import { getState, dispatch, getReservedUnits, setReservedUnits, getActiveRackConfig, getActiveDevices } from './state.js';
import { t } from './i18n.js';
import { getRackUtilization } from './rack-model.js';

// Cached unit height — recalculated on each render
let currentUnitHeight = 28;

// Which face(s) the rack view shows: 'front' | 'rear' | 'both' (remembered per browser)
const FACE_VIEW_KEY = 'rackbuilder_face_view';
let faceView = 'both';
try {
  const savedView = localStorage.getItem(FACE_VIEW_KEY);
  if (savedView === 'front' || savedView === 'rear') faceView = savedView;
} catch { /* storage unavailable */ }

export function getFaceView() { return faceView; }
export function setFaceView(view) {
  faceView = (view === 'front' || view === 'rear') ? view : 'both';
  try { localStorage.setItem(FACE_VIEW_KEY, faceView); } catch { /* ignore */ }
}

// Search filter term — set externally, applied in renderDeviceBlocks
let searchFilter = '';
export function setSearchFilter(term) { searchFilter = term; }

/**
 * Calculate the optimal unit height to fit the rack on screen.
 */
let printMode = false;
export function setPrintMode(on) { printMode = !!on; }

function calcUnitHeight(totalUnits) {
  // A4 portrait: ~1047px usable height minus title/heading; every face gets its own page
  if (printMode) return Math.max(10, Math.min(26, Math.floor(950 / totalUnits)));
  // header + status bar + rack controls/column headers + padding
  const header = document.querySelector('.app-header')?.offsetHeight ?? 64;
  const status = document.querySelector('.app-status')?.offsetHeight ?? 40;
  const overhead = header + status + 215;
  const available = window.innerHeight - overhead;
  const ideal = Math.floor(available / totalUnits);
  return Math.max(14, Math.min(28, ideal));
}

/**
 * Get the current unit height (used by drag-drop.js).
 */
export function getUnitHeight() {
  return currentUnitHeight;
}

/**
 * Render the rack visualization into the #rack-view element.
 */
export function renderRack(state) {
  const container = document.getElementById('rack-view');
  const rackConfig = getActiveRackConfig(state);
  const devices = getActiveDevices(state);
  const { selectedDeviceId } = state;
  const { totalUnits, numberingDirection } = rackConfig;

  // Dynamic unit height
  currentUnitHeight = calcUnitHeight(totalUnits);
  container.style.setProperty('--unit-height', `${currentUnitHeight}px`);

  // Header info + toolbar stats
  document.getElementById('rack-name-display').textContent = rackConfig.name;
  const dirLabel = t(numberingDirection === 'bottom-to-top' ? 'dir_bottom' : 'dir_top');
  const infoEl = document.getElementById('rack-info');
  if (infoEl) infoEl.textContent = `${rackConfig.name} · ${totalUnits} U · ${dirLabel}`;
  const util = getRackUtilization(devices, totalUnits);
  const statFront = document.getElementById('stat-front');
  const statRear = document.getElementById('stat-rear');
  if (statFront) statFront.textContent = `${util.frontPercent} %`;
  if (statRear) statRear.textContent = `${util.rearPercent} %`;
  document.querySelectorAll('#face-view button').forEach(b => b.classList.toggle('on', b.dataset.view === faceView));
  container.dataset.view = faceView;
  const emptyEl = document.getElementById('rack-empty');
  if (emptyEl) emptyEl.hidden = devices.length > 0;

  // Build unit order (visual top to bottom)
  const unitOrder = [];
  if (numberingDirection === 'bottom-to-top') {
    for (let u = totalUnits; u >= 1; u--) unitOrder.push(u);
  } else {
    for (let u = 1; u <= totalUnits; u++) unitOrder.push(u);
  }

  // Build HTML: one rack panel per visible face
  let html = '';
  const reserved = getReservedUnits();
  const faces = faceView === 'both' ? ['front', 'rear'] : [faceView];

  for (const face of faces) {
    const used = face === 'front' ? util.front : util.rear;
    html += `<div class="rack-unit" data-face-wrap="${face}">`;
    html += `<div class="rack-unit-rackname">${String(rackConfig.name).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`;
    html += `<div class="rack-unit-head"><span class="rack-unit-title"><i class="face-dot face-dot--${face}"></i>${t(face === 'front' ? 'col_front' : 'col_rear')}</span>`;
    html += `<span class="rack-unit-meta">${t('face_used', { n: used, total: totalUnits })}</span></div>`;
    html += '<div class="rack-body">';
    html += `<div class="rack-unit-numbers">${renderUnitNumbers(devices, face, unitOrder)}</div>`;
    html += `<div class="rack-face" id="rack-face-${face}" data-face="${face}">`;
    for (const u of unitOrder) {
      html += `<div class="rack-cell" data-unit="${u}" data-face="${face}" data-hint="${t('cell_pick', { n: u })}"></div>`;
    }
    html += renderDepthBlockades(devices, face, unitOrder);
    html += renderReservedOverlays(face, unitOrder, reserved);
    html += renderDeviceBlocks(devices, face, unitOrder, selectedDeviceId);
    html += '</div></div></div>';
  }

  container.innerHTML = html;

  // Add click handlers for device blocks
  container.querySelectorAll('.device-block').forEach(block => {
    block.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = block.dataset.deviceId;
      dispatch('SELECT_DEVICE', id === selectedDeviceId ? null : id);
    });
  });

  // Click on empty cell: reserve unit or deselect
  container.querySelectorAll('.rack-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      if (selectedDeviceId) {
        dispatch('SELECT_DEVICE', null);
        return;
      }
      const unit = parseInt(cell.dataset.unit);
      const face = cell.dataset.face;
      const current = getReservedUnits();
      const already = current.find(r => r.unit === unit && r.face === face);
      if (already) {
        // Deselect this unit
        setReservedUnits(current.filter(r => !(r.unit === unit && r.face === face)));
      } else {
        // In single-add mode, replace; in bulk mode, add
        const bulkOpen = document.getElementById('bulk-content')?.classList.contains('open');
        if (bulkOpen) {
          setReservedUnits([...current, { unit, face }]);
        } else {
          setReservedUnits([{ unit, face }]);
        }
      }
    });
  });
}

/**
 * Visual row index of the first (top) row a device occupies.
 */
function topIndexOf(unitOrder, position, height) {
  const a = unitOrder.indexOf(position);
  const b = unitOrder.indexOf(position + height - 1);
  return Math.min(a, b);
}

/**
 * Unit labels for one face. Multi-unit devices get one merged label ("20–21").
 */
function renderUnitNumbers(devices, face, unitOrder) {
  const uh = currentUnitHeight;
  const starts = new Map();
  for (const d of devices) {
    if (d.face === face && d.height > 1) starts.set(topIndexOf(unitOrder, d.position, d.height), d);
  }
  let html = '';
  for (let i = 0; i < unitOrder.length; i++) {
    const d = starts.get(i);
    if (d) {
      html += `<div class="rack-unit-number rack-unit-number--span" style="height: ${d.height * uh}px">${d.position}–${d.position + d.height - 1}</div>`;
      i += d.height - 1;
    } else {
      html += `<div class="rack-unit-number">${unitOrder[i]}</div>`;
    }
  }
  return html;
}

function renderDeviceBlocks(devices, face, unitOrder, selectedDeviceId) {
  let html = '';
  const faceDevices = devices.filter(d => d.face === face);
  const uh = currentUnitHeight;

  for (const device of faceDevices) {
    const topIndex = topIndexOf(unitOrder, device.position, device.height);
    const top = topIndex * uh;
    const height = device.height * uh;

    const isSelected = device.id === selectedDeviceId;
    const color = device._color || (face === 'front' ? '#3b82f6' : '#f97316');
    const fontSize = uh < 20 ? '10px' : '11px';

    const fdClass = device.fullDepth ? ' device-block--full-depth' : '';
    const statusClass = device.status ? ` device-block--${String(device.status).replace(/[^a-z-]/g, '')}` : '';
    let searchClass = '';
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      const matches = (device.name || '').toLowerCase().includes(q)
        || (device.deviceType || '').toLowerCase().includes(q)
        || (device.role || '').toLowerCase().includes(q);
      searchClass = matches ? ' device-block--search-match' : ' device-block--search-nomatch';
    }
    html += `<div class="device-block${isSelected ? ' selected' : ''}${fdClass}${statusClass}${searchClass}"
      data-device-id="${device.id}"
      draggable="true"
      style="top: ${top}px; height: ${height - 2}px; --dev-color: ${color}; font-size: ${fontSize};"
      title="${device.name} (U${device.position}${device.height > 1 ? '-U' + (device.position + device.height - 1) : ''}, ${face})"
    ><span class="dev-nm">${device.name || '(unnamed)'}</span>${device.height > 1 && device.deviceType ? `<span class="dev-sb">${String(device.deviceType).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>` : ''}</div>`;
  }

  return html;
}

/**
 * Render blockade overlays on this face for full-depth devices on the opposite face.
 */
function renderDepthBlockades(devices, face, unitOrder) {
  const oppositeFace = face === 'front' ? 'rear' : 'front';
  const fullDepthOnOtherSide = devices.filter(d => d.face === oppositeFace && d.fullDepth);
  if (fullDepthOnOtherSide.length === 0) return '';

  const uh = currentUnitHeight;
  let html = '';
  for (const device of fullDepthOnOtherSide) {
    const topIndex = topIndexOf(unitOrder, device.position, device.height);
    const top = topIndex * uh;
    const height = device.height * uh;
    html += `<div class="depth-blockade"
      style="top: ${top}px; height: ${height - 2}px;"
      title="${device.name} (${oppositeFace}, ${t('label_full_depth')})"
    >${device.name}</div>`;
  }
  return html;
}

/**
 * Render hatched overlays for reserved/selected rack units.
 */
function renderReservedOverlays(face, unitOrder, reservedUnits) {
  const matching = reservedUnits.filter(r => r.face === face);
  if (matching.length === 0) return '';

  const uh = currentUnitHeight;
  let html = '';
  for (const r of matching) {
    const idx = unitOrder.indexOf(r.unit);
    if (idx === -1) continue;
    html += `<div class="rack-cell--reserved" style="top: ${idx * uh}px; height: ${uh}px;"></div>`;
  }
  return html;
}

/**
 * Get the unit number from a Y coordinate relative to the rack face.
 */
export function getUnitFromY(y, totalUnits, numberingDirection) {
  const rowIndex = Math.floor(y / currentUnitHeight);
  let unit;
  if (numberingDirection === 'bottom-to-top') {
    unit = totalUnits - rowIndex;
  } else {
    unit = rowIndex + 1;
  }
  return Math.max(1, Math.min(totalUnits, unit));
}

/**
 * Get pixel position and size for a device at the given rack coordinates.
 * Used by drag-drop.js for the snap guide overlay.
 */
export function getPositionPixels(position, height, totalUnits, numberingDirection) {
  // Build unit order (same logic as renderRack)
  const unitOrder = [];
  if (numberingDirection === 'bottom-to-top') {
    for (let u = totalUnits; u >= 1; u--) unitOrder.push(u);
  } else {
    for (let u = 1; u <= totalUnits; u++) unitOrder.push(u);
  }
  const topIndex = topIndexOf(unitOrder, position, height);
  return {
    top: topIndex * currentUnitHeight,
    height: height * currentUnitHeight - 2,
  };
}
