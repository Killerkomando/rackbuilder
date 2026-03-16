// Central state store with pub/sub and localStorage persistence

import { DEFAULT_RACK_CONFIG, createDevice, canPlace, findNextFreeSlot } from './rack-model.js';

const STORAGE_KEY = 'rackbuilder_state';

const initialState = {
  rackConfig: { ...DEFAULT_RACK_CONFIG },
  devices: [],
  selectedDeviceId: null,
};

let state = loadState();
let listeners = [];

// Reserved units (non-persisted, UI-only state for HE selection)
let reservedUnits = []; // [{unit: number, face: string}]

export function getReservedUnits() { return reservedUnits; }
export function setReservedUnits(units) {
  reservedUnits = units;
  for (const listener of listeners) listener(state);
}
export function clearReservedUnits() { reservedUnits = []; }

// Undo/Redo history
let history = [];
let historyIndex = -1;
const MAX_HISTORY = 50;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function pushHistory() {
  // Truncate any future entries
  history = history.slice(0, historyIndex + 1);
  history.push(deepClone(state));
  historyIndex = history.length - 1;
  // Trim if exceeding max
  if (history.length > MAX_HISTORY) {
    history.shift();
    historyIndex--;
  }
}

// Initialize history with current state
history.push(deepClone(state));
historyIndex = 0;

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...initialState, ...parsed };
    }
  } catch (e) {
    console.warn('Failed to load state from localStorage:', e);
  }
  return { ...initialState };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save state to localStorage:', e);
  }
}

function notify() {
  saveState();
  for (const listener of listeners) {
    listener(state);
  }
}

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

export function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  state = deepClone(history[historyIndex]);
  notify();
}

export function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  state = deepClone(history[historyIndex]);
  notify();
}

export function canUndo() {
  return historyIndex > 0;
}

export function canRedo() {
  return historyIndex < history.length - 1;
}

/**
 * Dispatch an action to update state.
 * @param {string} action
 * @param {*} payload
 * @returns {{ok: boolean, reason?: string}}
 */
export function dispatch(action, payload) {
  switch (action) {
    case 'ADD_DEVICE': {
      pushHistory();
      const device = createDevice(payload, state.rackConfig);
      const result = canPlace(
        state.devices, device.position, device.height,
        device.face, state.rackConfig.totalUnits, null, device.fullDepth
      );
      if (!result.ok) return result;
      state = { ...state, devices: [...state.devices, device] };
      notify();
      return { ok: true, device };
    }

    case 'REMOVE_DEVICE': {
      pushHistory();
      const id = payload;
      state = {
        ...state,
        devices: state.devices.filter(d => d.id !== id),
        selectedDeviceId: state.selectedDeviceId === id ? null : state.selectedDeviceId,
      };
      notify();
      return { ok: true };
    }

    case 'UPDATE_DEVICE': {
      pushHistory();
      const { id, ...changes } = payload;
      const existing = state.devices.find(d => d.id === id);
      if (!existing) return { ok: false, reason: 'Device not found.' };

      const updated = { ...existing, ...changes };
      // Check placement if position, height, or face changed
      if (changes.position !== undefined || changes.height !== undefined || changes.face !== undefined || changes.fullDepth !== undefined) {
        const result = canPlace(
          state.devices, updated.position, updated.height,
          updated.face, state.rackConfig.totalUnits, id, updated.fullDepth
        );
        if (!result.ok) return result;
      }
      state = {
        ...state,
        devices: state.devices.map(d => d.id === id ? updated : d),
      };
      notify();
      return { ok: true };
    }

    case 'MOVE_DEVICE': {
      pushHistory();
      const { id, position, face } = payload;
      if (!Number.isInteger(position) || position < 1) {
        return { ok: false, reason: 'Invalid position.' };
      }
      const existing = state.devices.find(d => d.id === id);
      if (!existing) return { ok: false, reason: 'Device not found.' };

      const newFace = face || existing.face;
      const result = canPlace(
        state.devices, position, existing.height,
        newFace, state.rackConfig.totalUnits, id, existing.fullDepth
      );
      if (!result.ok) return result;

      // Auto-swap color when moving to opposite face (only if using default color)
      let newColor = existing._color;
      if (newFace !== existing.face) {
        const cfg = state.rackConfig;
        const oldDefault = existing.face === 'front'
          ? (cfg.frontColor || '#3b82f6')
          : (cfg.rearColor || '#f97316');
        const newDefault = newFace === 'front'
          ? (cfg.frontColor || '#3b82f6')
          : (cfg.rearColor || '#f97316');
        if (existing._color === oldDefault) {
          newColor = newDefault;
        }
      }

      state = {
        ...state,
        devices: state.devices.map(d =>
          d.id === id ? { ...d, position, face: newFace, _color: newColor } : d
        ),
      };
      notify();
      return { ok: true };
    }

    case 'BULK_ADD_DEVICES': {
      pushHistory();
      const { devices: newDevices } = payload;
      const results = [];
      let currentDevices = [...state.devices];

      for (const deviceData of newDevices) {
        const device = createDevice(deviceData, state.rackConfig);
        const result = canPlace(
          currentDevices, device.position, device.height,
          device.face, state.rackConfig.totalUnits, null, device.fullDepth
        );
        if (result.ok) {
          currentDevices.push(device);
          results.push({ ok: true, name: device.name });
        } else {
          results.push({ ok: false, name: device.name, reason: result.reason });
        }
      }

      state = { ...state, devices: currentDevices };
      notify();
      return { ok: true, results };
    }

    case 'SELECT_DEVICE': {
      if (state.selectedDeviceId === payload) return { ok: true };
      state = { ...state, selectedDeviceId: payload };
      notify();
      return { ok: true };
    }

    case 'UPDATE_RACK_CONFIG': {
      pushHistory();
      state = {
        ...state,
        rackConfig: { ...state.rackConfig, ...payload },
      };
      notify();
      return { ok: true };
    }

    case 'CLEAR_DEVICES': {
      pushHistory();
      state = { ...state, devices: [], selectedDeviceId: null };
      notify();
      return { ok: true };
    }

    case 'CLEAR_STATE': {
      state = { ...initialState, rackConfig: { ...DEFAULT_RACK_CONFIG } };
      history = [deepClone(state)];
      historyIndex = 0;
      notify();
      return { ok: true };
    }

    case 'LOAD_STATE': {
      state = { ...initialState, ...payload };
      history = [deepClone(state)];
      historyIndex = 0;
      notify();
      return { ok: true };
    }

    default:
      console.warn('Unknown action:', action);
      return { ok: false, reason: `Unknown action: ${action}` };
  }
}
