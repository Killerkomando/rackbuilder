// NetBox Device Types & Roles Autocomplete (Opt-In)
// Stores only {name, slug} per entry in localStorage to stay under 5 MB.

import { t } from './i18n.js';

const STORAGE_KEY_TYPES = 'rackbuilder_netbox_device_types';
const STORAGE_KEY_ROLES = 'rackbuilder_netbox_roles';

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

export function clearDeviceTypes() { localStorage.removeItem(STORAGE_KEY_TYPES); }
export function clearRoles() { localStorage.removeItem(STORAGE_KEY_ROLES); }

// ─── JSON parser: extract only name + slug ───────────────────────────────────

function extractNameSlug(items) {
  if (!Array.isArray(items)) return null;
  const result = items
    .filter(entry => entry && (entry.name || entry.slug || entry.display))
    .map(entry => ({
      name: entry.display || entry.name || entry.slug,
      slug: entry.slug || (entry.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    }));
  return result.length > 0 ? result : null;
}

// ─── Format parsers ──────────────────────────────────────────────────────────

function parseJSON(text) {
  const json = JSON.parse(text);
  // NetBox API wraps results in { results: [...] }
  if (json && typeof json === 'object' && !Array.isArray(json) && Array.isArray(json.results)) {
    return json.results;
  }
  if (Array.isArray(json)) return json;
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
  // Lightweight YAML parser for flat list-of-objects (NetBox export format)
  // Handles: - name: Foo\n  slug: foo  OR  - {name: Foo, slug: foo}
  const items = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    // New list item: "- key: value" or "- {inline}"
    const listMatch = line.match(/^-\s+(.*)/);
    if (listMatch) {
      if (current) items.push(current);
      current = {};
      const rest = listMatch[1].trim();
      // Inline object: {name: Foo, slug: bar}
      const inlineMatch = rest.match(/^\{(.*)\}$/);
      if (inlineMatch) {
        for (const pair of inlineMatch[1].split(',')) {
          const [k, ...vParts] = pair.split(':');
          if (k && vParts.length) {
            current[k.trim().replace(/^["']|["']$/g, '')] = vParts.join(':').trim().replace(/^["']|["']$/g, '');
          }
        }
      } else {
        // "- key: value" on same line
        const kvMatch = rest.match(/^(\w+):\s*(.*)/);
        if (kvMatch) {
          current[kvMatch[1]] = kvMatch[2].replace(/^["']|["']$/g, '');
        }
      }
    } else if (current) {
      // Continuation: "  key: value"
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

  // Try by extension first, then fallback
  if (ext === 'json') {
    return parseJSON(text);
  }
  if (ext === 'csv' || ext === 'tsv') {
    return parseCSV(text);
  }
  if (ext === 'yaml' || ext === 'yml') {
    return parseYAML(text);
  }

  // Auto-detect: try JSON, then CSV, then YAML
  const trimmed = text.trimStart();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try { return parseJSON(text); } catch { /* fall through */ }
  }
  // CSV: first line looks like headers with commas/tabs
  if (/^[\w"'].*[,\t]/.test(trimmed.split('\n')[0])) {
    const result = parseCSV(text);
    if (result) return result;
  }
  // YAML: starts with "- " or "---"
  if (trimmed.startsWith('-')) {
    return parseYAML(text);
  }
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

// ─── Datalist population ─────────────────────────────────────────────────────

export function populateDatalist(datalistId, entries) {
  const dl = document.getElementById(datalistId);
  if (!dl) return;
  dl.innerHTML = entries.map(e =>
    `<option value="${e.slug}" label="${e.name}">`
  ).join('');
}

export function refreshDatalists() {
  const types = getDeviceTypes();
  const roles = getRoles();
  populateDatalist('netbox-device-types-list', types);
  populateDatalist('netbox-roles-list', roles);
}

// ─── Init: wire upload buttons + populate datalists ──────────────────────────

export function initNetboxAutocomplete() {
  const typesInput = document.getElementById('netbox-types-file');
  const rolesInput = document.getElementById('netbox-roles-file');
  const typesBtn = document.getElementById('netbox-upload-types-btn');
  const rolesBtn = document.getElementById('netbox-upload-roles-btn');
  const typesClearBtn = document.getElementById('netbox-clear-types-btn');
  const rolesClearBtn = document.getElementById('netbox-clear-roles-btn');

  if (typesBtn && typesInput) {
    typesBtn.addEventListener('click', () => typesInput.click());
    typesInput.addEventListener('change', () => {
      handleUpload(typesInput, STORAGE_KEY_TYPES, (entries) => {
        populateDatalist('netbox-device-types-list', entries);
        updateUploadStatus();
      });
    });
  }

  if (rolesBtn && rolesInput) {
    rolesBtn.addEventListener('click', () => rolesInput.click());
    rolesInput.addEventListener('change', () => {
      handleUpload(rolesInput, STORAGE_KEY_ROLES, (entries) => {
        populateDatalist('netbox-roles-list', entries);
        updateUploadStatus();
      });
    });
  }

  if (typesClearBtn) {
    typesClearBtn.addEventListener('click', () => {
      clearDeviceTypes();
      populateDatalist('netbox-device-types-list', []);
      updateUploadStatus();
    });
  }

  if (rolesClearBtn) {
    rolesClearBtn.addEventListener('click', () => {
      clearRoles();
      populateDatalist('netbox-roles-list', []);
      updateUploadStatus();
    });
  }

  // Populate on load
  refreshDatalists();
  updateUploadStatus();
}

// ─── Status badges ───────────────────────────────────────────────────────────

export function updateUploadStatus() {
  const types = getDeviceTypes();
  const roles = getRoles();
  const typesStatus = document.getElementById('netbox-types-status');
  const rolesStatus = document.getElementById('netbox-roles-status');
  const typesClearBtn = document.getElementById('netbox-clear-types-btn');
  const rolesClearBtn = document.getElementById('netbox-clear-roles-btn');

  if (typesStatus) {
    typesStatus.textContent = types.length > 0
      ? t('netbox_loaded', { count: types.length })
      : t('netbox_not_loaded');
    typesStatus.className = 'netbox-status ' + (types.length > 0 ? 'loaded' : 'empty');
  }
  if (rolesStatus) {
    rolesStatus.textContent = roles.length > 0
      ? t('netbox_loaded', { count: roles.length })
      : t('netbox_not_loaded');
    rolesStatus.className = 'netbox-status ' + (roles.length > 0 ? 'loaded' : 'empty');
  }
  if (typesClearBtn) typesClearBtn.style.display = types.length > 0 ? '' : 'none';
  if (rolesClearBtn) rolesClearBtn.style.display = roles.length > 0 ? '' : 'none';
}
