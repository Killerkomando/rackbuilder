// Rack Builder — application shell: header menus, version popover, status bar.

import { t } from './i18n.js';
import { getLocalStorageUsage } from './utils.js';
import { dispatch, clearReservedUnits, subscribe, getState, getActiveRackConfig, getActiveDevices } from './state.js';
import { APP_VERSION, EXPECTED_CACHE, getRuntimeInfo } from './version.js';
import { EGG_IDS, getFoundEggs, onEggsChange } from './easter-eggs.js';

// ─── Dropdown menus ─────────────────────────────────────────────────────────

function closeMenus(except) {
  document.querySelectorAll('.menu').forEach(menu => {
    if (menu === except || menu.hidden) return;
    menu.hidden = true;
    document.querySelector(`[data-menu="${menu.id}"]`)?.setAttribute('aria-expanded', 'false');
  });
}

function initMenus() {
  document.querySelectorAll('[data-menu]').forEach(btn => {
    const menu = document.getElementById(btn.dataset.menu);
    if (!menu) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = menu.hidden;
      closeMenus(menu);
      menu.hidden = !opening;
      btn.setAttribute('aria-expanded', String(opening));
      if (opening) {
        menu.dispatchEvent(new CustomEvent('menu-open'));
        if (menu.id !== 'version-menu') menu.querySelector('.menu-item')?.focus();
      }
    });
  });

  // Click outside closes; picking a menu entry closes (the version popover stays open)
  document.addEventListener('click', (e) => {
    const wrap = e.target.closest('.menu-wrap');
    if (!wrap) { closeMenus(); return; }
    if (e.target.closest('.menu-item')) closeMenus();
  });

  document.addEventListener('keydown', (e) => {
    const open = [...document.querySelectorAll('.menu')].find(m => !m.hidden);
    if (!open) return;
    if (e.key === 'Escape') {
      closeMenus();
      document.querySelector(`[data-menu="${open.id}"]`)?.focus();
      return;
    }
    if (open.id === 'version-menu' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const items = [...open.querySelectorAll('.menu-item')];
    if (!items.length) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items[next].focus();
  });
}

// ─── Version popover + status bar ───────────────────────────────────────────

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

export async function refreshVersionInfo() {
  const info = await getRuntimeInfo();
  const label = 'v' + APP_VERSION;
  setText('version-chip-text', label);
  setText('ver-number', label);
  setText('set-ver-number', label);
  setText('status-version-text', label);

  const minimalist = info.edition === 'minimalist';
  setText('ver-source', t(minimalist ? 'ver_source_min' : 'ver_source_main'));

  // Cache: shows which service-worker cache is really serving this page
  let cacheText = '–';
  let mismatch = false;
  if (!minimalist) {
    if (info.cacheNames.length === 0) {
      cacheText = t('ver_cache_none');
    } else if (info.cacheNames.includes(EXPECTED_CACHE)) {
      cacheText = EXPECTED_CACHE;
    } else {
      cacheText = t('ver_cache_mismatch', { cache: info.cacheNames.join(', '), expected: EXPECTED_CACHE });
      mismatch = true;
    }
  }
  setText('ver-cache', cacheText);
  setText('set-ver-cache', cacheText);
  setText('status-cache', minimalist ? '' : (info.cacheNames.includes(EXPECTED_CACHE) ? EXPECTED_CACHE : cacheText));

  let offlineLong;
  let offlineShort;
  if (minimalist) { offlineLong = t('ver_offline_none'); offlineShort = t('status_offline_none'); }
  else if (info.serviceWorker === 'active') { offlineLong = t('ver_offline_ready'); offlineShort = t('status_offline_ready'); }
  else if (info.serviceWorker === 'unsupported') { offlineLong = t('ver_offline_unsupported'); offlineShort = t('ver_offline_unsupported'); }
  else { offlineLong = t('ver_offline_pending'); offlineShort = t('status_offline_pending'); }
  setText('ver-offline', offlineLong);
  setText('set-ver-offline', offlineLong);
  setText('status-offline', offlineShort);

  document.querySelectorAll('#version-btn .led, .status-version .led').forEach(led => {
    led.classList.toggle('led--warn', mismatch);
    led.classList.toggle('led--ok', !mismatch);
  });
  document.getElementById('app-status')?.classList.toggle('app-status--offline', !info.online);
}

