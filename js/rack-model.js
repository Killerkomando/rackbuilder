// Rack data model with collision detection and boundary checks

import { generateId } from './utils.js';

/**
 * @typedef {Object} Device
 * @property {string} id
 * @property {string} name
 * @property {string} deviceType
 * @property {string} role
 * @property {number} position - Lowest occupied U (1-based)
 * @property {number} height - In rack units
 * @property {"front"|"rear"} face
 * @property {string} status
 * @property {string} serial
 * @property {string} assetTag
 * @property {string} comments
 * @property {string} _color
 */

/**
 * @typedef {Object} RackConfig
 * @property {string} name
 * @property {number} totalUnits
 * @property {"bottom-to-top"|"top-to-bottom"} numberingDirection
 * @property {string} site
 * @property {string} location
 */

export const DEFAULT_RACK_CONFIG = {
  name: 'Rack-01',
  totalUnits: 42,
  numberingDirection: 'bottom-to-top',
  site: '',
  location: '',
  frontColor: '#3b82f6',
  rearColor: '#f97316',
};

export function createDevice(overrides = {}, rackConfig = null) {
  const frontColor = rackConfig?.frontColor || '#3b82f6';
  const rearColor = rackConfig?.rearColor || '#f97316';
  return {
    id: generateId(),
    name: '',
    manufacturer: '',
    deviceType: '',
    role: '',
    position: 1,
    height: 1,
    face: 'front',
    status: 'planned',
    serial: '',
    assetTag: '',
    comments: '',
    fullDepth: false,
    _color: overrides.face === 'rear' ? rearColor : frontColor,
    ...overrides,
  };
}

/**
 * Check if two ranges overlap.
 * Range: [start, start + height - 1]
 */
function rangesOverlap(pos1, h1, pos2, h2) {
  const end1 = pos1 + h1 - 1;
  const end2 = pos2 + h2 - 1;
  return pos1 <= end2 && pos2 <= end1;
}

/**
 * Check if a device can be placed at the given position.
 * @param {Device[]} devices - Existing devices
 * @param {number} position
 * @param {number} height
 * @param {"front"|"rear"} face
 * @param {number} totalUnits
 * @param {string|null} excludeId - Device ID to exclude (for move operations)
 * @returns {{ok: boolean, reason?: string}}
 */
export function canPlace(devices, position, height, face, totalUnits, excludeId = null, fullDepth = false) {
  if (position < 1) {
    return { ok: false, reason: 'Position must be at least 1.' };
  }
  if (position + height - 1 > totalUnits) {
    return { ok: false, reason: `Device exceeds rack boundary (max ${totalUnits}U).` };
  }
  for (const d of devices) {
    if (d.id === excludeId) continue;
    if (d.face === face) {
      // Same-face collision
      if (rangesOverlap(position, height, d.position, d.height)) {
        return { ok: false, reason: `Collision with "${d.name}" at U${d.position}.` };
      }
    } else {
      // Cross-face depth collision: only if either device is full-depth
      if ((fullDepth || d.fullDepth) && rangesOverlap(position, height, d.position, d.height)) {
        return { ok: false, reason: `Depth collision with "${d.name}" (${d.face}) at U${d.position}.` };
      }
    }
  }
  return { ok: true };
}

/**
 * Find the next free slot that can fit a device of given height.
 * @param {Device[]} devices
 * @param {number} height
 * @param {"front"|"rear"} face
 * @param {number} totalUnits
 * @param {number} startFrom - U position to start searching from
 * @returns {number|null}
 */
export function findNextFreeSlot(devices, height, face, totalUnits, startFrom = 1, fullDepth = false) {
  for (let pos = startFrom; pos + height - 1 <= totalUnits; pos++) {
    const result = canPlace(devices, pos, height, face, totalUnits, null, fullDepth);
    if (result.ok) return pos;
  }
  return null;
}

/**
 * Find the next free slot searching downwards (from high U to low U).
 */
export function findNextFreeSlotReverse(devices, height, face, totalUnits, startFrom = null, fullDepth = false) {
  if (startFrom === null) startFrom = totalUnits - height + 1;
  for (let pos = startFrom; pos >= 1; pos--) {
    const result = canPlace(devices, pos, height, face, totalUnits, null, fullDepth);
    if (result.ok) return pos;
  }
  return null;
}

/**
 * Get a set of all occupied unit numbers for a given face.
 * @param {Device[]} devices
 * @param {"front"|"rear"} face
 * @returns {Set<number>}
 */
export function getOccupiedUnits(devices, face) {
  const occupied = new Set();
  for (const d of devices) {
    if (d.face !== face) continue;
    for (let u = d.position; u < d.position + d.height; u++) {
      occupied.add(u);
    }
  }
  return occupied;
}

/**
 * Calculate rack utilization statistics.
 */
export function getRackUtilization(devices, totalUnits) {
  const frontOccupied = getOccupiedUnits(devices, 'front').size;
  const rearOccupied = getOccupiedUnits(devices, 'rear').size;
  return {
    front: frontOccupied,
    rear: rearOccupied,
    total: frontOccupied + rearOccupied,
    frontPercent: totalUnits > 0 ? Math.round((frontOccupied / totalUnits) * 100) : 0,
    rearPercent: totalUnits > 0 ? Math.round((rearOccupied / totalUnits) * 100) : 0,
    totalPercent: totalUnits > 0 ? Math.round(((frontOccupied + rearOccupied) / (totalUnits * 2)) * 100) : 0,
  };
}

/**
 * Convert devices to NetBox-compatible JSON array.
 * Strips internal fields (id, _color).
 * @param {Device[]} devices
 * @param {RackConfig} rackConfig
 * @returns {Object[]}
 */
export function toNetBoxJSON(devices, rackConfig) {
  return devices.map(d => ({
    name: d.name,
    manufacturer: d.manufacturer,
    device_type: d.deviceType,
    role: d.role,
    site: rackConfig.site,
    location: rackConfig.location || undefined,
    rack: rackConfig.name,
    position: d.position,
    u_height: d.height,
    face: d.face,
    status: d.status,
    serial: d.serial || undefined,
    asset_tag: d.assetTag || undefined,
    full_depth: d.fullDepth || undefined,
    comments: d.comments || undefined,
  })).map(obj => {
    // Remove undefined values
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
  });
}
