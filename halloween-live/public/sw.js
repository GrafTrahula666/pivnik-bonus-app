const CACHE = 'pivnik-scanner-v1';
const SHELL = ['/scanner', '/style.css', '/app.bundle.js', '/icon-180.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const u = new URL(event.request.url);
  // Never cache API responses, personal QR requests, sessions or guest data.
  if (event.request.method !== 'GET' || u.origin !== self.location.origin || u.pathname.startsWith('/api/')) return;
  if (SHELL.includes(u.pathname)) event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
