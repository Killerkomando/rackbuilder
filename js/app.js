// Rack Builder — Main application bootstrap

import { getState, subscribe, dispatch, undo, redo, canUndo, canRedo, getReservedUnits, setReservedUnits, clearReservedUnits, getActiveRackConfig, getActiveDevices } from './state.js';
import { renderRack, setSearchFilter } from './rack-view.js';
import { getLocalStorageUsage, parsePositionList, generateId } from './utils.js';
import { getRackUtilization, toNetBoxJSON } from './rack-model.js';
import { initDeviceForm, populateFormForEdit } from './device-form.js';
import { initDragDrop } from './drag-drop.js';
import { initExport } from './export.js';
import { t, getCurrentLang, setLang, applyTranslations } from './i18n.js';
import { initNetboxAutocomplete } from './netbox-autocomplete.js';

// Initialize the application
function init() {
  initTheme();
  initLang();

  // Render initial state
  const state = getState();
  renderRack(state);
  renderDeviceList(state);

  // Subscribe to state changes
  subscribe((state) => {
    renderRackTabs(state);
    renderRack(state);
    renderDeviceList(state);
    handleSelection(state);
    syncReservedUnitsToForm();
    updateUndoRedoButtons();
    updateStorageIndicator();
    updateStats(state);
    updateJsonPreview(state);
  });

  // Initialize modules
  initDeviceForm();
  initDragDrop();
  initExport();
  initSettings();
  initKeyboardShortcuts();
  initClearButton();
  initUndoRedo();
  initJsonPreview();
  initStorageIndicator();
  initBulkPositionHighlight();
  initNetboxAutocomplete();
  initAccordionAnimations();
  initDeviceSearch();
  initResponsiveSidebars();
  initShortcutsPanel();
  updateStorageIndicator();
  updateStats(state);

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// ─── Theme ──────────────────────────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem('rackbuilder_theme') || 'dark';
  applyTheme(saved);

  document.getElementById('theme-btn').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme;
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('rackbuilder_theme', theme);
  const btn = document.getElementById('theme-btn');
  if (btn) {
    btn.textContent = t(theme === 'dark' ? 'theme_dark' : 'theme_light');
  }
}

// ─── Language ───────────────────────────────────────────────────────────────

function initLang() {
  applyTranslations();

  document.getElementById('lang-btn').addEventListener('click', () => {
    const next = getCurrentLang() === 'en' ? 'de' : 'en';
    setLang(next);
    // Also update theme button text (translated)
    const theme = document.documentElement.dataset.theme || 'dark';
    const btn = document.getElementById('theme-btn');
    if (btn) btn.textContent = t(theme === 'dark' ? 'theme_dark' : 'theme_light');
  });
}

// ─── Device list ────────────────────────────────────────────────────────────

let deviceSearchTerm = '';

function renderDeviceList(state) {
  const container = document.getElementById('device-list');
  const countEl = document.getElementById('device-count');
  const devices = getActiveDevices(state);
  const { selectedDeviceId } = state;

  countEl.textContent = devices.length;

  if (devices.length === 0) {
    container.innerHTML = `<p style="color: var(--color-text-muted); font-size: 12px;">${t('no_devices')}</p>`;
    return;
  }

  const sorted = [...devices].sort((a, b) => a.position - b.position);
  const q = deviceSearchTerm.toLowerCase();
  const filtered = q
    ? sorted.filter(d =>
        (d.name || '').toLowerCase().includes(q) ||
        (d.deviceType || '').toLowerCase().includes(q) ||
        (d.role || '').toLowerCase().includes(q))
    : sorted;

  if (filtered.length === 0) {
    container.innerHTML = `<p style="color: var(--color-text-muted); font-size: 12px;">—</p>`;
    return;
  }

  const multiRack = state.multiRackEnabled && state.racks.length > 1;

  container.innerHTML = filtered.map(d => {
    const rackSelect = multiRack
      ? `<select class="device-rack-select" data-device-id="${d.id}" title="${t('move_to_rack')}">
          ${state.racks.map(r => `<option value="${r.id}"${r.id === d.rackId ? ' selected' : ''}>${r.name}</option>`).join('')}
         </select>`
      : '';
    return `<div class="device-list-item${d.id === selectedDeviceId ? ' selected' : ''}" data-device-id="${d.id}">
      <div class="device-info">
        <span class="device-color" style="background: ${d._color || '#3b82f6'}"></span>
        <span>${d.name || '(unnamed)'}</span>
      </div>
      <span class="device-pos">U${d.position}${d.height > 1 ? '-' + (d.position + d.height - 1) : ''} ${d.face}</span>
      ${rackSelect}
      <button class="device-delete" data-device-id="${d.id}" title="Delete">&times;</button>
    </div>`;
  }).join('');

  container.querySelectorAll('.device-list-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.device-delete') || e.target.closest('.device-rack-select')) return;
      const id = item.dataset.deviceId;
      dispatch('SELECT_DEVICE', id === state.selectedDeviceId ? null : id);
    });
  });

  container.querySelectorAll('.device-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dispatch('REMOVE_DEVICE', btn.dataset.deviceId);
    });
  });

  container.querySelectorAll('.device-rack-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      e.stopPropagation();
      const id = sel.dataset.deviceId;
      const targetRackId = sel.value;
      const result = dispatch('MOVE_TO_RACK', { id, targetRackId });
      if (!result.ok) {
        const rack = state.racks.find(r => r.id === targetRackId);
        alert(t('move_rack_conflict', { rack: rack?.name || targetRackId }));
        // Reset select back to current rack
        const device = state.devices.find(d => d.id === id);
        if (device) sel.value = device.rackId;
      }
    });
  });
}

