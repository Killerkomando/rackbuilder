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

function extractNameSlug(json) {
  let items = json;
  // NetBox API wraps results in { results: [...] }
  if (json && typeof json === 'object' && !Array.isArray(json) && Array.isArray(json.results)) {
    items = json.results;
  }
  if (!Array.isArray(items)) return null;
  return items
    .filter(entry => entry && (entry.name || entry.slug || entry.display))
    .map(entry => ({
      name: entry.display || entry.name || entry.slug,
      slug: entry.slug || (entry.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    }));
}

// ─── File upload handler ─────────────────────────────────────────────────────

function handleUpload(fileInput, storageKey, onDone) {
  const file = fileInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const json = JSON.parse(ev.target.result);
      const entries = extractNameSlug(json);
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
