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
