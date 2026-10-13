// Rack Builder — command palette (Ctrl/Cmd + K).
//
// Every command simply clicks an existing control, so the palette never duplicates app logic.

import { t } from './i18n.js';
import { getState, dispatch } from './state.js';

function press(id) {
  const el = document.getElementById(id);
  if (el && !el.disabled) el.click();
}

function buildCommands() {
  const cmd = (id, label, run, hint = '') => ({ id, label, run, hint });
  return [
    cmd('new', t('cmd_new_device'), () => press('new-device-btn')),
    cmd('undo', t('btn_undo'), () => press('undo-btn'), 'Ctrl Z'),
    cmd('redo', t('btn_redo'), () => press('redo-btn'), 'Ctrl Y'),
    cmd('json', t('btn_json'), () => press('export-json-btn')),
    cmd('yaml', t('btn_yaml'), () => press('export-yaml-btn')),
    cmd('csv', t('btn_csv'), () => press('export-csv-btn')),
    cmd('copy', t('btn_copy'), () => press('copy-btn')),
    cmd('png', t('btn_export_png'), () => press('export-png-btn')),
    cmd('print', t('btn_print'), () => press('print-btn')),
    cmd('save', t('btn_save_project'), () => press('save-project-btn')),
    cmd('load', t('btn_load_project'), () => press('load-project-btn')),
    cmd('import-json', t('btn_import'), () => press('import-btn')),
    cmd('import-csv', t('btn_import_csv'), () => press('import-csv-btn')),
    cmd('module-import', t('mi_open_btn'), () => press('module-import-btn')),
    cmd('settings', t('btn_settings'), () => press('settings-btn')),
    cmd('theme', t('cmd_toggle_theme'), () => press('theme-btn')),
    cmd('lang', t('cmd_toggle_lang'), () => press('lang-btn')),
    cmd('version', t('cmd_show_version'), () => press('version-btn')),
    cmd('cablemanager', t('menu_cablemanager'), () => { location.href = 'cablemanager/index.html'; }),
  ];
}

function matches(text, tokens) {
  const hay = text.toLowerCase();
  return tokens.every(tok => hay.includes(tok));
}

function buildDeviceEntries(tokens) {
  if (tokens.length === 0) return [];
  const state = getState();
  const multi = state.multiRackEnabled && state.racks.length > 1;
  return state.devices
    .filter(d => matches(`${d.name || ''} ${d.deviceType || ''} ${d.role || ''}`, tokens))
    .slice(0, 8)
    .map(d => {
      const rack = multi ? state.racks.find(r => r.id === d.rackId)?.name : '';
      return {
        id: 'device-' + d.id,
        label: t('cmd_device', { name: d.name || '(unnamed)' }),
        hint: `U${d.position} · ${d.face}${rack ? ' · ' + rack : ''}`,
        run: () => {
          if (d.rackId && d.rackId !== state.activeRackId) dispatch('SET_ACTIVE_RACK', d.rackId);
          dispatch('SELECT_DEVICE', d.id);
        },
      };
    });
}

export function initCommandPalette() {
  const dialog = document.getElementById('command-palette');
  const input = document.getElementById('cmd-input');
  const list = document.getElementById('cmd-list');
  if (!dialog || !input || !list) return;

  let entries = [];
  let active = 0;

  function render() {
    const tokens = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const commands = buildCommands().filter(c => matches(c.label, tokens));
    const devices = buildDeviceEntries(tokens);
    entries = [...commands, ...devices];
    active = Math.min(active, Math.max(0, entries.length - 1));

    if (entries.length === 0) {
      list.innerHTML = `<div class="palette-empty">${t('cmd_none')}</div>`;
      return;
    }
    let html = '';
    let idx = 0;
    const group = (title, items) => {
      if (!items.length) return;
      html += `<div class="palette-group">${title}</div>`;
      for (const it of items) {
        html += `<button type="button" class="palette-item${idx === active ? ' active' : ''}" role="option" aria-selected="${idx === active}" data-idx="${idx}">`
          + `<span class="palette-label"></span>${it.hint ? `<kbd>${it.hint}</kbd>` : ''}</button>`;
        idx++;
      }
    };
    group(t('cmd_group_commands'), commands);
    group(t('cmd_group_devices'), devices);
    list.innerHTML = html;
    // Labels are inserted as text (device names are user input)
    list.querySelectorAll('.palette-item').forEach(btn => {
      btn.querySelector('.palette-label').textContent = entries[+btn.dataset.idx].label;
    });
    list.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    if (dialog.open) return;
    if (document.querySelector('dialog[open]')) return; // another modal is active
    input.value = '';
    active = 0;
    render();
    dialog.showModal();
    input.focus();
  }

  function runEntry(i) {
    const entry = entries[i];
    if (!entry) return;
    dialog.close(); // immediate, so follow-up focus changes are not blocked by the modal
    entry.run();
  }

  input.addEventListener('input', () => { active = 0; render(); });

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!entries.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runEntry(active);
    }
    e.stopPropagation(); // keep global shortcuts (Esc deselect etc.) out of the palette
  });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.palette-item');
    if (btn) runEntry(+btn.dataset.idx);
  });
  list.addEventListener('mousemove', (e) => {
    const btn = e.target.closest('.palette-item');
    if (btn && +btn.dataset.idx !== active) {
      active = +btn.dataset.idx;
      list.querySelectorAll('.palette-item').forEach(b => {
        const on = +b.dataset.idx === active;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
    }
  });

  // Click on the backdrop closes
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  document.getElementById('cmd-btn')?.addEventListener('click', open);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (dialog.open) dialog.close(); else open();
    }
  });
}