function initDeviceSearch() {
  const input = document.getElementById('device-search');
  if (!input) return;
  input.addEventListener('input', () => {
    deviceSearchTerm = input.value.trim();
    setSearchFilter(deviceSearchTerm);
    const state = getState();
    // Auto-switch rack in multi-rack mode to first matching device's rack
    if (deviceSearchTerm && state.multiRackEnabled) {
      const q = deviceSearchTerm.toLowerCase();
      const match = state.devices.find(d =>
        (d.name || '').toLowerCase().includes(q) ||
        (d.deviceType || '').toLowerCase().includes(q) ||
        (d.role || '').toLowerCase().includes(q)
      );
      if (match && match.rackId && match.rackId !== state.activeRackId) {
        dispatch('SET_ACTIVE_RACK', match.rackId);
        return; // dispatch triggers subscribe which re-renders everything
      }
    }
    renderDeviceList(state);
    renderRack(state);
  });
}

function handleSelection(state) {
  const { selectedDeviceId, devices } = state;
  if (selectedDeviceId) {
    const device = devices.find(d => d.id === selectedDeviceId);
    populateFormForEdit(device || null);
  } else {
    populateFormForEdit(null);
  }
}

// ─── Settings modal ─────────────────────────────────────────────────────────

function initSettings() {
  const modal = document.getElementById('settings-modal');
  const form = document.getElementById('settings-form');
  const multiRackCheckbox = document.getElementById('setting-multi-rack');
  const singleRackFields = document.getElementById('single-rack-fields');
  const multiRackFields = document.getElementById('multi-rack-fields');
  const rackCountInput = document.getElementById('setting-rack-count');

  // Smooth slide-toggle for a container element
  function slideToggle(el, show, onDone) {
    if (show) {
      // ── Slide open ──
      el.style.display = 'block';
      el.style.overflow = 'hidden';
      const targetHeight = el.scrollHeight;
      el.style.height = '0px';
      el.style.opacity = '0';
      requestAnimationFrame(() => {
        el.style.transition = 'height 0.35s cubic-bezier(0.25,0.46,0.45,0.94), opacity 0.3s ease';
        requestAnimationFrame(() => {
          el.style.height = targetHeight + 'px';
          el.style.opacity = '1';
        });
      });
      el.addEventListener('transitionend', function handler(ev) {
        if (ev.propertyName !== 'height') return;
        el.removeEventListener('transitionend', handler);
        el.style.height = '';
        el.style.overflow = '';
        el.style.opacity = '';
        el.style.transition = '';
        if (onDone) onDone();
      });
    } else {
      // ── Slide closed ──
      el.style.overflow = 'hidden';
      el.style.height = el.scrollHeight + 'px';
      el.style.opacity = '1';
      requestAnimationFrame(() => {
        el.style.transition = 'height 0.3s cubic-bezier(0.25,0.46,0.45,0.94), opacity 0.25s ease';
        requestAnimationFrame(() => {
          el.style.height = '0px';
          el.style.opacity = '0';
        });
      });
      el.addEventListener('transitionend', function handler(ev) {
        if (ev.propertyName !== 'height') return;
        el.removeEventListener('transitionend', handler);
        el.style.display = 'none';
        el.style.height = '';
        el.style.overflow = '';
        el.style.opacity = '';
        el.style.transition = '';
        if (onDone) onDone();
      });
    }
  }

  function toggleMultiRackUI(enabled, animate) {
    if (animate) {
      if (enabled) {
        slideToggle(singleRackFields, false, () => {
          renderRackRows();
          slideToggle(multiRackFields, true);
        });
      } else {
        slideToggle(multiRackFields, false, () => {
          slideToggle(singleRackFields, true);
        });
      }
    } else {
      // No animation (initial load)
      singleRackFields.style.display = enabled ? 'none' : 'block';
      multiRackFields.style.display = enabled ? 'block' : 'none';
      if (enabled) renderRackRows();
    }
  }

  function renderRackRows() {
    const count = parseInt(rackCountInput.value) || 1;
    const container = document.getElementById('rack-rows');
    const state = getState();
    const existingRacks = state.racks || [];
    const currentRows = container.querySelectorAll('.rack-config-row');
    const prevCount = currentRows.length;

    if (count < prevCount) {
      // ── Animate removal of excess rows, then rebuild ──
      const rowsToRemove = Array.from(currentRows).slice(count);
      let pending = rowsToRemove.length;
      rowsToRemove.forEach((row, idx) => {
        row.style.animationDelay = (idx * 50) + 'ms';
        row.classList.add('rack-row-exit');
        row.addEventListener('animationend', () => {
          pending--;
          if (pending === 0) buildRows(count, container, existingRacks, prevCount);
        }, { once: true });
      });
    } else {
      buildRows(count, container, existingRacks, prevCount);
    }
  }

  function buildRows(count, container, existingRacks, prevCount) {
    let html = '';
    for (let i = 0; i < count; i++) {
      const rack = existingRacks[i] || {};
      const dir = rack.numberingDirection || 'bottom-to-top';
      const isNew = i >= prevCount;
      html += `<div class="rack-config-row${isNew ? ' rack-row-enter' : ''}">
        <span class="rack-row-num">${i + 1}.</span>
        <input type="text" class="rack-row-name" value="${rack.name || `Rack-${String(i + 1).padStart(2, '0')}`}" placeholder="${t('setting_name')}" required>
        <input type="number" class="rack-row-units" value="${rack.totalUnits || 42}" min="1" max="60" required>
        <span class="rack-row-label">U</span>
        <select class="rack-row-direction">
          <option value="bottom-to-top"${dir === 'bottom-to-top' ? ' selected' : ''}>${t('dir_bottom')}</option>
          <option value="top-to-bottom"${dir === 'top-to-bottom' ? ' selected' : ''}>${t('dir_top')}</option>
        </select>
      </div>`;
    }
    container.innerHTML = html;

    // Animate newly added rows with staggered delay
    const newRows = container.querySelectorAll('.rack-row-enter');
    newRows.forEach((row, idx) => {
      row.style.animationDelay = (idx * 60) + 'ms';
      row.addEventListener('animationend', () => {
        row.classList.remove('rack-row-enter');
        row.style.animationDelay = '';
      }, { once: true });
    });
  }

  multiRackCheckbox.addEventListener('change', () => {
    toggleMultiRackUI(multiRackCheckbox.checked, true);
  });

  rackCountInput.addEventListener('input', renderRackRows);

  // ── Sliding tab indicator + animated height switching ──
  const tabsEl   = modal.querySelector('.modal-tabs');
  const indicator = modal.querySelector('.modal-tab-indicator');
  const wrap      = document.getElementById('modal-panels-wrap');

  function moveIndicator(tab, animate) {
    if (!animate) indicator.style.transition = 'none';
    const tabsRect = tabsEl.getBoundingClientRect();
    const tabRect  = tab.getBoundingClientRect();
    indicator.style.width     = tabRect.width + 'px';
    indicator.style.transform = `translateX(${tabRect.left - tabsRect.left - 3}px)`;
    if (!animate) requestAnimationFrame(() => { indicator.style.transition = ''; });
  }

  function switchTab(tab) {
    const currentPanel = modal.querySelector('.modal-tab-panel.active');
    const targetPanel  = document.getElementById('tab-panel-' + tab.dataset.tab);
    if (currentPanel === targetPanel) return;

    // Move the pill indicator
    moveIndicator(tab, true);

    // Update active tab button
    modal.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Animate content height
    const fromH = currentPanel.scrollHeight;
    wrap.style.height = fromH + 'px';
    wrap.style.overflow = 'hidden';

    currentPanel.classList.remove('active');
    targetPanel.classList.add('active');
    if (tab.dataset.tab === 'shortcuts') renderShortcutsPanel();

    requestAnimationFrame(() => {
      wrap.style.height = targetPanel.scrollHeight + 'px';
    });

    wrap.addEventListener('transitionend', () => {
      wrap.style.height   = '';
      wrap.style.overflow = '';
    }, { once: true });
  }

  modal.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab));
  });

  document.getElementById('settings-btn').addEventListener('click', () => {
    const state = getState();
    const cfg = state.rackConfig;

    // Common fields
    document.getElementById('setting-site').value = cfg.site;
    document.getElementById('setting-location').value = cfg.location;

    // Multi-rack state
    multiRackCheckbox.checked = state.multiRackEnabled;
    rackCountInput.value = state.multiRackEnabled ? state.racks.length : 2;

    if (state.multiRackEnabled) {
      toggleMultiRackUI(true);
    } else {
      // Single rack fields
      document.getElementById('setting-name').value = cfg.name;
      document.getElementById('setting-units').value = cfg.totalUnits;
      document.getElementById('setting-direction').value = cfg.numberingDirection;
      document.getElementById('setting-front-color').value = cfg.frontColor || '#3b82f6';
      document.getElementById('setting-rear-color').value = cfg.rearColor || '#f97316';
      toggleMultiRackUI(false);
    }
    // Reset to first tab
    modal.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    modal.querySelectorAll('.modal-tab-panel').forEach(p => p.classList.remove('active'));
    modal.querySelector('.modal-tab[data-tab="rack"]').classList.add('active');
    document.getElementById('tab-panel-rack').classList.add('active');
    modal.showModal();
    // Position indicator after dialog is visible (getBoundingClientRect needs layout)
    requestAnimationFrame(() => moveIndicator(modal.querySelector('.modal-tab.active'), false));
  });

  document.getElementById('settings-cancel').addEventListener('click', () => {
    closeDialogAnimated(modal);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const site = document.getElementById('setting-site').value.trim();
    const location = document.getElementById('setting-location').value.trim();

    if (multiRackCheckbox.checked) {
      // Multi-rack mode
      const rows = document.querySelectorAll('.rack-config-row');
      const state = getState();
      const existingRacks = state.racks || [];
      const racks = [];
      rows.forEach((row, i) => {
        const existing = existingRacks[i] || {};
        racks.push({
          id: existing.id || undefined,
          name: row.querySelector('.rack-row-name').value.trim(),
          totalUnits: parseInt(row.querySelector('.rack-row-units').value) || 42,
          numberingDirection: row.querySelector('.rack-row-direction').value,
          frontColor: existing.frontColor || '#3b82f6',
          rearColor: existing.rearColor || '#f97316',
          site,
          location,
        });
      });
      dispatch('SET_MULTI_RACK', { enabled: true, racks, site, location });
    } else {
      // Single rack mode
      dispatch('SET_MULTI_RACK', { enabled: false, racks: [], site, location });
      dispatch('UPDATE_RACK_CONFIG', {
        name: document.getElementById('setting-name').value.trim(),
        totalUnits: parseInt(document.getElementById('setting-units').value) || 42,
        numberingDirection: document.getElementById('setting-direction').value,
        site,
        location,
        frontColor: document.getElementById('setting-front-color').value,
        rearColor: document.getElementById('setting-rear-color').value,
      });
    }
    closeDialogAnimated(modal);
  });
}

