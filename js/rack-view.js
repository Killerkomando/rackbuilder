// Rack visualization renderer

import { getState, dispatch } from './state.js';
import { t } from './i18n.js';
import { getOccupiedUnits } from './rack-model.js';

/**
 * Render the rack visualization into the #rack-view element.
 */
export function renderRack(state) {
  const container = document.getElementById('rack-view');
  const { rackConfig, devices, selectedDeviceId } = state;
  const { totalUnits, numberingDirection } = rackConfig;

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
  // Render device blocks for front
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
  // Render device blocks for rear
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

  for (const device of faceDevices) {
    // Calculate visual position
    const topIndex = unitOrder.indexOf(device.position + device.height - 1);
    const top = topIndex * 28; // var(--unit-height) = 28px
    const height = device.height * 28;

    const isSelected = device.id === selectedDeviceId;
    const color = device._color || (face === 'front' ? '#3b82f6' : '#f97316');

    html += `<div class="device-block${isSelected ? ' selected' : ''}"
      data-device-id="${device.id}"
      draggable="true"
      style="top: ${top}px; height: ${height - 2}px; background: ${color};"
      title="${device.name} (U${device.position}${device.height > 1 ? '-U' + (device.position + device.height - 1) : ''}, ${face})"
    >${device.name || '(unnamed)'}</div>`;
  }

  return html;
}

/**
 * Get the unit number from a Y coordinate relative to the rack face.
 */
export function getUnitFromY(y, totalUnits, numberingDirection) {
  const rowIndex = Math.floor(y / 28);
  if (numberingDirection === 'bottom-to-top') {
    return totalUnits - rowIndex;
  } else {
    return rowIndex + 1;
  }
}
