/**
 * Lyra service worker — KAN-213 P9.
 *
 * Deliberately minimal. The goal is "installable + offline shell", not a
 * full offline-first app. Dynamic content (authed pages, MCP-style data)
 * stays network-first; the SW only intercepts static asset failures with
 * a friendly offline page.
 *
 * Strategy:
 *   - install: cache the offline-shell + icons + manifest.
 *   - activate: drop old caches.
 *   - fetch: network-first for everything; on failure, fall through to
 *     cache; if neither, serve the offline shell for HTML navigations.
 *
 * Versioning: bump CACHE_VERSION whenever the offline shell or cached
 * asset list changes. The activate step removes any cache whose name
 * doesn't start with the current version prefix.
 */

const CACHE_VERSION = 'v1-2026-05-18';
const STATIC_CACHE = `lyra-static-${CACHE_VERSION}`;

// Things we want available offline. Keep the list short — every entry
// here is bytes the user downloads on install.
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/lyra-icon-192.png',
  '/lyra-icon-512.png',
  '/lyra-logo.png',
  '/lyra-logo-nav.png',
  '/offline.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n.startsWith('lyra-') && !n.endsWith(CACHE_VERSION))
            .map((n) => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GETs. Form posts / API calls go straight to network.
  if (req.method !== 'GET') return;

  // Don't intercept POST-y dynamic routes — they need fresh auth.
  // Heuristic: anything under /api, /oauth, /auth, /dashboard, /r/, /login.
  const url = new URL(req.url);
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/oauth') ||
    url.pathname.startsWith('/auth') ||
    url.pathname.startsWith('/dashboard') ||
    url.pathname.startsWith('/r/') ||
    url.pathname === '/login' ||
    url.pathname === '/signup' ||
    url.pathname === '/reset-password' ||
    url.pathname === '/forgot-password'
  ) {
    return;
  }

  // Cross-origin requests: always network.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache successful responses for static assets only.
        if (res.ok && (url.pathname.endsWith('.png') || url.pathname.endsWith('.webmanifest') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.woff2'))) {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, clone));
        }
        return res;
      })
      .catch(() =>
        // Network failed — fall back to cache.
        caches.match(req).then((cached) => {
          if (cached) return cached;
          // For HTML navigations, return the offline shell.
          if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
            return caches.match('/offline.html');
          }
          // Otherwise re-throw — the failed network error.
          throw new Error('network failure + no cache hit');
        })
      )
  );
});
