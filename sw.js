// ÝMIR — Service Worker
// Cache-first for static assets, network-first for API calls.
// Bump CACHE_VERSION to invalidate all caches on deploy.

var CACHE_VERSION = 'ymir-v1';
var STATIC_ASSETS = [
  '/ymir/shared/style.css',
  '/ymir/shared/tripcard.css',
  '/ymir/shared/api.js',
  '/ymir/shared/ui.js',
  '/ymir/shared/strings.js',
  '/ymir/shared/strings-en.js',
  '/ymir/shared/strings-is.js',
  '/ymir/shared/weather.js',
  '/ymir/shared/tides.js',
  '/ymir/shared/boats.js',
  '/ymir/shared/certs.js',
  '/ymir/shared/maintenance.js',
  '/ymir/shared/logbook.js',
  '/ymir/shared/mcm.js',
  '/ymir/shared/payroll.js',
  '/ymir/shared/alerts.js',
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_VERSION; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  // Never cache API calls (Google Apps Script)
  if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') {
    return;
  }

  // Never cache external APIs (weather, tides, etc.)
  if (url.hostname.includes('open-meteo') || url.hostname.includes('birk')) {
    return;
  }

  // For same-origin static assets: cache-first
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        return fetch(e.request).then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(CACHE_VERSION).then(function(cache) {
              cache.put(e.request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // For CDN assets (unpkg, fonts): cache-first with network fallback
  if (url.hostname === 'unpkg.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com') {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        return fetch(e.request).then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(CACHE_VERSION).then(function(cache) {
              cache.put(e.request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }
});
