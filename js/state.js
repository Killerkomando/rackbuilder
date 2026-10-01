// Central state store with pub/sub and localStorage persistence

import { DEFAULT_RACK_CONFIG, createDevice, canPlace, findNextFreeSlot } from './rack-model.js';
import { generateId } from './utils.js';

const STORAGE_KEY = 'rackbuilder_state';

const initialState = {
  rackConfig: { ...DEFAULT_RACK_CONFIG },
  devices: [],
  selectedDeviceId: null,
  // Multi-rack
  multiRackEnabled: false,
  racks: [],        // [{id, name, totalUnits, numberingDirection, site, location, frontColor, rearColor}]
  activeRackId: null,
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

// ─── Multi-rack helpers ──────────────────────────────────────────────────────

/**
 * Get the effective rack config for the currently active context.
 */
export function getActiveRackConfig(st) {
  if (!st) st = state;
  if (st.multiRackEnabled && st.activeRackId) {
    const rack = st.racks.find(r => r.id === st.activeRackId);
    if (rack) return rack;
  }
  return st.rackConfig;
}

/**
 * Get the devices belonging to the currently active rack.
 */
export function getActiveDevices(st) {
  if (!st) st = state;
  if (st.multiRackEnabled && st.activeRackId) {
    return st.devices.filter(d => d.rackId === st.activeRackId);
  }
  return st.devices;
}

/**
 * Get rack config for a specific rack by ID.
 */
export function getRackById(st, rackId) {
  if (!st.multiRackEnabled) return st.rackConfig;
  return st.racks.find(r => r.id === rackId) || st.rackConfig;
}

// ─── Undo/Redo history ──────────────────────────────────────────────────────

let history = [];
let historyIndex = -1;
const MAX_HISTORY = 50;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function pushHistory() {
  history = history.slice(0, historyIndex + 1);
  history.push(deepClone(state));
  historyIndex = history.length - 1;
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
      // Migration: ensure multi-rack fields exist
      return {
        ...initialState,
        ...parsed,
        multiRackEnabled: parsed.multiRackEnabled || false,
        racks: parsed.racks || [],
        activeRackId: parsed.activeRackId || null,
      };
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

// ─── Helper: get scoped devices + config for a rack context ──────────────────

function getScopedContext(deviceOrPayload) {
  if (state.multiRackEnabled) {
    const rackId = deviceOrPayload?.rackId || state.activeRackId;
    const rackCfg = state.racks.find(r => r.id === rackId);
    if (rackCfg) {
      return {
        devices: state.devices.filter(d => d.rackId === rackId),
        totalUnits: rackCfg.totalUnits,
        rackConfig: rackCfg,
        rackId,
      };
    }
  }
  return {
    devices: state.devices,
    totalUnits: state.rackConfig.totalUnits,
    rackConfig: state.rackConfig,
    rackId: null,
  };
}

/**
 * Dispatch an action to update state.
 */
export function dispatch(action, payload) {
  switch (action) {
    case 'ADD_DEVICE': {
      pushHistory();
      const ctx = getScopedContext(payload);
      const deviceData = state.multiRackEnabled
        ? { ...payload, rackId: payload.rackId || state.activeRackId }
        : payload;
      const device = createDevice(deviceData, ctx.rackConfig);
      const result = canPlace(
        ctx.devices, device.position, device.height,
        device.face, ctx.totalUnits, null, device.fullDepth
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
      if (changes.position !== undefined || changes.height !== undefined || changes.face !== undefined || changes.fullDepth !== undefined) {
        const ctx = getScopedContext(existing);
        const result = canPlace(
          ctx.devices, updated.position, updated.height,
          updated.face, ctx.totalUnits, id, updated.fullDepth
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

      const ctx = getScopedContext(existing);
      const newFace = face || existing.face;
      const result = canPlace(
        ctx.devices, position, existing.height,
        newFace, ctx.totalUnits, id, existing.fullDepth
      );
      if (!result.ok) return result;

      let newColor = existing._color;
      if (newFace !== existing.face) {
        const cfg = ctx.rackConfig;
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
      const ctx = getScopedContext(newDevices[0]);

      for (const deviceData of newDevices) {
        const dd = state.multiRackEnabled
          ? { ...deviceData, rackId: deviceData.rackId || state.activeRackId }
          : deviceData;
        const device = createDevice(dd, ctx.rackConfig);
        const scopedDevices = state.multiRackEnabled
          ? currentDevices.filter(d => d.rackId === ctx.rackId)
          : currentDevices;
        const result = canPlace(
          scopedDevices, device.position, device.height,
          device.face, ctx.totalUnits, null, device.fullDepth
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

    // ─── Multi-rack actions ────────────────────────────────────────────────

    case 'SET_MULTI_RACK': {
      pushHistory();
      const { enabled, racks: newRacks, site, location } = payload;
      if (enabled && newRacks && newRacks.length > 0) {
        // Ensure each rack has an ID
        const racks = newRacks.map(r => ({
          ...r,
          id: r.id || generateId(),
          site: site || r.site || '',
          location: location || r.location || '',
        }));
        // Migrate existing devices to first rack if they have no rackId
        const firstRackId = racks[0].id;
        const devices = state.devices.map(d =>
          d.rackId ? d : { ...d, rackId: firstRackId }
        );
        state = {
          ...state,
          multiRackEnabled: true,
          racks,
          activeRackId: state.activeRackId && racks.find(r => r.id === state.activeRackId)
            ? state.activeRackId
            : firstRackId,
          devices,
          rackConfig: { ...state.rackConfig, site: site || state.rackConfig.site, location: location || state.rackConfig.location },
        };
      } else {
        // Disable multi-rack: strip rackId from devices
        const devices = state.devices.map(d => {
          const { rackId, ...rest } = d;
          return rest;
        });
        // Use first rack config as single rack config if available
        if (state.racks.length > 0) {
          const first = state.racks[0];
          state = {
            ...state,
            multiRackEnabled: false,
            racks: [],
            activeRackId: null,
            devices,
            rackConfig: {
              ...state.rackConfig,
              name: first.name,
              totalUnits: first.totalUnits,
              numberingDirection: first.numberingDirection || 'bottom-to-top',
              frontColor: first.frontColor || '#3b82f6',
              rearColor: first.rearColor || '#f97316',
            },
          };
        } else {
          state = { ...state, multiRackEnabled: false, racks: [], activeRackId: null, devices };
        }
      }
      notify();
      return { ok: true };
    }

    case 'SET_ACTIVE_RACK': {
      if (state.activeRackId === payload) return { ok: true };
      state = { ...state, activeRackId: payload, selectedDeviceId: null };
      notify();
      return { ok: true };
    }

    case 'MOVE_TO_RACK': {
      pushHistory();
      const { id: moveId, targetRackId } = payload;
      const movingDevice = state.devices.find(d => d.id === moveId);
      if (!movingDevice) return { ok: false, reason: 'Device not found.' };
      if (movingDevice.rackId === targetRackId) return { ok: true };
      const targetRack = state.racks.find(r => r.id === targetRackId);
      if (!targetRack) return { ok: false, reason: 'Target rack not found.' };
      const targetDevices = state.devices.filter(d => d.rackId === targetRackId);
      const result = canPlace(
        targetDevices, movingDevice.position, movingDevice.height,
        movingDevice.face, targetRack.totalUnits, null, movingDevice.fullDepth
      );
      if (!result.ok) return result;
      state = {
        ...state,
        devices: state.devices.map(d => d.id === moveId ? { ...d, rackId: targetRackId } : d),
      };
      notify();
      return { ok: true };
    }

    case 'UPDATE_RACK': {
      pushHistory();
      const { rackId, ...changes } = payload;
      state = {
        ...state,
        racks: state.racks.map(r => r.id === rackId ? { ...r, ...changes } : r),
      };
      notify();
      return { ok: true };
    }

    case 'CLEAR_DEVICES': {
      pushHistory();
      if (state.multiRackEnabled && state.activeRackId) {
        // Only clear devices for the active rack
        state = {
          ...state,
          devices: state.devices.filter(d => d.rackId !== state.activeRackId),
          selectedDeviceId: null,
        };
      } else {
        state = { ...state, devices: [], selectedDeviceId: null };
      }
      notify();
      return { ok: true };
    }

    case 'CLEAR_STATE': {
      state = {
        ...initialState,
        rackConfig: { ...DEFAULT_RACK_CONFIG },
        multiRackEnabled: false,
        racks: [],
        activeRackId: null,
      };
      history = [deepClone(state)];
      historyIndex = 0;
      notify();
      return { ok: true };
    }

    case 'LOAD_STATE': {
      state = {
        ...initialState,
        ...payload,
        multiRackEnabled: payload.multiRackEnabled || false,
        racks: payload.racks || [],
        activeRackId: payload.activeRackId || null,
      };
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
