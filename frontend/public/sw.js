/**
 * ANZA PWA Service Worker
 * 
 * Purpose: Handles caching, offline support, and update delivery
 * - Caches static assets for faster loading
 * - Network-first strategy for navigation (ensures fresh content when online)
 * - Cache-first strategy for static assets
 * - Skips caching for API calls - operations requiring network (Nostr publishing, payments) must not be cached
 * - Automatically cleans up old caches on activation
 * - Enables update checks every hour
 */
const CACHE_NAME = 'anza-pwa-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/images/Dynamic%20ANZA%20Media%20Logo.png',
  '/images/landing.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting(); // Activate immediately
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName); // Remove old caches
          }
        })
      );
    })
  );
  self.clients.claim(); // Take control of all pages
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // For API calls, always go to network - don't cache operations that require connectivity
  // (Nostr event publishing, payment processing must not appear to succeed offline)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // For navigation requests (HTML), network-first with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Fallback to home page if no cached page
            return caches.match('/');
          });
        })
    );
    return;
  }

  // For static assets, cache-first strategy
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request).then((response) => {
        // Don't cache non-successful responses
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });
        return response;
      });
    })
  );
});
