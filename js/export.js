// NetBox JSON export + download/clipboard

import { getState, dispatch } from './state.js';
import { toNetBoxJSON } from './rack-model.js';

export function initExport() {
  document.getElementById('export-btn').addEventListener('click', downloadJSON);
  document.getElementById('copy-btn').addEventListener('click', copyToClipboard);
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', importJSON);
}

function getExportData() {
  const state = getState();
  return toNetBoxJSON(state.devices, state.rackConfig);
}

function downloadJSON() {
  const state = getState();
  const data = getExportData();

  if (data.length === 0) {
    alert('No devices to export.');
    return;
  }

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.rackConfig.name}_import.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function copyToClipboard() {
  const data = getExportData();

  if (data.length === 0) {
    alert('No devices to export.');
    return;
  }

  const json = JSON.stringify(data, null, 2);

  try {
    await navigator.clipboard.writeText(json);
    const btn = document.getElementById('copy-btn');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 2000);
  } catch (e) {
    // Fallback for non-secure contexts
    const textarea = document.createElement('textarea');
    textarea.value = json;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (!Array.isArray(data)) {
        alert('Invalid file: expected a JSON array.');
        return;
      }

      const devices = data.map(d => ({
        name: d.name || '',
        deviceType: d.device_type || '',
        role: d.role || '',
        position: d.position || 1,
        height: 1,
        face: d.face || 'front',
        status: d.status || 'planned',
        serial: d.serial || '',
        assetTag: d.asset_tag || '',
        comments: d.comments || '',
        _color: d.face === 'rear' ? '#f97316' : '#3b82f6',
      }));

      const result = dispatch('BULK_ADD_DEVICES', { devices });
      if (result.ok) {
        const placed = result.results.filter(r => r.ok).length;
        alert(`Imported ${placed} of ${devices.length} devices.`);
      }
    } catch (err) {
      alert('Failed to parse JSON file: ' + err.message);
    }
  };
  reader.readAsText(file);

  // Reset file input so same file can be imported again
  e.target.value = '';
}
