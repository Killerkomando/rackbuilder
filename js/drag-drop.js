// Drag and drop handling for repositioning devices in the rack

import { getState, dispatch } from './state.js';
import { canPlace } from './rack-model.js';
import { getUnitFromY } from './rack-view.js';

let dragDeviceId = null;
let dragDeviceHeight = 1;
let dragGrabOffset = 0; // which U within the device was grabbed

export function initDragDrop() {
  const rackView = document.getElementById('rack-view');

  rackView.addEventListener('dragstart', handleDragStart);
  rackView.addEventListener('dragover', handleDragOver);
  rackView.addEventListener('dragleave', handleDragLeave);
  rackView.addEventListener('drop', handleDrop);
  rackView.addEventListener('dragend', handleDragEnd);
}

function handleDragStart(e) {
  const block = e.target.closest('.device-block');
  if (!block) return;

  const deviceId = block.dataset.deviceId;
  const state = getState();
  const device = state.devices.find(d => d.id === deviceId);
  if (!device) return;

  dragDeviceId = deviceId;
  dragDeviceHeight = device.height;

  // Calculate grab offset: which U within the device was clicked
  const face = block.closest('.rack-face');
  const faceRect = face.getBoundingClientRect();
  const relY = e.clientY - faceRect.top;
  const clickedUnit = getUnitFromY(relY, state.rackConfig.totalUnits, state.rackConfig.numberingDirection);
  dragGrabOffset = clickedUnit - device.position;

  block.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', deviceId);
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  if (!dragDeviceId) return;

  const face = e.target.closest('.rack-face');
  if (!face) return;

  const faceType = face.dataset.face;
  const faceRect = face.getBoundingClientRect();
  const relY = e.clientY - faceRect.top;
  const state = getState();
  const hoveredUnit = getUnitFromY(relY, state.rackConfig.totalUnits, state.rackConfig.numberingDirection);
  const targetPosition = hoveredUnit - dragGrabOffset;

  // Clear all highlights
  clearHighlights();

  // Check if placement is valid
  const result = canPlace(
    state.devices, targetPosition, dragDeviceHeight,
    faceType, state.rackConfig.totalUnits, dragDeviceId
  );

  // Highlight target cells
  const cells = face.querySelectorAll('.rack-cell');
  for (const cell of cells) {
    const cellUnit = parseInt(cell.dataset.unit);
    if (cellUnit >= targetPosition && cellUnit < targetPosition + dragDeviceHeight) {
      cell.classList.add(result.ok ? 'drag-over-valid' : 'drag-over-invalid');
    }
  }
}

function handleDragLeave(e) {
  const cell = e.target.closest('.rack-cell');
  if (cell) {
    cell.classList.remove('drag-over-valid', 'drag-over-invalid');
  }
}

function handleDrop(e) {
  e.preventDefault();
  clearHighlights();

  if (!dragDeviceId) return;

  const face = e.target.closest('.rack-face');
  if (!face) return;

  const faceType = face.dataset.face;
  const faceRect = face.getBoundingClientRect();
  const relY = e.clientY - faceRect.top;
  const state = getState();
  const hoveredUnit = getUnitFromY(relY, state.rackConfig.totalUnits, state.rackConfig.numberingDirection);
  const targetPosition = hoveredUnit - dragGrabOffset;

  dispatch('MOVE_DEVICE', {
    id: dragDeviceId,
    position: targetPosition,
    face: faceType,
  });

  dragDeviceId = null;
}

function handleDragEnd() {
  clearHighlights();
  document.querySelectorAll('.device-block.dragging').forEach(el => {
    el.classList.remove('dragging');
  });
  dragDeviceId = null;
}

function clearHighlights() {
  document.querySelectorAll('.drag-over-valid, .drag-over-invalid').forEach(el => {
    el.classList.remove('drag-over-valid', 'drag-over-invalid');
  });
}
