// NetBox Device Types, Roles & Manufacturers Autocomplete (Opt-In)
// Stores only {name, slug} per entry in localStorage to stay under 5 MB.
// Uses a custom dropdown instead of native <datalist> for modern look & feel.

import { t } from './i18n.js';

const STORAGE_KEY_TYPES         = 'rackbuilder_netbox_device_types';
const STORAGE_KEY_ROLES         = 'rackbuilder_netbox_roles';
const STORAGE_KEY_MANUFACTURERS = 'rackbuilder_netbox_manufacturers';
const STORAGE_KEY_API_URL       = 'rackbuilder_netbox_api_url';
const STORAGE_KEY_API_TOKEN     = 'rackbuilder_netbox_api_token';
const STORAGE_KEY_TOKEN_ENC     = 'rackbuilder_netbox_api_token_enc'; // encryption flag
const STORAGE_KEY_MODE          = 'rackbuilder_netbox_mode'; // 'upload' | 'api'
const SESSION_CRYPTO_KEY        = 'rackbuilder_ck'; // AES-GCM key (session only)

// ─── API token encryption (AES-GCM, key lives only in sessionStorage) ────────

async function getCryptoKey() {
  const stored = sessionStorage.getItem(SESSION_CRYPTO_KEY);
  if (stored) {
    try {
      const raw = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
      return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    } catch { /* fall through */ }
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const raw = await crypto.subtle.exportKey('raw', key);
  sessionStorage.setItem(SESSION_CRYPTO_KEY, btoa(String.fromCharCode(...new Uint8Array(raw))));
  return key;
}

async function encryptApiToken(plaintext) {
  const key = await getCryptoKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const buf = new Uint8Array(12 + enc.byteLength);
  buf.set(iv);
  buf.set(new Uint8Array(enc), 12);
  return btoa(String.fromCharCode(...buf));
}

async function decryptApiToken(b64) {
  try {
    const key = await getCryptoKey();
    const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12));
    return new TextDecoder().decode(dec);
  } catch {
    return null; // wrong key (new session) or corrupted data
  }
}

async function saveApiToken(token) {
  if (!token) {
    localStorage.removeItem(STORAGE_KEY_API_TOKEN);
    localStorage.removeItem(STORAGE_KEY_TOKEN_ENC);
    return;
  }
  const encrypted = await encryptApiToken(token);
  localStorage.setItem(STORAGE_KEY_API_TOKEN, encrypted);
  localStorage.setItem(STORAGE_KEY_TOKEN_ENC, '1');
}

