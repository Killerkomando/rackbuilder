// Device form handling (add, edit, bulk creation)

import { getState, dispatch, clearReservedUnits, getActiveRackConfig, getActiveDevices } from './state.js';
import { canPlace, findNextFreeSlot, findNextFreeSlotReverse } from './rack-model.js';
import { generateSequence, parsePositionList } from './utils.js';
import { t } from './i18n.js';

let editingDeviceId = null;

export function initDeviceForm() {
  const form = document.getElementById('device-form');
  const bulkCheckbox = document.getElementById('bulk-checkbox');
  const bulkContent = document.getElementById('bulk-content');
  const deleteBtn = document.getElementById('form-delete-btn');
  const cancelBtn = document.getElementById('form-cancel-btn');
  const submitBtn = document.getElementById('form-submit-btn');
  const faceRadios = document.querySelectorAll('input[name="dev-face"]');

  // Update color when face changes
  faceRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (!editingDeviceId) {
        const cfg = getActiveRackConfig();
        const colorInput = document.getElementById('dev-color');
        colorInput.value = radio.value === 'rear'
          ? (cfg.rearColor || '#f97316')
          : (cfg.frontColor || '#3b82f6');
      }
    });
  });

  // Auto-fill form from device type template metadata
  document.getElementById('dev-type').addEventListener('ac:select', (e) => {
    if (editingDeviceId) return; // Don't override while editing
    const entry = e.detail;
    const parts = [];
    if (entry.uHeight) { document.getElementById('dev-height').value = entry.uHeight; parts.push(entry.uHeight + 'U'); }
    if (entry.fullDepth !== undefined) { document.getElementById('dev-full-depth').checked = entry.fullDepth; if (entry.fullDepth) parts.push('Full'); }
    if (entry.manufacturer) { document.getElementById('dev-manufacturer').value = entry.manufacturer; parts.push(entry.manufacturer); }
    if (parts.length > 0) showAutofillToast(parts.join(' · '));
  });

  function showAutofillToast(text) {
    let toast = document.getElementById('autofill-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'autofill-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = '⚡ Auto-filled: ' + text;
    toast.className = 'autofill-toast autofill-toast--show';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.className = 'autofill-toast'; }, 2500);
  }

  // Bulk toggle via checkbox
  bulkCheckbox.addEventListener('change', () => {
    const isOpen = bulkCheckbox.checked;
    bulkContent.classList.toggle('open', isOpen);
    if (isOpen) {
      // Auto-set stacking direction based on rack numbering
      const cfg = getActiveRackConfig();
      const dirSelect = document.getElementById('bulk-direction');
      dirSelect.value = cfg.numberingDirection === 'bottom-to-top'
        ? 'top-to-bottom'
        : 'bottom-to-top';
    }
  });

  // Auto-switch start value when enumeration type changes
  const bulkNumbering = document.getElementById('bulk-numbering');
  const bulkStart = document.getElementById('bulk-start');
  bulkNumbering.addEventListener('change', () => {
    bulkStart.value = bulkNumbering.value === 'alpha' ? 'A' : '1';
  });

  // Auto-increase quantity when specific positions exceed current qty
  const bulkPositions = document.getElementById('bulk-positions');
  const bulkQty = document.getElementById('bulk-qty');
  bulkPositions.addEventListener('input', () => {
    const positions = parsePositionList(bulkPositions.value.trim());
    if (positions.length > parseInt(bulkQty.value)) {
      bulkQty.value = positions.length;
    }
  });

  // Form submit
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const isBulk = bulkContent.classList.contains('open') && !editingDeviceId;

    if (isBulk) {
      handleBulkCreate();
    } else if (editingDeviceId) {
      handleUpdate();
    } else {
      handleAdd();
    }
  });

  // Delete
  deleteBtn.addEventListener('click', () => {
    if (editingDeviceId) {
      dispatch('REMOVE_DEVICE', editingDeviceId);
      resetForm();
    }
  });

  // Cancel edit
  cancelBtn.addEventListener('click', () => {
    resetForm();
  });
}

function getFormData() {
  return {
    name: document.getElementById('dev-name').value.trim(),
    manufacturer: document.getElementById('dev-manufacturer').value.trim(),
    deviceType: document.getElementById('dev-type').value.trim(),
    role: document.getElementById('dev-role').value.trim(),
    height: parseInt(document.getElementById('dev-height').value) || 1,
    face: document.querySelector('input[name="dev-face"]:checked').value,
    status: document.getElementById('dev-status').value,
    serial: document.getElementById('dev-serial').value.trim(),
    assetTag: document.getElementById('dev-asset').value.trim(),
    fullDepth: document.getElementById('dev-full-depth').checked,
    _color: document.getElementById('dev-color').value,
    comments: document.getElementById('dev-comments').value.trim(),
  };
}

