// NetBox Device Types, Roles & Manufacturers Autocomplete (Opt-In)
// Stores only {name, slug} per entry in localStorage to stay under 5 MB.
// Uses a custom dropdown instead of native <datalist> for modern look & feel.

import { t } from './i18n.js';

const STORAGE_KEY_TYPES = 'rackbuilder_netbox_device_types';
const STORAGE_KEY_ROLES = 'rackbuilder_netbox_roles';
const STORAGE_KEY_MANUFACTURERS = 'rackbuilder_netbox_manufacturers';

// ─── Storage helpers ─────────────────────────────────────────────────────────

function loadEntries(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveEntries(key, entries) {
  localStorage.setItem(key, JSON.stringify(entries));
}

export function getDeviceTypes() { return loadEntries(STORAGE_KEY_TYPES); }
export function getRoles() { return loadEntries(STORAGE_KEY_ROLES); }
export function getManufacturers() { return loadEntries(STORAGE_KEY_MANUFACTURERS); }

export function clearDeviceTypes() { localStorage.removeItem(STORAGE_KEY_TYPES); }
export function clearRoles() { localStorage.removeItem(STORAGE_KEY_ROLES); }
export function clearManufacturers() { localStorage.removeItem(STORAGE_KEY_MANUFACTURERS); }

// ─── Extract name + slug from parsed items ───────────────────────────────────

function extractNameSlug(items) {
  if (!Array.isArray(items)) return null;
  const result = items
    .filter(entry => entry && (entry.name || entry.slug || entry.display || entry.model))
    .map(entry => ({
      name: entry.display || entry.model || entry.name || entry.slug,
      slug: entry.slug || (entry.model || entry.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    }));
  return result.length > 0 ? result : null;
}

// ─── Format parsers ──────────────────────────────────────────────────────────

function parseJSON(text) {
  const json = JSON.parse(text);
  if (json && typeof json === 'object' && !Array.isArray(json) && Array.isArray(json.results)) {
    return json.results;
  }
  if (Array.isArray(json)) return json;
  // Single device type object (e.g. from NetBox device type library)
  if (json && typeof json === 'object' && !Array.isArray(json) && (json.model || json.slug || json.name)) {
    return [json];
  }
  return null;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(sep).map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());
  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(sep).map(v => v.trim().replace(/^["']|["']$/g, ''));
    if (vals.length < headers.length) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx]; });
    items.push(obj);
  }
  return items.length > 0 ? items : null;
}