async function loadApiToken() {
  const raw = localStorage.getItem(STORAGE_KEY_API_TOKEN);
  if (!raw) return '';
  if (localStorage.getItem(STORAGE_KEY_TOKEN_ENC) !== '1') {
    // Legacy plain-text token — re-encrypt it
    await saveApiToken(raw);
    return raw;
  }
  const decrypted = await decryptApiToken(raw);
  if (decrypted === null) {
    // New session — key gone, stored ciphertext is now unreadable
    localStorage.removeItem(STORAGE_KEY_API_TOKEN);
    localStorage.removeItem(STORAGE_KEY_TOKEN_ENC);
    return '';
  }
  return decrypted;
}

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
    .map(entry => {
      const obj = {
        name: entry.model || entry.name || entry.display || entry.slug,
        slug: entry.slug || (entry.model || entry.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      };
      // Device type metadata for auto-fill
      if (entry.u_height !== undefined) obj.uHeight = parseInt(entry.u_height) || 1;
      const fd = entry.full_depth ?? entry.is_full_depth;
      if (fd !== undefined) obj.fullDepth = fd === true || fd === 'true';
      const mfr = entry.manufacturer;
      if (mfr) obj.manufacturer = typeof mfr === 'object' ? (mfr.name || mfr.display || '') : String(mfr);
      return obj;
    });
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
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
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
  const lines = text.split(/\r?\n/);

  // Detect whether the file is a root-level list or a single object.
  // Look at the first non-empty, non-comment, non-directive line.
  let hasRootList = false;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith('#') || line === '---' || line === '...') continue;
    if (line.match(/^-\s/)) { hasRootList = true; }
    break;
  }

  if (!hasRootList) {
    // Single or multi-document YAML (documents separated by ---).
    // Each document between '---' lines is one device type.
    // Skip indented lines so nested blocks (interfaces, ports…) are ignored.
    const items = [];
    let current = {};
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line || line.startsWith('#')) continue;
      if (line === '---' || line === '...') {
        // Document separator: flush current document
        if (current.model || current.slug || current.name) items.push(current);
        current = {};
        continue;
      }
      if (line.startsWith(' ') || line.startsWith('\t')) continue; // skip nested content
      const kvMatch = line.match(/^(\w[\w-]*):\s+(.+)/);
      if (kvMatch) {
        current[kvMatch[1]] = kvMatch[2].replace(/^["']|["']$/g, '');
      }
    }
    // Flush the last document
    if (current.model || current.slug || current.name) items.push(current);
    return items.length > 0 ? items : null;
  }

  // Root-level list: parse each list item, but only capture fields at the item's
  // own indentation depth — not nested object fields — to avoid field collisions.
  const items = [];
  let current = null;
  let itemFieldIndent = -1; // expected indentation of item's direct fields
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith('#')) continue;

    const listMatch = line.match(/^(\s*)-\s+(.*)/);
    if (listMatch) {
      if (current) items.push(current);
      current = {};
      itemFieldIndent = listMatch[1].length + 2; // fields sit 2 spaces deeper than the '-'
      const rest = listMatch[2].trim();
      const inlineMatch = rest.match(/^\{(.*)\}$/);
      if (inlineMatch) {
        for (const pair of inlineMatch[1].split(',')) {
          const [k, ...vParts] = pair.split(':');
          if (k && vParts.length) {
            current[k.trim().replace(/^["']|["']$/g, '')] = vParts.join(':').trim().replace(/^["']|["']$/g, '');
          }
        }
      } else {
        const kvMatch = rest.match(/^(\w[\w-]*):\s*(.*)/);
        if (kvMatch) {
          current[kvMatch[1]] = kvMatch[2].replace(/^["']|["']$/g, '');
        }
      }
    } else if (current && itemFieldIndent >= 0) {
      // Only capture lines indented at exactly the item's field depth.
      // Deeper lines belong to nested objects/lists and are intentionally skipped.
      const indent = line.search(/\S/);
      if (indent !== itemFieldIndent) continue;
      const kvMatch = line.match(/^\s+(\w[\w-]*):\s*(.*)/);
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
  // Append to body to escape overflow clipping in sidebars/dialogs
  document.body.appendChild(dropdown);
  return dropdown;
}

function positionDropdown(inputId) {
  const state = activeDropdowns.get(inputId);
  if (!state) return;
  const input = document.getElementById(inputId);
  if (!input) return;
  const rect = input.getBoundingClientRect();
  const dd = state.dropdown;
  dd.style.top  = rect.bottom + 'px';
  dd.style.left = rect.left + 'px';
  dd.style.minWidth = rect.width + 'px';
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
    const metaParts = [];
    if (e.uHeight) metaParts.push(`${e.uHeight}U`);
    if (e.fullDepth) metaParts.push('Full');
    const metaHtml = metaParts.length ? `<span class="ac-option-meta">${metaParts.join(' · ')}</span>` : '';
    return `<div class="ac-option" data-index="${i}" role="option">
      <span class="ac-option-name">${nameHtml}</span>
      ${metaHtml}
      <span class="ac-option-slug">${slugHtml}</span>
    </div>`;
  }).join('');

  positionDropdown(inputId);
  dropdown.classList.add('visible');
}

function selectOption(inputId, index) {
  const state = activeDropdowns.get(inputId);
  if (!state || !state.filtered || !state.filtered[index]) return;
  const entry = state.filtered[index];
  const input = document.getElementById(inputId);
  input.value = entry.name;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new CustomEvent('ac:select', { detail: entry, bubbles: true }));
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

  // Reposition on scroll of any scrollable ancestor (sidebar, window)
  const scrollHandler = () => {
    const state = activeDropdowns.get(inputId);
    if (state?.dropdown.classList.contains('visible')) positionDropdown(inputId);
  };
  window.addEventListener('scroll', scrollHandler, { passive: true });
  // Find scrollable parent (sidebar) and listen there too
  let el = input.parentElement;
  while (el && el !== document.body) {
    if (el.scrollHeight > el.clientHeight) {
      el.addEventListener('scroll', scrollHandler, { passive: true });
      break;
    }
    el = el.parentElement;
  }

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

// ─── NetBox Live API ─────────────────────────────────────────────────────────

async function apiFetchPages(baseUrl, token, endpoint) {
  const results = [];
  let url = `${baseUrl.replace(/\/+$/, '')}/api/${endpoint}/?limit=200&format=json`;
  while (url) {
    const res = await fetch(url, {
      headers: { 'Authorization': `Token ${token}`, 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const data = await res.json();
    results.push(...(data.results || []));
    url = data.next || null;
  }
  return results;
}

async function apiFetchAndStore(endpoint, storageKey, inputId, btnId) {
  const baseUrl    = localStorage.getItem(STORAGE_KEY_API_URL) || '';
  const tokenInput = document.getElementById('netbox-api-token-input');
  const token      = tokenInput?.value.trim() || '';
  if (!baseUrl || !token) { alert(t('netbox_api_missing_creds')); return false; }

  const btn = document.getElementById(btnId);
  const origText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = t('netbox_api_fetching'); }

  try {
    const items   = await apiFetchPages(baseUrl, token, endpoint);
    const entries = extractNameSlug(items);
    if (!entries || entries.length === 0) { alert(t('netbox_api_empty')); return false; }
    saveEntries(storageKey, entries);
    attachAutocomplete(inputId, entries);
    updateUploadStatus();
    return true;
  } catch (err) {
    const msg = (err instanceof TypeError)
      ? t('netbox_api_cors_error')
      : `${t('netbox_api_error')}: ${err.message}`;
    alert(msg);
    return false;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
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

export async function initNetboxAutocomplete() {
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

  // ── NetBox mode toggle (Upload ↔ Live API) ──
  const uploadSection = document.getElementById('netbox-upload-section');
  const apiSection    = document.getElementById('netbox-api-section');
  const modeUploadBtn = document.getElementById('netbox-mode-upload');
  const modeApiBtn    = document.getElementById('netbox-mode-api');

  function setNetboxMode(mode, save = true) {
    const isApi = mode === 'api';
    if (uploadSection) uploadSection.style.display = isApi ? 'none' : '';
    if (apiSection)    apiSection.style.display    = isApi ? '' : 'none';
    modeUploadBtn?.classList.toggle('active', !isApi);
    modeApiBtn?.classList.toggle('active',    isApi);
    if (save) localStorage.setItem(STORAGE_KEY_MODE, mode);
  }

  modeUploadBtn?.addEventListener('click', () => setNetboxMode('upload'));
  modeApiBtn?.addEventListener('click',    () => setNetboxMode('api'));

  // Restore saved credentials
  const urlInput   = document.getElementById('netbox-api-url-input');
  const tokenInput = document.getElementById('netbox-api-token-input');
  if (urlInput)   urlInput.value   = localStorage.getItem(STORAGE_KEY_API_URL) || '';
  if (tokenInput) tokenInput.value = await loadApiToken();

  urlInput?.addEventListener('input', () => localStorage.setItem(STORAGE_KEY_API_URL, urlInput.value.trim()));
  tokenInput?.addEventListener('input', () => saveApiToken(tokenInput.value.trim()));

  // Show / hide token
  document.getElementById('netbox-api-token-toggle')?.addEventListener('click', () => {
    if (!tokenInput) return;
    tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
  });

  // Test connection
  document.getElementById('netbox-api-test-btn')?.addEventListener('click', async () => {
    const baseUrl = urlInput?.value.trim();
    const token   = tokenInput?.value.trim();
    const status  = document.getElementById('netbox-api-conn-status');
    if (!baseUrl || !token) {
      if (status) { status.textContent = t('netbox_api_missing_creds'); status.className = 'netbox-api-conn-status error'; }
      return;
    }
    if (status) { status.textContent = t('netbox_api_connecting'); status.className = 'netbox-api-conn-status'; }
    const btn = document.getElementById('netbox-api-test-btn');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/`, {
        headers: { 'Authorization': `Token ${token}`, 'Accept': 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (status) { status.textContent = t('netbox_api_connected'); status.className = 'netbox-api-conn-status success'; }
    } catch (err) {
      const msg = (err instanceof TypeError)
        ? t('netbox_api_cors_error')
        : `${t('netbox_api_error')}: ${err.message}`;
      if (status) { status.textContent = msg; status.className = 'netbox-api-conn-status error'; }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Individual fetch buttons
  document.getElementById('netbox-api-fetch-types-btn')?.addEventListener('click', () =>
    apiFetchAndStore('dcim/device-types', STORAGE_KEY_TYPES, 'dev-type', 'netbox-api-fetch-types-btn'));
  document.getElementById('netbox-api-fetch-roles-btn')?.addEventListener('click', () =>
    apiFetchAndStore('dcim/device-roles', STORAGE_KEY_ROLES, 'dev-role', 'netbox-api-fetch-roles-btn'));
  document.getElementById('netbox-api-fetch-mfr-btn')?.addEventListener('click', () =>
    apiFetchAndStore('dcim/manufacturers', STORAGE_KEY_MANUFACTURERS, 'dev-manufacturer', 'netbox-api-fetch-mfr-btn'));

  // Fetch All
  document.getElementById('netbox-api-fetch-all-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('netbox-api-fetch-all-btn');
    if (btn) { btn.disabled = true; btn.textContent = t('netbox_api_fetching'); }
    await apiFetchAndStore('dcim/device-types',  STORAGE_KEY_TYPES,         'dev-type',        'netbox-api-fetch-types-btn');
    await apiFetchAndStore('dcim/device-roles',  STORAGE_KEY_ROLES,         'dev-role',        'netbox-api-fetch-roles-btn');
    await apiFetchAndStore('dcim/manufacturers', STORAGE_KEY_MANUFACTURERS, 'dev-manufacturer', 'netbox-api-fetch-mfr-btn');
    if (btn) { btn.disabled = false; btn.textContent = t('netbox_api_fetch_all'); }
  });

  // Set initial mode from localStorage
  setNetboxMode(localStorage.getItem(STORAGE_KEY_MODE) || 'upload', false);
}

// ─── Status badges ───────────────────────────────────────────────────────────

export function updateUploadStatus() {
  const data = [
    {
      entries: getDeviceTypes(),
      statusIds: ['netbox-types-status', 'netbox-api-types-status'],
      clearId: 'netbox-clear-types-btn',
    },
    {
      entries: getRoles(),
      statusIds: ['netbox-roles-status', 'netbox-api-roles-status'],
      clearId: 'netbox-clear-roles-btn',
    },
    {
      entries: getManufacturers(),
      statusIds: ['netbox-mfr-status', 'netbox-api-mfr-status'],
      clearId: 'netbox-clear-mfr-btn',
    },
  ];
  for (const { entries, statusIds, clearId } of data) {
    const text  = entries.length > 0 ? t('netbox_loaded', { count: entries.length }) : t('netbox_not_loaded');
    const cls   = 'netbox-status ' + (entries.length > 0 ? 'loaded' : 'empty');
    for (const id of statusIds) {
      const el = document.getElementById(id);
      if (el) { el.textContent = text; el.className = cls; }
    }
    const clearBtn = document.getElementById(clearId);
    if (clearBtn) clearBtn.style.display = entries.length > 0 ? '' : 'none';
  }
}