function getPositionValue() {
  return document.getElementById('dev-position').value.trim();
}

function resolvePosition(posValue, height, face) {
  const state = getState();
  const cfg = getActiveRackConfig(state);
  const devices = getActiveDevices(state);
  if (posValue === '' || posValue.toLowerCase() === 'auto') {
    const fullDepth = document.getElementById('dev-full-depth').checked;
    return findNextFreeSlot(devices, height, face, cfg.totalUnits, 1, fullDepth);
  }
  const pos = parseInt(posValue);
  return isNaN(pos) ? null : pos;
}

function handleAdd() {
  const data = getFormData();
  const posValue = getPositionValue();
  const position = resolvePosition(posValue, data.height, data.face);

  if (position === null) {
    showMessage(t('msg_no_slot'), 'error');
    return;
  }

  const result = dispatch('ADD_DEVICE', { ...data, position });
  if (result.ok) {
    showMessage(t('msg_added', { name: data.name, pos: position }), 'success');
    document.getElementById('dev-name').value = '';
    document.getElementById('dev-position').value = 'auto';
    clearReservedUnits();
  } else {
    showMessage(result.reason, 'error');
  }
}

function handleUpdate() {
  const data = getFormData();
  const posValue = getPositionValue();
  const position = parseInt(posValue);

  if (isNaN(position)) {
    showMessage(t('msg_pos_number'), 'error');
    return;
  }

  const result = dispatch('UPDATE_DEVICE', {
    id: editingDeviceId,
    ...data,
    position,
  });

  if (result.ok) {
    showMessage(t('msg_updated'), 'success');
    resetForm();
  } else {
    showMessage(result.reason, 'error');
  }
}

function handleBulkCreate() {
  const data = getFormData();
  const qty = parseInt(document.getElementById('bulk-qty').value) || 2;
  const numbering = document.getElementById('bulk-numbering').value;
  const startValue = document.getElementById('bulk-start').value.trim() || '1';
  const specificPositions = document.getElementById('bulk-positions').value.trim();

  const startParam = numbering === 'alpha'
    ? (/^[a-zA-Z]$/.test(startValue) ? startValue : 'A')
    : (parseInt(startValue) || 1);
  const names = generateSequence(data.name, qty, startParam, numbering);

  let devicesToAdd = [];

  if (specificPositions) {
    // Specific positions mode
    const bulkDirection = document.getElementById('bulk-direction').value;
    const positions = parsePositionList(specificPositions);
    // Sort positions based on stacking direction so names match order
    if (bulkDirection === 'top-to-bottom') {
      positions.sort((a, b) => b - a); // highest first
    } else {
      positions.sort((a, b) => a - b); // lowest first
    }
    if (positions.length < qty) {
      showMessage(t('msg_not_enough_pos', { specified: positions.length, total: qty }), 'error');
      return;
    }
    for (let i = 0; i < qty; i++) {
      devicesToAdd.push({
        ...data,
        name: names[i],
        position: positions[i],
      });
    }
  } else {
    // Sequential stacking mode
    const posValue = getPositionValue();
    const state = getState();
    const cfg = getActiveRackConfig(state);
    const activeDevs = getActiveDevices(state);
    const bulkDirection = document.getElementById('bulk-direction').value;
    const isTopDown = bulkDirection === 'top-to-bottom';
    const isAuto = posValue === '' || posValue.toLowerCase() === 'auto';

    let startPos;
    if (isAuto) {
      if (isTopDown) {
        startPos = findNextFreeSlotReverse(activeDevs, data.height, data.face, cfg.totalUnits, null, data.fullDepth);
      } else {
        startPos = findNextFreeSlot(activeDevs, data.height, data.face, cfg.totalUnits, 1, data.fullDepth);
      }
    } else {
      startPos = parseInt(posValue);
      if (isNaN(startPos)) startPos = null;
    }

    if (startPos === null) {
      showMessage(t('msg_no_start'), 'error');
      return;
    }

    // Simulate placement to find sequential positions
    const tempDevices = [...activeDevs];
    let currentPos = startPos;
    for (let i = 0; i < qty; i++) {
      let slot;
      if (isTopDown) {
        slot = findNextFreeSlotReverse(tempDevices, data.height, data.face, cfg.totalUnits, currentPos, data.fullDepth);
      } else {
        slot = findNextFreeSlot(tempDevices, data.height, data.face, cfg.totalUnits, currentPos, data.fullDepth);
      }
      if (slot === null) {
        showMessage(t('msg_only_fit', { placed: i, total: qty }), 'error');
        return;
      }
      const device = {
        ...data,
        name: names[i],
        position: slot,
        id: `temp-${i}`,
      };
      tempDevices.push(device);
      devicesToAdd.push({ ...data, name: names[i], position: slot });
      currentPos = isTopDown ? slot - data.height : slot + data.height;
    }
  }

  const result = dispatch('BULK_ADD_DEVICES', { devices: devicesToAdd });

  if (result.ok) {
    const placed = result.results.filter(r => r.ok).length;
    const failed = result.results.filter(r => !r.ok);

    if (failed.length === 0) {
      showMessage(t('msg_bulk_added', { placed }), 'success');
    } else {
      const failedNames = failed.map(f => `${f.name}: ${f.reason}`).join('\n');
      showMessage(`${t('msg_partial', { placed, total: qty })}\n${failedNames}`, 'error');
    }

    document.getElementById('dev-name').value = '';
    document.getElementById('dev-position').value = 'auto';
    // Reset bulk fields
    document.getElementById('bulk-qty').value = '2';
    document.getElementById('bulk-numbering').value = 'numeric';
    document.getElementById('bulk-start').value = '1';
    document.getElementById('bulk-direction').value = 'bottom-to-top';
    document.getElementById('bulk-positions').value = '';
    // Close bulk section and uncheck checkbox
    document.getElementById('bulk-content').classList.remove('open');
    document.getElementById('bulk-checkbox').checked = false;
    clearReservedUnits();
  }
}

