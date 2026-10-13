// Inspector detail card (selected device) and rack face switch

import { t } from './i18n.js';
import { getState, dispatch, subscribe, getActiveRackConfig, getActiveDevices } from './state.js';
import { findNextFreeSlot } from './rack-model.js';
import { renderRack, setFaceView } from './rack-view.js';
import { showToast } from './utils.js';

const inspEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let inspLastSelected = null;
let inspDetailMode = false;

function inspDetailHtml(d) {
  const end = d.position + d.height - 1;
  const range = `U${d.position}${d.height > 1 ? '–' + end : ''} · ${d.height} U`;
  const status = d.status || 'active';
  const color = d._color || '#3b82f6';
  const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
  return `
    <div class="insp-head">
      <span class="insp-sw" style="background: ${inspEsc(color)}"></span>
      <div class="insp-title"><h2>${inspEsc(d.name || '(unnamed)')}</h2><div class="insp-type">${inspEsc(d.deviceType)}</div></div>
    </div>
    <dl class="insp-facts">
      ${row(t('label_manufacturer'), inspEsc(d.manufacturer) || '–')}
      ${row(t('label_role'), inspEsc(d.role) || '–')}
      ${row(t('insp_position'), `<span class="mono">${range}</span>`)}
      ${row(t('label_face'), t(d.face === 'front' ? 'col_front' : 'col_rear'))}
      ${row(t('insp_depth'), t(d.fullDepth ? 'depth_full' : 'depth_half'))}
      ${row(t('label_status'), `<span class="insp-status"><i class="dev-led dev-led--${inspEsc(status)}"></i>${inspEsc(t('status_' + status))}</span>`)}
    </dl>
    <div class="insp-actions">
      <button type="button" class="btn btn-primary" data-act="edit">${t('insp_edit')}</button>
      <div class="insp-grid">
        <button type="button" class="btn btn-secondary" data-act="up">${t('insp_up')}</button>
        <button type="button" class="btn btn-secondary" data-act="down">${t('insp_down')}</button>
        <button type="button" class="btn btn-secondary" data-act="flip">${t('insp_flip')}</button>
        <button type="button" class="btn btn-secondary" data-act="dup">${t('insp_dup')}</button>
      </div>
      <button type="button" class="btn btn-secondary insp-danger" data-act="delete">${t('insp_delete')} <kbd>Del</kbd></button>
      <button type="button" class="btn btn-ghost" data-act="clear">${t('insp_clear')} <kbd>Esc</kbd></button>
    </div>`;
}

function inspSync(state) {
  const aside = document.querySelector('.sidebar-right');
  const box = document.getElementById('inspector-detail');
  if (!aside || !box) return;
  const sel = state.selectedDeviceId;
  if (sel !== inspLastSelected) { inspLastSelected = sel; inspDetailMode = !!sel; }
  const device = sel ? state.devices.find(d => d.id === sel) : null;
  if (!device) inspDetailMode = false;
  aside.classList.toggle('inspector--detail', inspDetailMode);
  if (inspDetailMode) box.innerHTML = inspDetailHtml(device);
}

function inspReport(result) {
  if (result && result.ok === false) showToast(t('insp_cannot'));
}

function inspAct(action) {
  const state = getState();
  const cfg = getActiveRackConfig(state);
  const d = state.devices.find(x => x.id === state.selectedDeviceId);
  if (!d) return;
  switch (action) {
    case 'edit':
      inspDetailMode = false;
      document.querySelector('.sidebar-right')?.classList.remove('inspector--detail');
      document.getElementById('dev-name')?.focus();
      break;
    case 'up':
    case 'down': {
      const higherIsUp = cfg.numberingDirection === 'bottom-to-top';
      const step = (action === 'up') === higherIsUp ? 1 : -1;
      inspReport(dispatch('MOVE_DEVICE', { id: d.id, position: d.position + step, face: d.face }));
      break;
    }
    case 'flip':
      inspReport(dispatch('MOVE_DEVICE', { id: d.id, position: d.position, face: d.face === 'front' ? 'rear' : 'front' }));
      break;
    case 'dup': {
      const pos = findNextFreeSlot(getActiveDevices(state), d.height, d.face, cfg.totalUnits, 1, d.fullDepth);
      if (pos === null) { showToast(t('insp_no_slot')); break; }
      const { id: _id, ...copy } = d;
      const result = dispatch('ADD_DEVICE', { ...copy, name: `${d.name} (2)`, position: pos });
      inspReport(result);
      if (result?.ok && result.device) dispatch('SELECT_DEVICE', result.device.id);
      break;
    }
    case 'delete':
      dispatch('REMOVE_DEVICE', d.id);
      break;
    case 'clear':
      dispatch('SELECT_DEVICE', null);
      break;
  }
}

// ─── Form helpers: steppers and the "Position: U6 · Front" subline ─────────

function formSubline() {
  const el = document.getElementById('form-sub');
  if (!el) return;
  const pos = (document.getElementById('dev-position')?.value || '').trim();
  const face = document.querySelector('input[name="dev-face"]:checked')?.value || 'front';
  const posText = !pos || pos === 'auto' ? t('form_pos_auto') : (/^\d+$/.test(pos) ? `U${pos}` : pos);
  el.innerHTML = `${t('form_pos_label')}: <b class="mono">${inspEsc(posText)}</b> · ${t(face === 'front' ? 'col_front' : 'col_rear')}`;
}

function initFormUi() {
  const form = document.getElementById('device-form');
  if (!form) return;
  form.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-step]');
    if (!btn) return;
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    const min = input.min !== '' ? parseInt(input.min, 10) : 1;
    const max = input.max !== '' ? parseInt(input.max, 10) : 999;
    const cur = parseInt(input.value, 10);
    const next = Math.max(min, Math.min(max, (Number.isNaN(cur) ? min : cur) + parseInt(btn.dataset.step, 10)));
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const numSel = document.getElementById('bulk-numbering');
  const numSeg = document.getElementById('bulk-numbering-seg');
  const syncNum = () => {
    if (!numSel || !numSeg) return;
    numSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.val === numSel.value));
  };
  numSeg?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-val]');
    if (!b || !numSel) return;
    numSel.value = b.dataset.val;
    numSel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  form.addEventListener('change', syncNum);
  form.addEventListener('reset', () => setTimeout(syncNum, 0));
  subscribe(syncNum);
  syncNum();
  form.addEventListener('input', formSubline);
  form.addEventListener('change', formSubline);
  document.getElementById('rack-view')?.addEventListener('click', () => setTimeout(formSubline, 0));
  subscribe(formSubline);
  document.getElementById('lang-btn')?.addEventListener('click', () => setTimeout(formSubline, 0));
  formSubline();
}

export function initInspector() {
  initFormUi();
  document.getElementById('inspector-detail')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) inspAct(btn.dataset.act);
  });
  document.getElementById('face-view')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    setFaceView(btn.dataset.view);
    renderRack(getState());
  });
  subscribe(inspSync);
  inspSync(getState());
  document.getElementById('lang-btn')?.addEventListener('click', () => setTimeout(() => inspSync(getState()), 0));
}
