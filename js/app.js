// Rack Builder — Main application bootstrap

import { getState, subscribe, dispatch } from './state.js';
import { renderRack } from './rack-view.js';
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
  });

  // Initialize modules
  initDeviceForm();
  initDragDrop();
  initExport();
  initSettings();
  initKeyboardShortcuts();
  initClearButton();

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
    });
    modal.close();
  });
}

// ─── Keyboard shortcuts ──────────────────────────────────────────────────────

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
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

// Start
document.addEventListener('DOMContentLoaded', init);
