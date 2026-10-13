// Rack Builder — single source of truth for the app version.
//
// Bump APP_VERSION here (and CACHE_NAME in sw.js plus EXPECTED_CACHE below) for every release.
// testing/version.test.mjs checks that README, sw.js and minimalist/index.html agree with it.

export const APP_VERSION = '0.9.0';
export const APP_CODENAME = 'Patchkabel';

// Name of the service-worker cache that ships with this version (must equal CACHE_NAME in sw.js).
export const EXPECTED_CACHE = 'rackbuilder-v9';
export const CACHE_PREFIX = 'rackbuilder-v';

/**
 * Which build is running: 'main' (index.html) or 'minimalist' (single file).
 * Each page declares it with <html data-edition="...">.
 */
export function getEdition() {
  return document.documentElement.dataset.edition === 'minimalist' ? 'minimalist' : 'main';
}

/**
 * Collect what the browser has actually loaded: caches, service worker, connectivity.
 * Never throws; every field falls back to a safe value.
 */
export async function getRuntimeInfo() {
  const info = {
    version: APP_VERSION,
    codename: APP_CODENAME,
    edition: getEdition(),
    cacheNames: [],
    serviceWorker: 'unsupported', // 'unsupported' | 'none' | 'active'
    online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  };
  if (info.edition === 'minimalist') {
    info.serviceWorker = 'none';
    return info;
  }
  try {
    if ('serviceWorker' in navigator) {
      info.serviceWorker = navigator.serviceWorker.controller ? 'active' : 'none';
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      info.cacheNames = keys.filter(k => k.startsWith('rackbuilder-'));
    }
  } catch {
    // Private mode or file:// — leave defaults
  }
  return info;
}
