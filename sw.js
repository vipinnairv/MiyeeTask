const CACHE = 'tm-pro-v4';
// Relative URLs so the app works whether it's served from the domain root
// or a sub-path (e.g. GitHub Pages project sites).
const ASSETS = ['./', './index.html', './manifest.json', './css/app.css', './js/app.js', './js/firebase-config.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Never cache cross-origin calls (Firebase, Google APIs, CDNs) — always go
  // to the network so auth and live data stay correct.
  if(url.origin !== self.location.origin) return;
  const fromNetwork = () => fetch(e.request).then(res => {
    if(res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  });
  // Pages and the app's own code: network first, so a refresh always gets the
  // latest release (cache-first kept users on an old build after every
  // deploy). Cache is the offline fallback.
  if(e.request.mode === 'navigate' || /\.(js|css|json)$/.test(url.pathname)){
    e.respondWith(fromNetwork().catch(() =>
      caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached => {
    const network = fromNetwork().catch(() => cached);
    return cached || network;
  }));
});