/**
 * Populate the form for editing a selected device.
 */
export function populateFormForEdit(device) {
  if (!device) {
    // Only reset if we were in edit mode, not on every state change
    if (editingDeviceId) {
      resetForm();
    }
    return;
  }

  editingDeviceId = device.id;
  document.getElementById('dev-name').value = device.name;
  document.getElementById('dev-manufacturer').value = device.manufacturer || '';
  document.getElementById('dev-type').value = device.deviceType;
  document.getElementById('dev-role').value = device.role;
  document.getElementById('dev-height').value = device.height;
  document.getElementById('dev-position').value = device.position;
  document.querySelector(`input[name="dev-face"][value="${device.face}"]`).checked = true;
  document.getElementById('dev-status').value = device.status;
  document.getElementById('dev-serial').value = device.serial || '';
  document.getElementById('dev-asset').value = device.assetTag || '';
  document.getElementById('dev-full-depth').checked = device.fullDepth || false;
  document.getElementById('dev-color').value = device._color || '#3b82f6';
  document.getElementById('dev-comments').value = device.comments || '';

  document.getElementById('form-title').textContent = t('edit_device');
  document.getElementById('form-submit-btn').textContent = t('btn_update');
  document.getElementById('form-delete-btn').style.display = '';
  document.getElementById('form-cancel-btn').style.display = '';

  // Close bulk section when editing
  document.getElementById('bulk-content').classList.remove('open');
  document.getElementById('bulk-checkbox').checked = false;
}

function resetForm() {
  editingDeviceId = null;
  document.getElementById('device-form').reset();
  document.getElementById('dev-position').value = 'auto';
  document.getElementById('dev-full-depth').checked = false;
  document.getElementById('dev-color').value = getActiveRackConfig().frontColor || '#3b82f6';
  document.getElementById('form-title').textContent = t('add_device');
  document.getElementById('form-submit-btn').textContent = t('btn_add');
  document.getElementById('form-delete-btn').style.display = 'none';
  document.getElementById('form-cancel-btn').style.display = 'none';
  showMessage('', '');
  if (getState().selectedDeviceId !== null) {
    dispatch('SELECT_DEVICE', null);
  }
}

function showMessage(text, type) {
  const el = document.getElementById('form-message');
  if (!text) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<div class="message message-${type}">${text.replace(/\n/g, '<br>')}</div>`;
  if (type === 'success') {
    setTimeout(() => {
      if (el.querySelector('.message-success')) {
        el.innerHTML = '';
      }
    }, 3000);
  }
}
