// Service Worker — Organizare Zi de Zi PWA
// Strategie: precache shell static, network-first pentru navigare,
// stale-while-revalidate pentru assets, fără cache pentru /api/*

const CACHE = 'ozz-v2';
const SHELL = [
  '/',
  '/index.html',
  '/organizator.html',
  '/styles.css',
  '/app.js',
  '/organizator.js',
  '/manifest.webmanifest',
  '/icon.svg',
];

// ————— PUSH —————
self.addEventListener('push', (e) => {
  e.waitUntil(
    self.registration.showNotification('Planul tau e gata', {
      body: 'Organizatorul ti-a pregatit planul de azi.',
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url: '/' },
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});

// ————— INSTALL —————
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// ————— ACTIVATE —————
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// ————— FETCH —————
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Ignoră cererile cross-origin
  if (url.origin !== self.location.origin) return;

  // NU cache-ui /api/* — sunt dinamice și autentificate
  // Lasă-le să treacă direct la rețea (network-only implicit, no fallback)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Pentru navigări (HTML): network-first cu fallback pe /index.html din cache
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .catch(() => caches.match(request).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Pentru restul aceluiași origin (assets statice): stale-while-revalidate
  // (cache-first + reîmprospătare în fundal, fără blocare)
  e.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request).then((res) => {
        if (res && res.status === 200) {
          const cloned = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, cloned));
        }
        return res;
      });
      return cached || fetched;
    }).catch(() => caches.match(request))
  );
});
