// Minimal pass-through service worker: exists so the browser treats the app as
// installable. It never caches -- the app is a dev server / live API client.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => e.respondWith(fetch(e.request)));
