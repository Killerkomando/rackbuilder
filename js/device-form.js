// Device form handling (add, edit, bulk creation)

import { getState, dispatch } from './state.js';
import { canPlace, findNextFreeSlot } from './rack-model.js';
import { generateSequence, parsePositionList } from './utils.js';
import { t } from './i18n.js';

let editingDeviceId = null;

export function initDeviceForm() {
  const form = document.getElementById('device-form');
  const bulkToggle = document.getElementById('bulk-toggle');
  const bulkArrow = document.getElementById('bulk-arrow');
  const bulkContent = document.getElementById('bulk-content');
  const deleteBtn = document.getElementById('form-delete-btn');
  const cancelBtn = document.getElementById('form-cancel-btn');
  const submitBtn = document.getElementById('form-submit-btn');
  const faceRadios = document.querySelectorAll('input[name="dev-face"]');

  // Update color when face changes
  faceRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (!editingDeviceId) {
        const colorInput = document.getElementById('dev-color');
        colorInput.value = radio.value === 'rear' ? '#f97316' : '#3b82f6';
      }
    });
  });

  // Bulk toggle
  bulkToggle.addEventListener('click', () => {
    const isOpen = bulkContent.classList.toggle('open');
    bulkArrow.classList.toggle('open', isOpen);
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
    deviceType: document.getElementById('dev-type').value.trim(),
    role: document.getElementById('dev-role').value.trim(),
    height: parseInt(document.getElementById('dev-height').value) || 1,
    face: document.querySelector('input[name="dev-face"]:checked').value,
    status: document.getElementById('dev-status').value,
    serial: document.getElementById('dev-serial').value.trim(),
    assetTag: document.getElementById('dev-asset').value.trim(),
    _color: document.getElementById('dev-color').value,
    comments: document.getElementById('dev-comments').value.trim(),
  };
}

function getPositionValue() {
  return document.getElementById('dev-position').value.trim();
}

function resolvePosition(posValue, height, face) {
  const state = getState();
  if (posValue === '' || posValue.toLowerCase() === 'auto') {
    return findNextFreeSlot(state.devices, height, face, state.rackConfig.totalUnits);
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

  const names = generateSequence(data.name, qty, numbering === 'alpha' ? startValue : parseInt(startValue) || 1, numbering);

  let devicesToAdd = [];

  if (specificPositions) {
    // Specific positions mode
    const positions = parsePositionList(specificPositions);
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
    let currentPos = resolvePosition(posValue, data.height, data.face);

    if (currentPos === null) {
      showMessage(t('msg_no_start'), 'error');
      return;
    }

    // We need to simulate placement to find sequential positions
    const tempDevices = [...state.devices];
    for (let i = 0; i < qty; i++) {
      const slot = findNextFreeSlot(tempDevices, data.height, data.face, state.rackConfig.totalUnits, currentPos);
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
      currentPos = slot + data.height;
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
  }
}

/**
 * Populate the form for editing a selected device.
 */
export function populateFormForEdit(device) {
  if (!device) {
    resetForm();
    return;
  }

  editingDeviceId = device.id;
  document.getElementById('dev-name').value = device.name;
  document.getElementById('dev-type').value = device.deviceType;
  document.getElementById('dev-role').value = device.role;
  document.getElementById('dev-height').value = device.height;
  document.getElementById('dev-position').value = device.position;
  document.querySelector(`input[name="dev-face"][value="${device.face}"]`).checked = true;
  document.getElementById('dev-status').value = device.status;
  document.getElementById('dev-serial').value = device.serial || '';
  document.getElementById('dev-asset').value = device.assetTag || '';
  document.getElementById('dev-color').value = device._color || '#3b82f6';
  document.getElementById('dev-comments').value = device.comments || '';

  document.getElementById('form-title').textContent = t('edit_device');
  document.getElementById('form-submit-btn').textContent = t('btn_update');
  document.getElementById('form-delete-btn').style.display = '';
  document.getElementById('form-cancel-btn').style.display = '';

  // Close bulk section when editing
  document.getElementById('bulk-content').classList.remove('open');
  document.getElementById('bulk-arrow').classList.remove('open');
}

function resetForm() {
  editingDeviceId = null;
  document.getElementById('device-form').reset();
  document.getElementById('dev-position').value = 'auto';
  document.getElementById('dev-color').value = '#3b82f6';
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
