const SHELL_CACHE = 'atlasdex-shell-v6';
/* v2: v1 may hold opaque (unverifiable, quota-heavy) entries from before the
   artwork was requested with CORS. Bumping the name purges them on activate. */
const ART_CACHE   = 'atlasdex-art-v2';
const KEEP = [SHELL_CACHE, ART_CACHE];

const SHELL = ['./', './index.html', './styles.css', './app.js',
               './assets/icon.svg', './manifest.webmanifest'];

/* Official artwork lives on GitHub's raw host, so it is cross-origin.
   Caching it here is what makes the Pokédex genuinely usable offline. */
const ART_HOST = 'raw.githubusercontent.com';

/* Keep the art cache bounded so it cannot eat the origin's quota (and with it
   IndexedDB, which holds the offline dex). Checked on the first insert after
   the worker starts and every ART_TRIM_EVERY inserts after that, because
   listing thousands of keys on every request would be wasteful. */
const ART_MAX = 2500;
const ART_TRIM_EVERY = 50;
let artInserts = 0;

/* How long to wait for the network before serving the cached app shell. */
const NET_TIMEOUT = 4000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

/* Pages that were already open when this worker took control. In Chrome,
   answering their artwork requests (images that started loading before the
   claim) left most cards broken on a first visit, falling back to the small
   sprites, although every response was a good 200. They load artwork
   straight from the network; caching starts with the next page load. */
const claimedMidLoad = new Set();

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k)));
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    open.forEach(c => claimedMidLoad.add(c.id));
    await self.clients.claim();
  })());
});

/* Oldest entries first: Cache.keys() returns them in insertion order. */
async function trimArt(cache) {
  const keys = await cache.keys();
  if (keys.length <= ART_MAX) return;
  await Promise.all(keys.slice(0, keys.length - ART_MAX).map(k => cache.delete(k)));
}

async function artResponse(e) {
  /* Storage can fail (quota, private mode); artwork then simply comes from the network. */
  let cache = null;
  try {
    cache = await caches.open(ART_CACHE);
    const hit = await cache.match(e.request);
    if (hit) return hit;
  } catch { cache = null; }
  try {
    const res = await fetch(e.request);
    /* Only verifiable successes are kept. An opaque response has status 0, so a
       404 or a broken image would be replayed forever, and Chrome bills each
       opaque entry as several MB of quota. */
    if (cache && res.ok && res.type !== 'opaque') {
      const clone = res.clone();
      const insert = ++artInserts;
      e.waitUntil(cache.put(e.request, clone)
        .then(() => (insert - 1) % ART_TRIM_EVERY === 0 ? trimArt(cache) : null)
        .catch(() => {}));
    }
    return res;
  } catch {
    return Response.error();
  }
}

/* Network first so a deploy reaches visitors without anyone remembering to
   bump SHELL_CACHE; the cache is the offline and slow-network fallback. */
/* Shell entries are keyed by path alone: a query string never selects a
   different file, and keying by it would let the cache grow without bound. */
const shellKey = req => { const u = new URL(req.url); return u.origin + u.pathname; };

async function shellResponse(e) {
  const req = e.request;
  const key = shellKey(req);
  let cache = null;
  try { cache = await caches.open(SHELL_CACHE); } catch { cache = null; }

  const net = fetch(req).then(res => {
    /* A redirected response cannot later answer a navigation, so it is never stored. */
    if (cache && res.ok && !res.redirected) cache.put(key, res.clone()).catch(() => {});
    return res;
  });
  /* Let a slow fetch finish in the background so the cache still refreshes. */
  e.waitUntil(net.catch(() => {}));
  /* Without storage there is nothing to fall back on: just wait for the network. */
  if (!cache) { try { return await net; } catch { return Response.error(); } }

  let timer;
  const slow = new Promise(resolve => { timer = setTimeout(() => resolve(null), NET_TIMEOUT); });
  try {
    const res = await Promise.race([net, slow]);
    if (res) return res;
  } catch { /* offline: fall through to the cache */ }
  finally { clearTimeout(timer); }

  let hit = null;
  try {
    hit = await cache.match(key)
      || (req.mode === 'navigate' && ((await cache.match('./')) || (await cache.match('./index.html'))));
  } catch { hit = null; }
  if (hit) return hit;
  /* Nothing cached: a slow network is still better than an error. */
  try { return await net; } catch { return Response.error(); }
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (url.hostname === ART_HOST) {
    if (claimedMidLoad.has(e.clientId)) return;
    e.respondWith(artResponse(e));
    return;
  }

  if (url.origin !== self.location.origin) return;

  e.respondWith(shellResponse(e));
});
