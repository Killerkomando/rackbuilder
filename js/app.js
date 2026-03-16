// Rack Builder — Main application bootstrap

import { getState, subscribe, dispatch, undo, redo, canUndo, canRedo } from './state.js';
import { renderRack } from './rack-view.js';
import { getLocalStorageUsage } from './utils.js';
import { getRackUtilization, toNetBoxJSON } from './rack-model.js';
import { initDeviceForm, populateFormForEdit } from './device-form.js';
import { initDragDrop } from './drag-drop.js';
import { initExport } from './export.js';
import { t, getCurrentLang, setLang, applyTranslations } from './i18n.js';

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
    renderRack(state);
    renderDeviceList(state);
    handleSelection(state);
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
  const { devices, selectedDeviceId } = state;

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

  document.getElementById('settings-btn').addEventListener('click', () => {
    const { rackConfig } = getState();
    document.getElementById('setting-name').value = rackConfig.name;
    document.getElementById('setting-units').value = rackConfig.totalUnits;
    document.getElementById('setting-direction').value = rackConfig.numberingDirection;
    document.getElementById('setting-site').value = rackConfig.site;
    document.getElementById('setting-location').value = rackConfig.location;
    document.getElementById('setting-front-color').value = rackConfig.frontColor || '#3b82f6';
    document.getElementById('setting-rear-color').value = rackConfig.rearColor || '#f97316';
    modal.showModal();
  });

  document.getElementById('settings-cancel').addEventListener('click', () => {
    modal.close();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    dispatch('UPDATE_RACK_CONFIG', {
      name: document.getElementById('setting-name').value.trim(),
      totalUnits: parseInt(document.getElementById('setting-units').value) || 42,
      numberingDirection: document.getElementById('setting-direction').value,
      site: document.getElementById('setting-site').value.trim(),
      location: document.getElementById('setting-location').value.trim(),
      frontColor: document.getElementById('setting-front-color').value,
      rearColor: document.getElementById('setting-rear-color').value,
    });
    modal.close();
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
  const stats = getRackUtilization(state.devices, state.rackConfig.totalUnits);
  const el = document.getElementById('rack-stats');
  if (el) {
    el.textContent = `${stats.totalPercent}% ${t('stat_used')} (F: ${stats.frontPercent}% | R: ${stats.rearPercent}%)`;
  }
}

// ─── Live JSON Preview ──────────────────────────────────────────────────────

function initJsonPreview() {
  document.getElementById('json-preview-toggle').addEventListener('click', () => {
    const el = document.getElementById('json-preview');
    const isHidden = el.style.display === 'none' || !el.style.display;
    el.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
      updateJsonPreview(getState());
    }
  });
}

function updateJsonPreview(state) {
  const el = document.getElementById('json-preview');
  if (!el || el.style.display === 'none') return;
  const data = toNetBoxJSON(state.devices, state.rackConfig);
  el.textContent = JSON.stringify(data, null, 2);
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

// Start
document.addEventListener('DOMContentLoaded', init);
