const SHELL_CACHE = 'atlasdex-shell-v5';
const ART_CACHE   = 'atlasdex-art-v1';
const KEEP = [SHELL_CACHE, ART_CACHE];

const SHELL = ['./', './index.html', './styles.css', './app.js',
               './assets/icon.svg', './manifest.webmanifest'];

/* Official artwork lives on GitHub's raw host, so it is cross-origin.
   Caching it here is what makes the Pokédex genuinely usable offline. */
const ART_HOST = 'raw.githubusercontent.com';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (url.hostname === ART_HOST) {
    e.respondWith(
      caches.open(ART_CACHE).then(cache =>
        cache.match(e.request).then(hit => hit || fetch(e.request).then(res => {
          /* Opaque responses are fine here: we only ever replay them as images. */
          if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
          return res;
        }).catch(() => hit)))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(SHELL_CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});
