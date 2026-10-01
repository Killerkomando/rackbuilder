// Service Worker for offline capability

const CACHE_NAME = 'rackbuilder-v6';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/state.js',
  './js/rack-model.js',
  './js/rack-view.js',
  './js/device-form.js',
  './js/drag-drop.js',
  './js/export.js',
  './js/utils.js',
  './js/i18n.js',
  './js/netbox-autocomplete.js',
  './js/csv.js',
  './js/zip.js',
  './js/import-profiles.js',
  './js/import-engine.js',
  './js/module-import.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Never cache cross-origin requests (e.g. the NetBox API)
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
