// Utility helpers for Rack Builder

/**
 * Generate a unique ID (UUID v4)
 */
export function generateId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Generate a naming sequence.
 * @param {string} baseName - Base name for devices
 * @param {number} count - Number of names to generate
 * @param {number|string} startFrom - Starting number (1) or letter ("A")
 * @param {"numeric"|"alpha"} mode - Numbering mode
 * @returns {string[]}
 */
export function generateSequence(baseName, count, startFrom, mode) {
  const names = [];
  if (mode === 'alpha') {
    let charCode;
    if (typeof startFrom === 'string' && /^[a-zA-Z]$/.test(startFrom)) {
      charCode = startFrom.toUpperCase().charCodeAt(0);
    } else {
      charCode = 65; // default to 'A'
    }
    for (let i = 0; i < count; i++) {
      names.push(`${baseName}${String.fromCharCode(charCode + i)}`);
    }
  } else {
    const start = typeof startFrom === 'number' ? startFrom : parseInt(startFrom, 10) || 1;
    for (let i = 0; i < count; i++) {
      names.push(`${baseName}${start + i}`);
    }
  }
  return names;
}

/**
 * Get localStorage usage statistics.
 */
export function getLocalStorageUsage() {
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    total += key.length + localStorage.getItem(key).length;
  }
  return { usedChars: total, usedBytes: total * 2, limitBytes: 5 * 1024 * 1024 };
}

/**
 * Parse a comma-separated list of positions.
 * @param {string} input - e.g. "10, 20, 24"
 * @returns {number[]}
 */
export function parsePositionList(input) {
  return input
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n) && n > 0);
}

/**
 * Trigger a browser download for text or binary content.
 * @param {string|Uint8Array|Blob} content
 * @param {string} filename
 * @param {string} mimeType
 */
export function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Close a <dialog> with the closing animation (falls back after 300 ms).
 * @param {HTMLDialogElement} dialog
 */
export function closeDialogAnimated(dialog) {
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

/**
 * App-styled replacements for window.confirm / window.alert.
 * uiConfirm resolves true/false, uiAlert resolves when dismissed. Dialogs queue.
 */
let uiT = (k) => k;
export function setUiTranslator(fn) { uiT = fn; }
let uiDialogQueue = Promise.resolve();
function uiDialogOpen({ title, message, confirmLabel, cancelLabel, danger, kind }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'ui-dialog ui-dialog--' + kind + (danger ? ' ui-dialog--danger' : '');
    dlg.setAttribute('role', kind === 'confirm' ? 'alertdialog' : 'dialog');
    const icon = kind === 'confirm' && danger
      ? '<path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>'
      : kind === 'confirm'
        ? '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 115 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01"/>'
        : '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>';
    dlg.innerHTML =
      '<div class="ui-dialog__icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg></div>' +
      '<div class="ui-dialog__body"><h2 class="ui-dialog__title"></h2><p class="ui-dialog__msg"></p></div>' +
      '<div class="ui-dialog__actions"></div>';
    dlg.querySelector('.ui-dialog__title').textContent = title;
    dlg.querySelector('.ui-dialog__msg').textContent = message;
    const actions = dlg.querySelector('.ui-dialog__actions');
    let result = false;
    const mk = (label, cls, value) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + cls;
      b.textContent = label;
      b.addEventListener('click', () => { result = value; closeDialogAnimated(dlg); });
      actions.appendChild(b);
      return b;
    };
    let focusBtn;
    if (kind === 'confirm') {
      const cancel = mk(cancelLabel, 'btn-secondary', false);
      const ok = mk(confirmLabel, danger ? 'btn-danger' : 'btn-primary', true);
      focusBtn = danger ? cancel : ok;
    } else {
      focusBtn = mk(confirmLabel, 'btn-primary', true);
    }
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    document.body.appendChild(dlg);
    dlg.showModal();
    focusBtn.focus();
  });
}
function uiDialogEnqueue(opts) {
  const run = () => uiDialogOpen(opts);
  const p = uiDialogQueue.then(run, run);
  uiDialogQueue = p.then(() => {}, () => {});
  return p;
}
export function uiConfirm(message, opts = {}) {
  return uiDialogEnqueue({
    kind: 'confirm', message, danger: opts.danger !== false,
    title: opts.title || uiT('dlg_title_confirm'),
    confirmLabel: opts.confirmLabel || uiT('dlg_confirm'),
    cancelLabel: opts.cancelLabel || uiT('btn_dialog_cancel'),
  });
}
export function uiAlert(message, opts = {}) {
  return uiDialogEnqueue({
    kind: 'alert', message, danger: false,
    title: opts.title || uiT('dlg_title_notice'),
    confirmLabel: opts.confirmLabel || uiT('dlg_ok'),
  });
}

/**
 * Show a short status message at the bottom of the screen (screen readers announce it).
 * @param {string} message
 * @param {number} [duration=3000] ms
 */
export function showToast(message, duration = 3000) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.className = 'app-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = message;
  // Restart the transition when a toast is replaced while still visible
  el.classList.remove('app-toast--show');
  void el.offsetWidth;
  el.classList.add('app-toast--show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('app-toast--show'), duration);
}
