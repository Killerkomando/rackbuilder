// Rack Builder — easter eggs.
//
// Five hidden surprises. Found eggs are remembered in localStorage and counted in the version popover.
//   blink  — click the logo 5 times
//   tea    — search the device list for "418"
//   code   — click the codename in the version popover 3 times
//   cable  — click the footer credit
//   disco  — enter the Konami code (up up down down left right left right B A)

import { t } from './i18n.js';
import { showToast } from './utils.js';
import { APP_CODENAME } from './version.js';

export const EGG_IDS = ['blink', 'tea', 'code', 'cable', 'disco'];
const STORAGE_KEY = 'rackbuilder_eggs';
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

const listeners = new Set();
let found = new Set();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    found = new Set(Array.isArray(raw) ? raw.filter(id => EGG_IDS.includes(id)) : []);
  } catch {
    found = new Set();
  }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...found])); } catch { /* storage full or blocked */ }
}

export function getFoundEggs() { return new Set(found); }
export function isEggFound(id) { return found.has(id); }
export function onEggsChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Register a find. Shows the message toast (plus counter) the first time only. */
function discover(id, message) {
  const isNew = !found.has(id);
  if (isNew) {
    found.add(id);
    save();
    listeners.forEach(fn => fn(getFoundEggs()));
  }
  const suffix = isNew ? '  ·  ' + t('egg_found', { n: found.size, total: EGG_IDS.length }) : '';
  showToast(message + suffix, 4200);
  return isNew;
}

function flash(el, cls, ms) {
  if (!el) return;
  el.classList.add(cls);
  clearTimeout(el['_t_' + cls]);
  el['_t_' + cls] = setTimeout(() => el.classList.remove(cls), ms);
}

// ── blink: logo x5 ─────────────────────────────────────────────────────────

function initBlink() {
  const logo = document.getElementById('app-logo-btn');
  if (!logo) return;
  let count = 0;
  let timer = null;
  logo.addEventListener('click', () => {
    count++;
    clearTimeout(timer);
    timer = setTimeout(() => { count = 0; }, 1500);
    if (count >= 5) {
      count = 0;
      flash(document.body, 'egg-blink', 6000);
      discover('blink', t('egg_blink'));
    }
  });
}

// ── tea: device search "418" ───────────────────────────────────────────────

function initTeapot() {
  const input = document.getElementById('device-search');
  const list = document.getElementById('device-list');
  if (!input || !list) return;
  let pot = document.getElementById('egg-teapot');
  if (!pot) {
    pot = document.createElement('div');
    pot.id = 'egg-teapot';
    pot.className = 'egg-teapot';
    pot.hidden = true;
    list.parentNode.insertBefore(pot, list);
  }
  const render = () => {
    pot.innerHTML = '<svg width="52" height="52" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 30h30v10a12 12 0 01-12 12h-6A12 12 0 0114 40z"/><path d="M44 34h4a6 6 0 010 12h-5"/><path d="M14 32c-4 0-6-3-8-6"/><path d="M26 24c0-3 4-3 4-7M34 24c0-3 4-3 4-7"/></svg>'
      + '<strong></strong><span></span>';
    pot.querySelector('strong').textContent = t('egg_tea_title');
    pot.querySelector('span').textContent = t('egg_tea_text');
  };
  input.addEventListener('input', () => {
    const on = input.value.trim() === '418';
    pot.hidden = !on;
    if (on) { render(); discover('tea', t('egg_tea_title')); }
  });
}

// ── code: codename x3 ──────────────────────────────────────────────────────

function initCodename() {
  const btn = document.getElementById('ver-codename');
  if (!btn) return;
  let count = 0;
  let timer = null;
  const paint = () => { btn.textContent = found.has('code') ? APP_CODENAME : '????????'; };
  paint();
  onEggsChange(paint);
  btn.addEventListener('click', () => {
    if (found.has('code')) return;
    count++;
    clearTimeout(timer);
    timer = setTimeout(() => { count = 0; }, 1500);
    if (count >= 3) { count = 0; discover('code', t('egg_code', { name: APP_CODENAME })); }
  });
}

// ── cable: footer credit ───────────────────────────────────────────────────

function initCable() {
  document.getElementById('egg-cable-btn')?.addEventListener('click', () => {
    flash(document.getElementById('rack-view'), 'egg-shake', 1400);
    discover('cable', t('egg_cable'));
  });
}

// ── disco: Konami code ─────────────────────────────────────────────────────

function initKonami() {
  let pos = 0;
  document.addEventListener('keydown', (e) => {
    if (e.target && e.target.matches && e.target.matches('input, textarea, select')) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === KONAMI[pos]) {
      pos++;
      if (pos === KONAMI.length) {
        pos = 0;
        const root = document.documentElement;
        const on = !root.classList.contains('egg-disco');
        root.classList.toggle('egg-disco', on);
        if (on) discover('disco', t('egg_disco_on'));
        else showToast(t('egg_disco_off'));
      }
    } else {
      pos = key === KONAMI[0] ? 1 : 0;
    }
  });
}

export function initEasterEggs() {
  load();
  initBlink();
  initTeapot();
  initCodename();
  initCable();
  initKonami();
}
