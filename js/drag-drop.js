// Drag and drop handling for repositioning devices in the rack

import { getState, dispatch } from './state.js';
import { canPlace } from './rack-model.js';
import { getUnitFromY } from './rack-view.js';

let dragDeviceId = null;
let dragDeviceHeight = 1;
let dragGrabOffset = 0;

// Performance: throttle + position caching
let rafPending = false;
let lastTargetPos = null;
let lastTargetFace = null;
let highlightedCells = [];

export function initDragDrop() {
  const rackView = document.getElementById('rack-view');

  rackView.addEventListener('dragstart', handleDragStart);
  rackView.addEventListener('dragover', handleDragOver);
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

  const face = block.closest('.rack-face');
  const faceRect = face.getBoundingClientRect();
  const relY = e.clientY - faceRect.top;
  const clickedUnit = getUnitFromY(relY, state.rackConfig.totalUnits, state.rackConfig.numberingDirection);
  dragGrabOffset = clickedUnit - device.position;

  block.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', deviceId);

  // Reset caches
  lastTargetPos = null;
  lastTargetFace = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  if (!dragDeviceId || rafPending) return;

  rafPending = true;
  // Capture coordinates synchronously (event object may be reused)
  const clientY = e.clientY;
  const target = e.target;

  requestAnimationFrame(() => {
    rafPending = false;
    if (!dragDeviceId) return;
    updateDragHighlights(clientY, target);
  });
}

function updateDragHighlights(clientY, target) {
  const face = target.closest ? target.closest('.rack-face') : null;
  if (!face) return;

  const faceType = face.dataset.face;
  const faceRect = face.getBoundingClientRect();
  const relY = clientY - faceRect.top;
  const state = getState();
  const hoveredUnit = getUnitFromY(relY, state.rackConfig.totalUnits, state.rackConfig.numberingDirection);
  const targetPosition = hoveredUnit - dragGrabOffset;

  // Skip if position hasn't changed
  if (targetPosition === lastTargetPos && faceType === lastTargetFace) return;
  lastTargetPos = targetPosition;
  lastTargetFace = faceType;

  // Clear only previously highlighted cells (no DOM query)
  for (const cell of highlightedCells) {
    cell.classList.remove('drag-over-valid', 'drag-over-invalid');
  }
  highlightedCells = [];

  // Check placement validity
  const result = canPlace(
    state.devices, targetPosition, dragDeviceHeight,
    faceType, state.rackConfig.totalUnits, dragDeviceId
  );

  // Highlight target cells
  const className = result.ok ? 'drag-over-valid' : 'drag-over-invalid';
  const cells = face.querySelectorAll('.rack-cell');
  for (const cell of cells) {
    const cellUnit = parseInt(cell.dataset.unit);
    if (cellUnit >= targetPosition && cellUnit < targetPosition + dragDeviceHeight) {
      cell.classList.add(className);
      highlightedCells.push(cell);
    }
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

  resetDragState();
}

function handleDragEnd() {
  clearHighlights();
  const rackView = document.getElementById('rack-view');
  const dragging = rackView.querySelector('.device-block.dragging');
  if (dragging) dragging.classList.remove('dragging');
  resetDragState();
}

function clearHighlights() {
  for (const cell of highlightedCells) {
    cell.classList.remove('drag-over-valid', 'drag-over-invalid');
  }
  highlightedCells = [];
}

function resetDragState() {
  dragDeviceId = null;
  lastTargetPos = null;
  lastTargetFace = null;
  rafPending = false;
}