// ─── Dialog animation helper ─────────────────────────────────────────────────

function closeDialogAnimated(dialog) {
  if (!dialog.open) return;
  dialog.classList.add('dialog-closing');
  const done = () => {
    dialog.classList.remove('dialog-closing');
    if (dialog.open) dialog.close();
  };
  dialog.addEventListener('animationend', function handler() {
    dialog.removeEventListener('animationend', handler);
    clearTimeout(fallback);
    done();
  });
  // Fallback in case animationend never fires
  const fallback = setTimeout(done, 300);
}

// ─── Keyboard shortcuts ──────────────────────────────────────────────────────

const DEFAULT_SHORTCUTS = {
  undo:   { label: 'shortcut_undo',   key: 'z',      ctrl: true,  shift: false },
  redo:   { label: 'shortcut_redo',   key: 'y',      ctrl: true,  shift: false },
  delete: { label: 'shortcut_delete', key: 'Delete', ctrl: false, shift: false },
  escape: { label: 'shortcut_escape', key: 'Escape', ctrl: false, shift: false },
};

let shortcuts = {};

function loadShortcuts() {
  try {
    const saved = JSON.parse(localStorage.getItem('rackbuilder_shortcuts') || '{}');
    shortcuts = {};
    for (const [id, def] of Object.entries(DEFAULT_SHORTCUTS)) {
      shortcuts[id] = { ...def, ...(saved[id] || {}) };
    }
  } catch {
    shortcuts = {};
    for (const [id, def] of Object.entries(DEFAULT_SHORTCUTS)) {
      shortcuts[id] = { ...def };
    }
  }
}

