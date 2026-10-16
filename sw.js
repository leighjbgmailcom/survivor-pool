// Lets phones install the site as an app. Everything still loads fresh from the network (no offline copy),
// so scores are never stale.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
