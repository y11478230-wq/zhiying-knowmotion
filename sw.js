const CACHE = 'zhiying-shell-v20';
const SHELL = ['/', '/index.html', '/app.js', '/brand.js', '/particle-scene.js', '/particle-splash.css', '/brand-camera.png', '/send.svg', '/settings.svg', '/community.js', '/renderer.js', '/styles.css', '/light.css', '/flow.css', '/community.css', '/manifest.webmanifest', '/icon.svg', '/vendor/capacitor-core.js'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (!SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(async () => (await caches.match(event.request)) || caches.match('/index.html')));
});