function saveShortcuts() {
  const toSave = {};
  for (const [id, sc] of Object.entries(shortcuts)) {
    const def = DEFAULT_SHORTCUTS[id];
    if (sc.key !== def.key || sc.ctrl !== def.ctrl || sc.shift !== def.shift) {
      toSave[id] = { key: sc.key, ctrl: sc.ctrl, shift: sc.shift };
    }
  }
  if (Object.keys(toSave).length > 0) {
    localStorage.setItem('rackbuilder_shortcuts', JSON.stringify(toSave));
  } else {
    localStorage.removeItem('rackbuilder_shortcuts');
  }
}

function matchesShortcut(e, sc) {
  return (e.ctrlKey || e.metaKey) === (sc.ctrl || false)
    && e.shiftKey === (sc.shift || false)
    && e.key === sc.key;
}

function formatShortcut(sc) {
  const parts = [];
  if (sc.ctrl) parts.push('Ctrl');
  if (sc.shift) parts.push('Shift');
  const k = sc.key === ' ' ? 'Space' : sc.key;
  parts.push(k);
  return parts;
}

function initKeyboardShortcuts() {
  loadShortcuts();
  document.addEventListener('keydown', (e) => {
    if (matchesShortcut(e, shortcuts.undo)) {
      e.preventDefault(); undo(); return;
    }
    // Also handle Ctrl+Shift+Z as alternative redo
    if (matchesShortcut(e, shortcuts.redo) || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')) {
      e.preventDefault(); redo(); return;
    }
    if (e.target.matches('input, textarea, select')) return;
    const state = getState();
    if (matchesShortcut(e, shortcuts.delete) && state.selectedDeviceId) {
      dispatch('REMOVE_DEVICE', state.selectedDeviceId);
    }
    if (matchesShortcut(e, shortcuts.escape) && state.selectedDeviceId) {
      dispatch('SELECT_DEVICE', null);
    }
  });
}

