// Rack Builder — Main application bootstrap

import { getState, subscribe, dispatch, undo, redo, canUndo, canRedo, getReservedUnits, setReservedUnits, clearReservedUnits, getActiveRackConfig, getActiveDevices } from './state.js';
import { renderRack } from './rack-view.js';
import { getLocalStorageUsage, parsePositionList, generateId } from './utils.js';
import { getRackUtilization, toNetBoxJSON } from './rack-model.js';
import { initDeviceForm, populateFormForEdit } from './device-form.js';
import { initDragDrop } from './drag-drop.js';
import { initExport } from './export.js';
import { t, getCurrentLang, setLang, applyTranslations } from './i18n.js';
import { initNetboxAutocomplete, refreshDatalists } from './netbox-autocomplete.js';

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

  container.innerHTML = sorted.map(d => `
    <div class="device-list-item${d.id === selectedDeviceId ? ' selected' : ''}" data-device-id="${d.id}">
      <div class="device-info">
        <span class="device-color" style="background: ${d._color || '#3b82f6'}"></span>
        <span>${d.name || '(unnamed)'}</span>
      </div>
      <span class="device-pos">U${d.position}${d.height > 1 ? '-' + (d.position + d.height - 1) : ''} ${d.face}</span>
      <button class="device-delete" data-device-id="${d.id}" title="Delete">&times;</button>
    </div>
  `).join('');

  container.querySelectorAll('.device-list-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.device-delete')) return;
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
    modal.showModal();
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
  dialog.classList.add('dialog-closing');
  dialog.addEventListener('animationend', function handler() {
    dialog.classList.remove('dialog-closing');
    dialog.close();
    dialog.removeEventListener('animationend', handler);
  });
}

// ─── Keyboard shortcuts ──────────────────────────────────────────────────────

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Undo/Redo work even in inputs
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
      return;
    }

    if (e.target.matches('input, textarea, select')) return;

    const state = getState();

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedDeviceId) {
        dispatch('REMOVE_DEVICE', state.selectedDeviceId);
      }
    }

    if (e.key === 'Escape') {
      if (state.selectedDeviceId) {
        dispatch('SELECT_DEVICE', null);
      }
    }
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

// Start
document.addEventListener('DOMContentLoaded', init);