function renderEggCounter() {
  const found = getFoundEggs();
  const dots = document.getElementById('egg-dots');
  if (dots) {
    dots.innerHTML = EGG_IDS.map(id => `<i class="egg-dot${found.has(id) ? ' found' : ''}"></i>`).join('');
  }
  setText('egg-count', `${found.size}/${EGG_IDS.length}`);
}

function initVersion() {
  refreshVersionInfo();
  renderEggCounter();
  onEggsChange(renderEggCounter);
  document.getElementById('version-menu')?.addEventListener('menu-open', refreshVersionInfo);
  window.addEventListener('online', refreshVersionInfo);
  window.addEventListener('offline', refreshVersionInfo);
  navigator.serviceWorker?.addEventListener?.('controllerchange', refreshVersionInfo);
  // Language switch re-renders the dynamic texts
  document.getElementById('lang-btn')?.addEventListener('click', () => setTimeout(() => { refreshVersionInfo(); updateDeviceStatus(getState()); }, 0));

  document.getElementById('ver-reload')?.addEventListener('click', async () => {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      await Promise.all((regs || []).map(r => r.update()));
    } catch { /* offline or unsupported — just reload */ }
    location.reload();
  });
}

function updateDeviceStatus(state) {
  const cfg = getActiveRackConfig(state);
  const n = getActiveDevices(state).length;
  setText('status-devices', t('status_devices', { n, rack: cfg.name }));
}

// ─── "New device" button ────────────────────────────────────────────────────

function initNewDeviceButton() {
  document.getElementById('new-device-btn')?.addEventListener('click', () => {
    dispatch('SELECT_DEVICE', null);
    clearReservedUnits();
    // On small screens the form lives in the right drawer
    const toggle = document.getElementById('sidebar-toggle-right');
    const drawer = document.querySelector('.sidebar-right');
    if (toggle && drawer && getComputedStyle(toggle).display !== 'none' && !drawer.classList.contains('sidebar--open')) {
      toggle.click();
    }
    document.getElementById('dev-name')?.focus();
  });
}

// ─── Layout metrics (header / status bar heights as CSS variables) ──────────

function initLayoutMetrics() {
  const root = document.documentElement;
  const header = document.querySelector('.app-header');
  const status = document.querySelector('.app-status');
  const apply = () => {
    if (header) root.style.setProperty('--header-h', header.offsetHeight + 'px');
    if (status) root.style.setProperty('--status-h', status.offsetHeight + 'px');
  };
  apply();
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(apply);
    if (header) ro.observe(header);
    if (status) ro.observe(status);
  }
  window.addEventListener('resize', apply);
}

// ─── Settings: "Data & version" tab ─────────────────────────────────────────

function initSettingsDataTab() {
  const fill = () => {
    const { usedBytes, limitBytes } = getLocalStorageUsage();
    setText('set-storage-text', `${(usedBytes / 1024).toFixed(1)} KB / ${(limitBytes / (1024 * 1024)).toFixed(0)} MB`);
    const bar = document.getElementById('set-storage-fill');
    if (bar) bar.style.width = Math.min(100, (usedBytes / limitBytes) * 100) + '%';
    refreshVersionInfo();
  };
  document.getElementById('settings-btn')?.addEventListener('click', fill);
  document.querySelector('.modal-tab[data-tab="data"]')?.addEventListener('click', fill);
  const proxy = (from, to) => document.getElementById(from)?.addEventListener('click', () => document.getElementById(to)?.click());
  proxy('set-clear-cache', 'clear-cache-btn');
  proxy('set-clear-devices', 'clear-devices-btn');
  proxy('set-reset-all', 'reset-all-btn');
}

// ─── Inspector tabs (Device | JSON preview) ─────────────────────────────────

function initInspectorTabs() {
  const aside = document.querySelector('.sidebar-right');
  const tabDev = document.getElementById('insp-tab-dev');
  const tabJson = document.getElementById('insp-tab-json');
  if (!aside || !tabDev || !tabJson) return;
  const show = (json) => {
    aside.classList.toggle('inspector--json', json);
    tabDev.classList.toggle('on', !json);
    tabJson.classList.toggle('on', json);
    if (json) {
      const details = document.querySelector('.sidebar-accordion');
      if (details) details.open = true;
    }
  };
  tabDev.addEventListener('click', () => show(false));
  tabJson.addEventListener('click', () => show(true));
}

export function initShell() {
  initInspectorTabs();
  initSettingsDataTab();
  initLayoutMetrics();
  initMenus();
  initVersion();
  initNewDeviceButton();
  updateDeviceStatus(getState());
  subscribe(updateDeviceStatus);
}