// ─── Shortcuts Settings Panel ────────────────────────────────────────────────

let recordingCleanup = null;

function renderShortcutsPanel() {
  const container = document.getElementById('shortcuts-list');
  if (!container) return;
  container.innerHTML = Object.entries(shortcuts).map(([id, sc]) => {
    const keys = formatShortcut(sc);
    const kbdHtml = keys.map(k => `<kbd>${k}</kbd>`).join('<span class="shortcut-plus">+</span>');
    return `<div class="shortcut-row" data-shortcut-id="${id}">
      <span class="shortcut-label">${t(sc.label)}</span>
      <div class="shortcut-binding">${kbdHtml}</div>
      <button type="button" class="btn btn-secondary btn-sm shortcut-record-btn" data-id="${id}">${t('shortcut_record')}</button>
    </div>`;
  }).join('');

  container.querySelectorAll('.shortcut-record-btn').forEach(btn => {
    btn.addEventListener('click', () => startRecording(btn.dataset.id));
  });
}

function startRecording(id) {
  if (recordingCleanup) recordingCleanup();
  const btn = document.querySelector(`.shortcut-record-btn[data-id="${id}"]`);
  if (btn) btn.textContent = t('shortcut_recording');

  function onKey(e) {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape' && !e.ctrlKey && !e.shiftKey) { cleanup(); return; }

    const newSc = { key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
    const conflict = Object.entries(shortcuts).find(([oid, sc]) =>
      oid !== id && sc.key === newSc.key && (sc.ctrl || false) === newSc.ctrl && (sc.shift || false) === newSc.shift
    );
    shortcuts[id] = { ...shortcuts[id], ...newSc };
    saveShortcuts();
    cleanup();
    renderShortcutsPanel();
    if (conflict) {
      const row = document.querySelector(`.shortcut-row[data-shortcut-id="${id}"]`);
      if (row) {
        const warn = document.createElement('span');
        warn.className = 'shortcut-conflict';
        warn.textContent = t('shortcut_conflict');
        row.appendChild(warn);
        setTimeout(() => warn.remove(), 2500);
      }
    }
  }

  function cleanup() {
    document.removeEventListener('keydown', onKey, true);
    recordingCleanup = null;
    if (btn && btn.isConnected) btn.textContent = t('shortcut_record');
  }
  recordingCleanup = cleanup;
  document.addEventListener('keydown', onKey, true);
}

function initShortcutsPanel() {
  document.getElementById('shortcuts-reset-btn')?.addEventListener('click', () => {
    localStorage.removeItem('rackbuilder_shortcuts');
    loadShortcuts();
    renderShortcutsPanel();
  });
}

// ─── Clear button ────────────────────────────────────────────────────────────

function initClearButton() {
  document.getElementById('clear-devices-btn').addEventListener('click', () => {
    if (confirm(t('confirm_clear_devices'))) {
      dispatch('CLEAR_DEVICES');
    }
  });

  document.getElementById('reset-all-btn').addEventListener('click', () => {
    if (confirm(t('confirm_reset_all'))) {
      dispatch('CLEAR_STATE');
    }
  });
}

// ─── Live Statistics ────────────────────────────────────────────────────────

function updateStats(state) {
  const cfg = getActiveRackConfig(state);
  const devices = getActiveDevices(state);
  const stats = getRackUtilization(devices, cfg.totalUnits);

  const el = document.getElementById('rack-stats');
  if (el) {
    el.textContent = `${stats.totalPercent}% ${t('stat_used')} (F: ${stats.frontPercent}% | R: ${stats.rearPercent}%)`;
  }

  // Utilization bar
  const utilEl = document.getElementById('rack-utilization');
  if (utilEl) {
    const hasDevices = devices.length > 0;
    utilEl.style.display = hasDevices ? 'flex' : 'none';
    const frontW = stats.front / (cfg.totalUnits * 2) * 100;
    const rearW  = stats.rear  / (cfg.totalUnits * 2) * 100;
    const frontBar = document.getElementById('util-bar-front');
    const rearBar  = document.getElementById('util-bar-rear');
    const label    = document.getElementById('util-label');
    if (frontBar) frontBar.style.width = frontW + '%';
    if (rearBar)  rearBar.style.width  = rearW  + '%';
    if (label) {
      const used = stats.front + stats.rear;
      label.textContent = `${used}/${cfg.totalUnits * 2}U (${stats.totalPercent}%)`;
    }
  }
}

// ─── Live JSON Preview ──────────────────────────────────────────────────────

function initJsonPreview() {
  const details = document.getElementById('json-preview-toggle')?.closest('details');
  if (details) {
    details.addEventListener('toggle', () => {
      if (details.open) {
        updateJsonPreview(getState());
      }
    });
  }
}

function updateJsonPreview(state) {
  const el = document.getElementById('json-preview');
  const details = el?.closest('details');
  if (!el || (details && !details.open)) return;
  // In multi-rack mode, show all devices from all racks
  if (state.multiRackEnabled && state.racks.length > 0) {
    const allData = [];
    for (const rack of state.racks) {
      const devs = state.devices.filter(d => d.rackId === rack.id);
      allData.push(...toNetBoxJSON(devs, rack));
    }
    el.textContent = JSON.stringify(allData, null, 2);
  } else {
    const data = toNetBoxJSON(state.devices, state.rackConfig);
    el.textContent = JSON.stringify(data, null, 2);
  }
}

// ─── Storage indicator ──────────────────────────────────────────────────────

function initStorageIndicator() {
  document.getElementById('clear-cache-btn').addEventListener('click', () => {
    if (confirm(t('confirm_clear_cache'))) {
      // Keep theme and language preferences
      const theme = localStorage.getItem('rackbuilder_theme');
      const lang = localStorage.getItem('rackbuilder_lang');

      // Remove all rackbuilder keys
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('rackbuilder')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));

      // Restore preferences
      if (theme) localStorage.setItem('rackbuilder_theme', theme);
      if (lang) localStorage.setItem('rackbuilder_lang', lang);

      dispatch('CLEAR_STATE');
    }
  });
}