function parseYAML(text) {
  // First, extract top-level key-value pairs (for single device type files)
  const topLevel = {};
  let hasTopLevel = false;
  let hasRootList = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.match(/^-\s/)) { hasRootList = true; break; }
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kvMatch && kvMatch[2] && !kvMatch[2].trimStart().startsWith('')) {
      topLevel[kvMatch[1]] = kvMatch[2].replace(/^["']|["']$/g, '');
      hasTopLevel = true;
    } else if (line.match(/^(\w[\w-]*):\s*$/) || line.match(/^\s/)) {
      // Nested block or empty value — stop collecting top-level scalars for this key
    }
  }

  // If we have a single device type file (has model or slug at top level), return it
  if (hasTopLevel && !hasRootList && (topLevel.model || topLevel.slug || topLevel.name)) {
    return [topLevel];
  }

  // Otherwise parse as list of items (standard list format)
  const items = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const listMatch = line.match(/^-\s+(.*)/);
    if (listMatch) {
      if (current) items.push(current);
      current = {};
      const rest = listMatch[1].trim();
      const inlineMatch = rest.match(/^\{(.*)\}$/);
      if (inlineMatch) {
        for (const pair of inlineMatch[1].split(',')) {
          const [k, ...vParts] = pair.split(':');
          if (k && vParts.length) {
            current[k.trim().replace(/^["']|["']$/g, '')] = vParts.join(':').trim().replace(/^["']|["']$/g, '');
          }
        }
      } else {
        const kvMatch = rest.match(/^(\w+):\s*(.*)/);
        if (kvMatch) {
          current[kvMatch[1]] = kvMatch[2].replace(/^["']|["']$/g, '');
        }
      }
    } else if (current) {
      const kvMatch = line.match(/^\s+(\w+):\s*(.*)/);
      if (kvMatch) {
        current[kvMatch[1]] = kvMatch[2].replace(/^["']|["']$/g, '');
      }
    }
  }
  if (current) items.push(current);
  return items.length > 0 ? items : null;
}

function detectAndParse(text, filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (ext === 'json') return parseJSON(text);
  if (ext === 'csv' || ext === 'tsv') return parseCSV(text);
  if (ext === 'yaml' || ext === 'yml') return parseYAML(text);

  const trimmed = text.trimStart();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try { return parseJSON(text); } catch { /* fall through */ }
  }
  if (/^[\w"'].*[,\t]/.test(trimmed.split('\n')[0])) {
    const result = parseCSV(text);
    if (result) return result;
  }
  if (trimmed.startsWith('-')) return parseYAML(text);
  return null;
}

// ─── File upload handler ─────────────────────────────────────────────────────

function handleUpload(fileInput, storageKey, onDone) {
  const file = fileInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const items = detectAndParse(ev.target.result, file.name);
      const entries = items ? extractNameSlug(items) : null;
      if (!entries || entries.length === 0) {
        alert(t('netbox_upload_invalid'));
        return;
      }
      saveEntries(storageKey, entries);
      if (onDone) onDone(entries);
    } catch {
      alert(t('netbox_upload_invalid'));
    }
  };
  reader.readAsText(file);
  fileInput.value = '';
}

// ─── Modern autocomplete dropdown ────────────────────────────────────────────

const MAX_VISIBLE = 8;
const activeDropdowns = new Map(); // inputId → { dropdown, entries, selectedIdx }

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlightMatch(text, query) {
  if (!query) return escapeHTML(text);
  const escaped = escapeHTML(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escaped;
  const before = escapeHTML(text.slice(0, idx));
  const match = escapeHTML(text.slice(idx, idx + query.length));
  const after = escapeHTML(text.slice(idx + query.length));
  return `${before}<mark>${match}</mark>${after}`;
}

function filterEntries(entries, query) {
  if (!query) return entries.slice(0, MAX_VISIBLE * 2);
  const q = query.toLowerCase();
  const starts = [];
  const contains = [];
  for (const e of entries) {
    const nameL = e.name.toLowerCase();
    const slugL = e.slug.toLowerCase();
    if (nameL.startsWith(q) || slugL.startsWith(q)) {
      starts.push(e);
    } else if (nameL.includes(q) || slugL.includes(q)) {
      contains.push(e);
    }
  }
  return [...starts, ...contains].slice(0, MAX_VISIBLE * 2);
}

function createDropdown(input) {
  const dropdown = document.createElement('div');
  dropdown.className = 'ac-dropdown';
  dropdown.setAttribute('role', 'listbox');
  // Position relative to the input's .form-group parent
  const parent = input.closest('.form-group') || input.parentElement;
  parent.style.position = 'relative';
  parent.appendChild(dropdown);
  return dropdown;
}

function renderDropdown(inputId, query) {
  const state = activeDropdowns.get(inputId);
  if (!state) return;
  const { dropdown, entries } = state;
  const filtered = filterEntries(entries, query);
  state.filtered = filtered;
  state.selectedIdx = -1;

  if (filtered.length === 0 || !document.getElementById(inputId).matches(':focus')) {
    dropdown.classList.remove('visible');
    dropdown.innerHTML = '';
    return;
  }

  dropdown.innerHTML = filtered.map((e, i) => {
    const nameHtml = highlightMatch(e.name, query);
    const slugHtml = highlightMatch(e.slug, query);
    return `<div class="ac-option" data-index="${i}" role="option">
      <span class="ac-option-name">${nameHtml}</span>
      <span class="ac-option-slug">${slugHtml}</span>
    </div>`;
  }).join('');

  dropdown.classList.add('visible');
}

function selectOption(inputId, index) {
  const state = activeDropdowns.get(inputId);
  if (!state || !state.filtered || !state.filtered[index]) return;
  const input = document.getElementById(inputId);
  input.value = state.filtered[index].slug;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  closeDropdown(inputId);
}

function closeDropdown(inputId) {
  const state = activeDropdowns.get(inputId);
  if (!state) return;
  state.dropdown.classList.remove('visible');
  state.selectedIdx = -1;
}

function updateHighlight(inputId) {
  const state = activeDropdowns.get(inputId);
  if (!state) return;
  const options = state.dropdown.querySelectorAll('.ac-option');
  options.forEach((el, i) => {
    el.classList.toggle('highlighted', i === state.selectedIdx);
    if (i === state.selectedIdx) {
      el.scrollIntoView({ block: 'nearest' });
    }
  });
}

export function attachAutocomplete(inputId, entries) {
  const input = document.getElementById(inputId);
  if (!input) return;

  // Remove native datalist if present
  input.removeAttribute('list');

  // If already attached, just update entries
  if (activeDropdowns.has(inputId)) {
    activeDropdowns.get(inputId).entries = entries;
    return;
  }

  const dropdown = createDropdown(input);
  activeDropdowns.set(inputId, { dropdown, entries, filtered: [], selectedIdx: -1 });

  input.addEventListener('input', () => {
    const entries = activeDropdowns.get(inputId)?.entries || [];
    if (entries.length === 0) return;
    renderDropdown(inputId, input.value);
  });

  input.addEventListener('focus', () => {
    const entries = activeDropdowns.get(inputId)?.entries || [];
    if (entries.length === 0) return;
    renderDropdown(inputId, input.value);
  });

  input.addEventListener('blur', () => {
    // Delay to allow click on option
    setTimeout(() => closeDropdown(inputId), 180);
  });

  input.addEventListener('keydown', (e) => {
    const state = activeDropdowns.get(inputId);
    if (!state || !state.filtered || state.filtered.length === 0) return;
    if (!state.dropdown.classList.contains('visible')) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.selectedIdx = Math.min(state.selectedIdx + 1, state.filtered.length - 1);
      updateHighlight(inputId);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.selectedIdx = Math.max(state.selectedIdx - 1, 0);
      updateHighlight(inputId);
    } else if (e.key === 'Enter' && state.selectedIdx >= 0) {
      e.preventDefault();
      selectOption(inputId, state.selectedIdx);
    } else if (e.key === 'Escape') {
      closeDropdown(inputId);
    }
  });

  dropdown.addEventListener('mousedown', (e) => {
    const option = e.target.closest('.ac-option');
    if (option) {
      e.preventDefault();
      selectOption(inputId, parseInt(option.dataset.index));
    }
  });
}

// ─── Refresh all autocompletes ───────────────────────────────────────────────

export function refreshAutocompletes() {
  attachAutocomplete('dev-type', getDeviceTypes());
  attachAutocomplete('dev-role', getRoles());
  attachAutocomplete('dev-manufacturer', getManufacturers());
}

// ─── Init ────────────────────────────────────────────────────────────────────

function wireUpload(btnId, fileId, storageKey, onDone) {
  const btn = document.getElementById(btnId);
  const fileInput = document.getElementById(fileId);
  if (!btn || !fileInput) return;
  btn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    handleUpload(fileInput, storageKey, onDone);
  });
}

function wireClear(clearBtnId, storageKey, inputId, statusId) {
  const btn = document.getElementById(clearBtnId);
  if (!btn) return;
  btn.addEventListener('click', () => {
    localStorage.removeItem(storageKey);
    attachAutocomplete(inputId, []);
    updateUploadStatus();
  });
}

export function initNetboxAutocomplete() {
  wireUpload('netbox-upload-types-btn', 'netbox-types-file', STORAGE_KEY_TYPES, () => {
    attachAutocomplete('dev-type', getDeviceTypes());
    updateUploadStatus();
  });
  wireUpload('netbox-upload-roles-btn', 'netbox-roles-file', STORAGE_KEY_ROLES, () => {
    attachAutocomplete('dev-role', getRoles());
    updateUploadStatus();
  });
  wireUpload('netbox-upload-mfr-btn', 'netbox-mfr-file', STORAGE_KEY_MANUFACTURERS, () => {
    attachAutocomplete('dev-manufacturer', getManufacturers());
    updateUploadStatus();
  });

  wireClear('netbox-clear-types-btn', STORAGE_KEY_TYPES, 'dev-type');
  wireClear('netbox-clear-roles-btn', STORAGE_KEY_ROLES, 'dev-role');
  wireClear('netbox-clear-mfr-btn', STORAGE_KEY_MANUFACTURERS, 'dev-manufacturer');

  // Populate on load
  refreshAutocompletes();
  updateUploadStatus();
}

// ─── Status badges ───────────────────────────────────────────────────────────

export function updateUploadStatus() {
  const data = [
    { entries: getDeviceTypes(), statusId: 'netbox-types-status', clearId: 'netbox-clear-types-btn' },
    { entries: getRoles(), statusId: 'netbox-roles-status', clearId: 'netbox-clear-roles-btn' },
    { entries: getManufacturers(), statusId: 'netbox-mfr-status', clearId: 'netbox-clear-mfr-btn' },
  ];
  for (const { entries, statusId, clearId } of data) {
    const statusEl = document.getElementById(statusId);
    const clearBtn = document.getElementById(clearId);
    if (statusEl) {
      statusEl.textContent = entries.length > 0
        ? t('netbox_loaded', { count: entries.length })
        : t('netbox_not_loaded');
      statusEl.className = 'netbox-status ' + (entries.length > 0 ? 'loaded' : 'empty');
    }
    if (clearBtn) clearBtn.style.display = entries.length > 0 ? '' : 'none';
  }
}
