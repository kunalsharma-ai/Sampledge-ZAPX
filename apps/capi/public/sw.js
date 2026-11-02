/*
 * ZAPX Interviewer service worker: keeps the app usable without a connection.
 * - Navigations: network first, falling back to the cached app shell.
 * - Built assets (/assets/*, hashed): cache first.
 * - Survey media (/api/public/media/*) come from the media cache the app fills when it downloads
 *   surveys; ids never change content, so cache first. No other /api request is cached; survey
 *   packages and interviews live in IndexedDB.
 */
const CACHE = 'zapx-capi-v1';
const MEDIA_CACHE = 'zapx-capi-media';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== MEDIA_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method === 'GET' && url.origin === self.location.origin && url.pathname.startsWith('/api/public/media/')) {
    // Match without the Range header so a cached full file answers video range requests too.
    event.respondWith(
      caches
        .open(MEDIA_CACHE)
        .then((c) => c.match(url.pathname))
        .then((hit) => hit || fetch(req)),
    );
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