function updateStorageIndicator() {
  const { usedBytes, limitBytes } = getLocalStorageUsage();
  const usedKB = (usedBytes / 1024).toFixed(1);
  const limitMB = (limitBytes / (1024 * 1024)).toFixed(0);
  const percent = Math.min(100, (usedBytes / limitBytes) * 100);

  document.getElementById('storage-usage-text').textContent = `${usedKB} KB / ${limitMB} MB`;

  const fill = document.getElementById('storage-bar-fill');
  fill.style.width = `${percent}%`;
  fill.classList.remove('warning', 'critical');
  if (percent > 90) {
    fill.classList.add('critical');
  } else if (percent > 70) {
    fill.classList.add('warning');
  }
}

// ─── HE Selection / Reserved Units ──────────────────────────────────────────

let lastSyncedReserved = null;

function syncReservedUnitsToForm() {
  const reserved = getReservedUnits();
  const key = JSON.stringify(reserved);
  if (key === lastSyncedReserved) return;
  lastSyncedReserved = key;

  const bulkOpen = document.getElementById('bulk-content')?.classList.contains('open');

  if (!bulkOpen && reserved.length === 1) {
    // Single mode: update position field and face (only if user isn't typing)
    const posInput = document.getElementById('dev-position');
    if (document.activeElement !== posInput) {
      const r = reserved[0];
      posInput.value = r.unit;
      const faceRadio = document.querySelector(`input[name="dev-face"][value="${r.face}"]`);
      if (faceRadio) faceRadio.checked = true;
    }
  }

  if (bulkOpen && reserved.length > 0) {
    // Update bulk positions field from clicked cells (only if user isn't typing)
    const posInput = document.getElementById('bulk-positions');
    if (document.activeElement !== posInput) {
      const sorted = [...reserved].sort((a, b) => a.unit - b.unit);
      posInput.value = sorted.map(r => r.unit).join(', ');
      // Auto-increase quantity if more positions selected than current qty
      const qtyInput = document.getElementById('bulk-qty');
      if (reserved.length > parseInt(qtyInput.value)) {
        qtyInput.value = reserved.length;
      }
    }
  }
}

