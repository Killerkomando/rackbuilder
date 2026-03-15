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

/**
 * Dispatch an action to update state.
 * @param {string} action
 * @param {*} payload
 * @returns {{ok: boolean, reason?: string}}
 */
export function dispatch(action, payload) {
  switch (action) {
    case 'ADD_DEVICE': {
      const device = createDevice(payload);
      const result = canPlace(
        state.devices, device.position, device.height,
        device.face, state.rackConfig.totalUnits
      );
      if (!result.ok) return result;
      state = { ...state, devices: [...state.devices, device] };
      notify();
      return { ok: true, device };
    }

    case 'REMOVE_DEVICE': {
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
      const { id, ...changes } = payload;
      const existing = state.devices.find(d => d.id === id);
      if (!existing) return { ok: false, reason: 'Device not found.' };

      const updated = { ...existing, ...changes };
      // Check placement if position, height, or face changed
      if (changes.position !== undefined || changes.height !== undefined || changes.face !== undefined) {
        const result = canPlace(
          state.devices, updated.position, updated.height,
          updated.face, state.rackConfig.totalUnits, id
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
      const { id, position, face } = payload;
      const existing = state.devices.find(d => d.id === id);
      if (!existing) return { ok: false, reason: 'Device not found.' };

      const newFace = face || existing.face;
      const result = canPlace(
        state.devices, position, existing.height,
        newFace, state.rackConfig.totalUnits, id
      );
      if (!result.ok) return result;

      state = {
        ...state,
        devices: state.devices.map(d =>
          d.id === id ? { ...d, position, face: newFace } : d
        ),
      };
      notify();
      return { ok: true };
    }

    case 'BULK_ADD_DEVICES': {
      const { devices: newDevices } = payload;
      const results = [];
      let currentDevices = [...state.devices];

      for (const deviceData of newDevices) {
        const device = createDevice(deviceData);
        const result = canPlace(
          currentDevices, device.position, device.height,
          device.face, state.rackConfig.totalUnits
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
      state = { ...state, selectedDeviceId: payload };
      notify();
      return { ok: true };
    }

    case 'UPDATE_RACK_CONFIG': {
      state = {
        ...state,
        rackConfig: { ...state.rackConfig, ...payload },
      };
      notify();
      return { ok: true };
    }

    case 'CLEAR_STATE': {
      state = { ...initialState, rackConfig: { ...DEFAULT_RACK_CONFIG } };
      notify();
      return { ok: true };
    }

    case 'LOAD_STATE': {
      state = { ...initialState, ...payload };
      notify();
      return { ok: true };
    }

    default:
      console.warn('Unknown action:', action);
      return { ok: false, reason: `Unknown action: ${action}` };
  }
}
