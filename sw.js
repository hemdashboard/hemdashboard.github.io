// sw.js – appskal offline. Cachar bara egna statiska filer.
// Anrop till Homey, SMHI och spotpris går alltid direkt till nätet och cachas aldrig.
// Höj CACHE vid varje release.
const CACHE = 'hd-shell-v0.3.1';
const SHELL = [
  './', './index.html', './lab.html', './manifest.webmanifest', './icons/icon.svg',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './css/tokens.css', './css/lab.css', './css/app.css',
  './js/core/keystore.js', './js/core/http.js', './js/core/controls.js', './js/core/rooms.js',
  './js/core/energy.js', './js/core/prices.js', './js/core/weather.js', './js/core/svg.js', './js/core/sun.js',
  './js/app/main.js', './js/app/state.js', './js/app/ui.js', './js/app/energy.js',
  './js/app/weather.js', './js/app/roomsview.js',
  './js/adapters/homey.js', './js/adapters/smhi.js', './js/adapters/spotpris.js',
  './js/lab/checks.js', './js/lab/main.js',
];

// Uppdatering utan ominstallation: en ny CACHE-version ger en ny service worker som tar
// över direkt (skipWaiting + clients.claim). Sidan märker bytet (controllerchange) och
// laddar om sig själv. Den installerade appen behöver aldrig installeras om.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Nät först för egna filer, cache som reserv. cache: 'no-cache' tvingar omvalidering
// mot servern: GitHub Pages cachetid (10 min) får inte ge en blandning av gamla och
// nya filer efter en release. Oförändrade filer kostar bara ett 304-svar.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