function initBulkPositionHighlight() {
  const bulkPositionsInput = document.getElementById('bulk-positions');
  const bulkQtyInput = document.getElementById('bulk-qty');
  bulkPositionsInput.addEventListener('input', () => {
    const value = bulkPositionsInput.value.trim();
    if (!value) {
      clearReservedUnits();
      return;
    }
    const positions = parsePositionList(value);
    // Auto-update quantity to match number of positions
    if (positions.length > 0) {
      bulkQtyInput.value = positions.length;
    }
    const face = document.querySelector('input[name="dev-face"]:checked')?.value || 'front';
    setReservedUnits(positions.map(unit => ({ unit, face })));
  });
}

// ─── Rack Tabs (Multi-Rack) ──────────────────────────────────────────────────

function renderRackTabs(state) {
  const container = document.getElementById('rack-tabs');
  if (!container) return;

  if (!state.multiRackEnabled || state.racks.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  container.innerHTML = state.racks.map(rack => {
    const devs = state.devices.filter(d => d.rackId === rack.id);
    const stats = getRackUtilization(devs, rack.totalUnits);
    const isActive = rack.id === state.activeRackId;
    return `<button class="rack-tab${isActive ? ' active' : ''}" data-rack-id="${rack.id}">
      <span class="rack-tab-name">${rack.name}</span>
      <span class="rack-tab-info">${rack.totalUnits}U · ${stats.totalPercent}%</span>
    </button>`;
  }).join('');

  container.querySelectorAll('.rack-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      dispatch('SET_ACTIVE_RACK', tab.dataset.rackId);
    });
  });
}

