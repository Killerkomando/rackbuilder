// Rack visualization renderer

import { getState, dispatch } from './state.js';
import { t } from './i18n.js';

// Cached unit height — recalculated on each render
let currentUnitHeight = 28;

/**
 * Calculate the optimal unit height to fit the rack on screen.
 */
function calcUnitHeight(totalUnits) {
  const overhead = 53 + 50 + 60; // header + controls + padding
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
  const { rackConfig, devices, selectedDeviceId } = state;
  const { totalUnits, numberingDirection } = rackConfig;

  // Dynamic unit height
  currentUnitHeight = calcUnitHeight(totalUnits);
  container.style.setProperty('--unit-height', `${currentUnitHeight}px`);

  // Update header info
  document.getElementById('rack-name-display').textContent = rackConfig.name;
  document.getElementById('rack-info').textContent = `${totalUnits}U | ${numberingDirection === 'bottom-to-top' ? 'U1 Bottom' : 'U1 Top'}`;

  // Build unit order (visual top to bottom)
  const unitOrder = [];
  if (numberingDirection === 'bottom-to-top') {
    for (let u = totalUnits; u >= 1; u--) unitOrder.push(u);
  } else {
    for (let u = 1; u <= totalUnits; u++) unitOrder.push(u);
  }

  // Build HTML
  let html = '';

  // Column headers
  html += `<div class="rack-column-header front">${t('col_front')}</div>`;
  html += `<div class="rack-column-header units">${t('col_units')}</div>`;
  html += `<div class="rack-column-header rear">${t('col_rear')}</div>`;

  // Front face column
  html += '<div class="rack-face" id="rack-face-front" data-face="front">';
  for (const u of unitOrder) {
    html += `<div class="rack-cell" data-unit="${u}" data-face="front"></div>`;
  }
  html += renderDeviceBlocks(devices, 'front', unitOrder, selectedDeviceId);
  html += '</div>';

  // Unit numbers column
  html += '<div class="rack-unit-numbers">';
  for (const u of unitOrder) {
    html += `<div class="rack-unit-number">${u}</div>`;
  }
  html += '</div>';

  // Rear face column
  html += '<div class="rack-face" id="rack-face-rear" data-face="rear">';
  for (const u of unitOrder) {
    html += `<div class="rack-cell" data-unit="${u}" data-face="rear"></div>`;
  }
  html += renderDeviceBlocks(devices, 'rear', unitOrder, selectedDeviceId);
  html += '</div>';

  container.innerHTML = html;

  // Add click handlers for device blocks
  container.querySelectorAll('.device-block').forEach(block => {
    block.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = block.dataset.deviceId;
      dispatch('SELECT_DEVICE', id === selectedDeviceId ? null : id);
    });
  });

  // Click on empty cell to deselect
  container.querySelectorAll('.rack-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      if (selectedDeviceId) {
        dispatch('SELECT_DEVICE', null);
      }
    });
  });
}

function renderDeviceBlocks(devices, face, unitOrder, selectedDeviceId) {
  let html = '';
  const faceDevices = devices.filter(d => d.face === face);
  const uh = currentUnitHeight;

  for (const device of faceDevices) {
    const topIndex = unitOrder.indexOf(device.position + device.height - 1);
    const top = topIndex * uh;
    const height = device.height * uh;

    const isSelected = device.id === selectedDeviceId;
    const color = device._color || (face === 'front' ? '#3b82f6' : '#f97316');
    const fontSize = uh < 20 ? '10px' : '11px';

    const fdClass = device.fullDepth ? ' device-block--full-depth' : '';
    html += `<div class="device-block${isSelected ? ' selected' : ''}${fdClass}"
      data-device-id="${device.id}"
      draggable="true"
      style="top: ${top}px; height: ${height - 2}px; background: ${color}; font-size: ${fontSize};"
      title="${device.name} (U${device.position}${device.height > 1 ? '-U' + (device.position + device.height - 1) : ''}, ${face})"
    >${device.name || '(unnamed)'}</div>`;
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
  const topIndex = unitOrder.indexOf(position + height - 1);
  return {
    top: topIndex * currentUnitHeight,
    height: height * currentUnitHeight - 2,
  };
}
