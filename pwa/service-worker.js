const CACHE_NAME = 'onlymusic-v3';
const OFFLINE_RESPONSE = new Response('Offline', { status: 503, statusText: 'Offline' });

const ASSETS_TO_CACHE_IMMEDIATELY = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './lib/vanilla-terminal.js',
  './manifest.json',
  './icon.svg'
];

// Install: Cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE_IMMEDIATELY))
      .then(() => self.skipWaiting())
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Apply different strategies based on request type
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // Don't proxy cross-origin requests through SW cache strategies.
  if (url.origin !== self.location.origin) return;

  // 1. API Calls: Network Only (Audio streaming/Search)
  if (url.pathname.startsWith('/api/') || url.href.includes('pipedapi') || url.href.includes('invidious')) {
    return;
  }

  // 2. HTML: Network First, Fallback to Cache (Ensures fresh content)
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
          return response;
        })
        .catch(() => caches.match(event.request))
        .then(response => response || OFFLINE_RESPONSE)
    );
    return;
  }

  // 3. Static Assets (JS, CSS, JSON): Stale-While-Revalidate
  // Serve cached version immediately, but update cache in background
  if (event.request.destination === 'script' ||
    event.request.destination === 'style' ||
    event.request.destination === 'manifest') {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(event.request).then(cachedResponse => {
          const fetchPromise = fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => null);
          return cachedResponse || fetchPromise;
        });
      }).then(response => response || OFFLINE_RESPONSE)
    );
    return;
  }

  // 4. Images/Fonts: Cache First (They rarely change)
  if (event.request.destination === 'image' || event.request.destination === 'font') {
    event.respondWith(
      caches.match(event.request).then(response => {
        return response || fetch(event.request).then(networkResponse => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        }).catch(() => null);
      }).then(response => response || OFFLINE_RESPONSE)
    );
    return;
  }

  // 5. Default: Network First
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
      .then(response => response || OFFLINE_RESPONSE)
  );
});