// ─── Undo/Redo ──────────────────────────────────────────────────────────────

function initUndoRedo() {
  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('redo-btn').addEventListener('click', redo);
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  document.getElementById('undo-btn').disabled = !canUndo();
  document.getElementById('redo-btn').disabled = !canRedo();
}

// ─── Accordion animations ────────────────────────────────────────────────────

function initAccordionAnimations() {
  document.querySelectorAll('.sidebar-accordion').forEach(details => {
    const summary = details.querySelector('.sidebar-accordion-header');
    const body = details.querySelector('.sidebar-accordion-body');
    if (!summary || !body) return;

    let isAnimating = false;

    summary.addEventListener('click', (e) => {
      e.preventDefault();
      if (isAnimating) return;
      isAnimating = true;

      if (details.open) {
        // ── Close ──
        // 1. Lock current height so the browser has a start value
        body.style.height = body.scrollHeight + 'px';
        body.style.opacity = '1';
        body.style.paddingTop = getComputedStyle(body).paddingTop;
        body.style.paddingBottom = getComputedStyle(body).paddingBottom;

        // 2. Enable transition after one frame, then set target values
        requestAnimationFrame(() => {
          body.classList.add('accordion-animating');
          requestAnimationFrame(() => {
            body.style.height = '0px';
            body.style.opacity = '0';
            body.style.paddingTop = '0px';
            body.style.paddingBottom = '0px';
          });
        });

        // 3. Clean up after transition finishes (listen only for height)
        body.addEventListener('transitionend', function handler(ev) {
          if (ev.propertyName !== 'height') return;
          body.removeEventListener('transitionend', handler);
          details.removeAttribute('open');
          body.classList.remove('accordion-animating');
          body.style.height = '';
          body.style.opacity = '';
          body.style.paddingTop = '';
          body.style.paddingBottom = '';
          isAnimating = false;
        });
      } else {
        // ── Open ──
        // 1. Set open so content renders (needed to measure scrollHeight)
        details.setAttribute('open', '');

        // 2. Start from collapsed
        const targetHeight = body.scrollHeight;
        body.style.height = '0px';
        body.style.opacity = '0';
        body.style.paddingTop = '0px';
        body.style.paddingBottom = '0px';

        // 3. Enable transition after one frame, then set target values
        requestAnimationFrame(() => {
          body.classList.add('accordion-animating');
          requestAnimationFrame(() => {
            body.style.height = targetHeight + 'px';
            body.style.opacity = '1';
            body.style.paddingTop = '';
            body.style.paddingBottom = '';
          });
        });

        // 4. Clean up
        body.addEventListener('transitionend', function handler(ev) {
          if (ev.propertyName !== 'height') return;
          body.removeEventListener('transitionend', handler);
          body.classList.remove('accordion-animating');
          body.style.height = '';
          body.style.opacity = '';
          isAnimating = false;
        });
      }
    });
  });
}

// ─── Responsive Sidebar Drawers ──────────────────────────────────────────────

function initResponsiveSidebars() {
  const leftToggle  = document.getElementById('sidebar-toggle-left');
  const rightToggle = document.getElementById('sidebar-toggle-right');
  const backdrop    = document.getElementById('sidebar-backdrop');
  const sidebar      = document.querySelector('.sidebar');
  const sidebarRight = document.querySelector('.sidebar-right');

  function closeSidebars() {
    sidebar?.classList.remove('sidebar--open');
    sidebarRight?.classList.remove('sidebar--open');
    backdrop?.classList.remove('visible');
  }

  leftToggle?.addEventListener('click', () => {
    const wasOpen = sidebar?.classList.contains('sidebar--open');
    closeSidebars();
    if (!wasOpen) { sidebar?.classList.add('sidebar--open'); backdrop?.classList.add('visible'); }
  });

  rightToggle?.addEventListener('click', () => {
    const wasOpen = sidebarRight?.classList.contains('sidebar--open');
    closeSidebars();
    if (!wasOpen) { sidebarRight?.classList.add('sidebar--open'); backdrop?.classList.add('visible'); }
  });

  backdrop?.addEventListener('click', closeSidebars);
}

// Start
document.addEventListener('DOMContentLoaded', init);
