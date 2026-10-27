/* Batch 3: offline progress and download state, artwork CORS, the service
   worker (loaded in a simulated worker global), the local-date daily game,
   the silhouette's neutral alt text and the resumable daily.
   ATLAS_DIR points the suite at another checkout (used to prove the tests
   fail on the code before the fix). */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { JSDOM } = require('jsdom');
const { waitFor, trackErrors, finish, crash } = require('./harness');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');

const dir = process.env.ATLAS_DIR || path.resolve(__dirname, '..');
const html = fs.readFileSync(dir + '/index.html', 'utf8');
const appjs = fs.readFileSync(dir + '/app.js', 'utf8');
const swjs = fs.readFileSync(dir + '/sw.js', 'utf8');

let fail = 0;
const ok = (label, cond) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) fail++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
/* A silent early exit (an awaited promise that never settles) must fail loudly. */
let finished = false;
process.on('exit', code => {
  if (!finished && code === 0) { console.log('  FAIL  suite ended before completing'); process.exitCode = 1; }
});

/* Uncaught runtime errors anywhere are failures. */
const runtimeErrors = [], allErrs = [];
const noteError = kind => e => {
  const msg = kind + ': ' + ((e && e.stack) || e);
  runtimeErrors.push(msg);
  console.log('  FAIL  ' + msg);
};
process.on('uncaughtException', noteError('uncaught'));
/* Rejected promises and every window's page errors land in runtimeErrors too. */
trackErrors({ addEventListener() {} }, runtimeErrors);

/* ================================================================== */
/* SERVICE WORKER, simulated                                           */
/* ================================================================== */

class MResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.type = init.type || 'basic';
    this.ok = init.ok ?? (this.status >= 200 && this.status < 300);
    this.redirected = !!init.redirected;
  }
  clone() { return new MResponse(this.body, { status: this.status, type: this.type, ok: this.ok, redirected: this.redirected }); }
  static error() { return new MResponse(null, { status: 0, type: 'error', ok: false }); }
}
const opaque = () => new MResponse(null, { status: 0, type: 'opaque', ok: false });

const BASE = 'https://x.test/atlas/';
const norm = k => new URL(typeof k === 'string' ? k : k.url, BASE + 'sw.js').href;

function makeSW() {
  const handlers = {};
  const store = new Map();            // cache name -> Map(url -> response)
  const stats = { keysCalls: 0, claimed: 0, skipped: 0, fetches: [], timeouts: [] };
  const mkCache = name => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      async match(req) { return m.get(norm(req)); },
      async put(req, res) { const u = norm(req); m.delete(u); m.set(u, res); },
      async addAll(list) { for (const u of list) m.set(norm(u), new MResponse('precached:' + u)); },
      async keys() { stats.keysCalls++; return [...m.keys()].map(url => ({ url })); },
      async delete(req) { return m.delete(norm(req)); }
    };
  };
  const sandbox = {
    self: {
      location: { origin: 'https://x.test', href: BASE + 'sw.js' },
      addEventListener: (t, fn) => { handlers[t] = fn; },
      skipWaiting: () => { stats.skipped++; },
      clients: { claim: () => { stats.claimed++; }, matchAll: async () => (sandbox.openClients || []).map(id => ({ id })) }
    },
    caches: {
      open: async n => mkCache(n),
      keys: async () => [...store.keys()],
      delete: async n => store.delete(n),
      async match(req) { for (const m of store.values()) if (m.has(norm(req))) return m.get(norm(req)); }
    },
    fetch: async req => { stats.fetches.push(req.url); return sandbox.fetchImpl(req); },
    fetchImpl: async () => new MResponse('default'),
    Response: MResponse,
    URL,
    setTimeout: (fn, ms) => { stats.timeouts.push(ms); return setTimeout(fn, ms >= 1000 ? 5 : ms); },
    clearTimeout
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(swjs, ctx);

  async function fire(type, ev, noWait) {
    const waits = [];
    let responded = false, resp;
    ev.waitUntil = p => { waits.push(Promise.resolve(p)); };
    ev.respondWith = p => { responded = true; resp = Promise.resolve(p); };
    handlers[type](ev);
    const res = responded ? await resp : undefined;
    /* A hung fetch keeps its waitUntil open (a real worker is killed by the browser). */
    if (!noWait) await Promise.all(waits);
    return { responded, res };
  }
  const fetchEv = (url, o = {}) => fire('fetch', { request: { url, method: o.method || 'GET', mode: o.mode || 'cors' }, clientId: o.clientId || 'page-loaded-under-worker' }, o.noWait);
  const cacheMap = name => store.get(name) || new Map();
  const read = expr => { try { return vm.runInContext(expr, ctx); } catch { return undefined; } };
  return { sandbox, store, stats, fire, fetchEv, cacheMap, read };
}

async function serviceWorkerTests() {
  const ART = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/';

  console.log('\n--- SERVICE WORKER: install and activate ---');
  {
    const sw = makeSW();
    await sw.fire('install', {});
    const shell = sw.cacheMap(sw.read('SHELL_CACHE'));
    ok('install precaches the app shell', ['./', './index.html', './styles.css', './app.js', './assets/icon.svg', './manifest.webmanifest']
      .every(u => shell.has(norm(u))));
    ok('install calls skipWaiting', sw.stats.skipped === 1);
    ok('artwork cache is v2 so old opaque entries are purged', sw.read('ART_CACHE') === 'atlasdex-art-v2');

    for (const n of ['atlasdex-art-v1', 'atlasdex-shell-v4', 'other-app', sw.read('SHELL_CACHE'), sw.read('ART_CACHE')]) sw.store.set(n, new Map());
    await sw.fire('activate', {});
    ok('activate deletes every cache not in KEEP', JSON.stringify([...sw.store.keys()].sort())
      === JSON.stringify([sw.read('ART_CACHE'), sw.read('SHELL_CACHE')].sort()));
    ok('activate drops the v1 artwork cache', !sw.store.has('atlasdex-art-v1'));
    ok('activate claims clients', sw.stats.claimed === 1);
  }

  console.log('\n--- SERVICE WORKER: artwork cache ---');
  {
    const sw = makeSW();
    const url = ART + '25.png';
    sw.sandbox.fetchImpl = async () => new MResponse('png-bytes', { type: 'cors' });
    let r = await sw.fetchEv(url);
    ok('artwork request is handled by the worker', r.responded && r.res.body === 'png-bytes');
    ok('an ok CORS response is cached', sw.cacheMap('atlasdex-art-v2').has(norm(url)));
    const before = sw.stats.fetches.length;
    r = await sw.fetchEv(url);
    ok('second request is served from the cache', r.res.body === 'png-bytes' && sw.stats.fetches.length === before);

    sw.sandbox.fetchImpl = async () => opaque();
    r = await sw.fetchEv(ART + '26.png');
    ok('opaque response is passed through', r.res.type === 'opaque');
    ok('opaque response is NOT cached', !sw.cacheMap('atlasdex-art-v2').has(norm(ART + '26.png')));

    sw.sandbox.fetchImpl = async () => new MResponse('claimed-ok', { type: 'opaque', ok: true });
    await sw.fetchEv(ART + '27.png');
    ok('anything typed opaque is NOT cached even if ok is claimed', !sw.cacheMap('atlasdex-art-v2').has(norm(ART + '27.png')));

    sw.sandbox.fetchImpl = async () => new MResponse('nope', { status: 404, type: 'cors' });
    r = await sw.fetchEv(ART + '9999.png');
    ok('a 404 is passed through', r.res.status === 404);
    ok('a 404 is NOT cached', !sw.cacheMap('atlasdex-art-v2').has(norm(ART + '9999.png')));
    sw.sandbox.fetchImpl = async () => new MResponse('boom', { status: 500, type: 'cors' });
    await sw.fetchEv(ART + '9998.png');
    ok('a 500 is NOT cached', !sw.cacheMap('atlasdex-art-v2').has(norm(ART + '9998.png')));

    sw.sandbox.fetchImpl = async () => { throw new TypeError('network down'); };
    r = await sw.fetchEv(ART + '30.png');
    ok('a failed artwork fetch with no copy yields a network error, not undefined', r.res && r.res.type === 'error');
  }

  console.log('\n--- SERVICE WORKER: artwork cache cap ---');
  {
    const sw = makeSW();
    const cap = sw.read('ART_MAX') ?? 2500;
    ok('the art cap is about 2500', cap >= 2000 && cap <= 3000 && sw.read('ART_MAX') === cap);
    const cache = sw.store.set('atlasdex-art-v2', new Map()).get('atlasdex-art-v2');
    for (let i = 0; i < cap + 100; i++) cache.set(ART + 'old' + i + '.png', new MResponse('x'));
    sw.sandbox.fetchImpl = async () => new MResponse('new', { type: 'cors' });
    await sw.fetchEv(ART + 'fresh1.png');
    ok('the cache is trimmed back to the cap', cache.size === cap);
    ok('the oldest entries are the ones deleted', !cache.has(ART + 'old0.png') && !cache.has(ART + 'old100.png')
      && cache.has(ART + 'old101.png') && cache.has(ART + 'fresh1.png'));
    const calls = sw.stats.keysCalls;
    for (let i = 2; i <= 50; i++) await sw.fetchEv(ART + 'fresh' + i + '.png');
    ok('the cap is not re-checked on every insert', sw.stats.keysCalls === calls);
    await sw.fetchEv(ART + 'fresh51.png');
    ok('it is re-checked every 50 inserts', sw.stats.keysCalls === calls + 1);
    ok('size stays bounded near the cap', cache.size <= cap + 50);
  }

  console.log('\n--- SERVICE WORKER: app shell, network first ---');
  {
    const sw = makeSW();
    const js = BASE + 'app.js';
    sw.store.set(sw.read('SHELL_CACHE'), new Map([[js, new MResponse('old-app')]]));
    sw.sandbox.fetchImpl = async () => new MResponse('new-app');
    const r = await sw.fetchEv(js);
    ok('same-origin request goes to the network first', sw.stats.fetches.includes(js) && r.res.body === 'new-app');
    ok('a successful fetch refreshes the cache', sw.cacheMap(sw.read('SHELL_CACHE')).get(js).body === 'new-app');

    sw.sandbox.fetchImpl = async () => new MResponse('missing', { status: 404 });
    const m = await sw.fetchEv(BASE + 'gone.js');
    ok('a 404 is passed through', m.res.status === 404);
    ok('a 404 is NOT cached', !sw.cacheMap(sw.read('SHELL_CACHE')).has(BASE + 'gone.js'));

    sw.sandbox.fetchImpl = async () => { throw new TypeError('offline'); };
    const off = await sw.fetchEv(js);
    ok('offline falls back to the cached copy', off.res.body === 'new-app');
    const none = await sw.fetchEv(BASE + 'never-seen.css');
    ok('offline with nothing cached yields a network error', none.res.type === 'error');
  }
  {
    const sw = makeSW();
    await sw.fire('install', {});
    sw.sandbox.fetchImpl = async () => { throw new TypeError('offline'); };
    let r = await sw.fetchEv(BASE + '?utm_source=x', { mode: 'navigate' });
    ok('an offline navigation falls back to the cached shell', r.res.body === 'precached:./');
    sw.cacheMap(sw.read('SHELL_CACHE')).delete(norm('./'));
    r = await sw.fetchEv(BASE + 'some/deep/link', { mode: 'navigate' });
    ok('then to index.html when "./" is missing', r.res.body === 'precached:./index.html');
    r = await sw.fetchEv(BASE + 'nonexistent.png');
    ok('a non-navigation request does not get the shell', r.res.type === 'error');
  }
  {
    const sw = makeSW();
    const js = BASE + 'app.js';
    sw.store.set(sw.read('SHELL_CACHE'), new Map([[js, new MResponse('cached-app')]]));
    sw.sandbox.fetchImpl = () => new Promise(() => {});
    const r = await sw.fetchEv(js, { noWait: true });
    ok('a hung network falls back to the cache after the timeout', r.res.body === 'cached-app');
    ok('the timeout is about 4 seconds', sw.stats.timeouts.includes(4000));
  }
  {
    const sw = makeSW();
    sw.sandbox.fetchImpl = () => new Promise(res => setTimeout(() => res(new MResponse('slow-but-fine')), 40));
    const r = await sw.fetchEv(BASE + 'late.js');
    ok('a slow network with nothing cached still gets its answer', r.res.body === 'slow-but-fine');
    ok('and that late answer is cached', sw.cacheMap(sw.read('SHELL_CACHE')).has(BASE + 'late.js'));
  }
  {
    const sw = makeSW();
    ok('non-GET requests are ignored', !(await sw.fetchEv(BASE + 'app.js', { method: 'POST' })).responded);
    ok('other cross-origin requests are ignored', !(await sw.fetchEv('https://pokeapi.co/api/v2/pokemon/1')).responded);
  }
}

/* ================================================================== */
/* APP IN JSDOM                                                        */
/* ================================================================== */

const API = 'https://pokeapi.co/api/v2';
const TY = ['fire', 'water', 'grass', 'electric', 'flying', 'steel', 'ghost', 'dragon'];
const NSPECIES = 60;
const mkPoke = (id, name, types) => ({
  id, name, height: 10, weight: 100, base_experience: 60,
  species: { url: '/pokemon-species/' + (id > 10000 ? 26 : id) + '/' },
  types: types.map(t => ({ type: { name: t } })),
  stats: [['hp', 60, 1], ['attack', 80, 2], ['defense', 70, 0], ['special-attack', 90, 0], ['special-defense', 75, 0], ['speed', 100, 0]]
    .map(([n, v, e]) => ({ base_stat: v, effort: e, stat: { name: n } })),
  abilities: [{ ability: { name: 'blaze' }, is_hidden: false }],
  moves: [{ move: { name: 'ember' }, version_group_details: [{ level_learned_at: 7, move_learn_method: { name: 'level-up' } }] }],
  sprites: { other: { 'official-artwork': { front_default: 'x.png', front_shiny: 's.png' } } }, cries: { latest: 'c.ogg' }
});

function pokeData(url) {
  const m = url.includes.bind(url);
  if (m('pokemon-species?')) return { results: Array.from({ length: NSPECIES }, (_, i) => ({ name: 'mon' + (i + 1), url: '/pokemon-species/' + (i + 1) + '/' })) };
  if (m('/item?limit')) return { results: ['potion', 'oran-berry'].map((n, i) => ({ name: n, url: '/item/' + (i + 1) + '/' })) };
  if (m('/move?limit') || m('/ability?limit')) return { results: [] };
  if (m('/item/')) {
    const n = url.split('/item/')[1].replace(/\/$/, '');
    return { name: n, cost: 200, fling_power: 30, category: { name: 'healing' }, sprites: { default: 'i.png' },
      effect_entries: [{ language: { name: 'en' }, short_effect: 'Restores HP.' }], held_by_pokemon: [] };
  }
  if (m('/pokemon-species/')) {
    const sid = +url.match(/pokemon-species\/(\d+)/)[1];
    return { name: 'mon' + sid, id: sid, gender_rate: 4, capture_rate: 45, hatch_counter: 20, base_happiness: 50,
      egg_groups: [{ name: 'monster' }], growth_rate: { name: 'medium-slow' }, habitat: { name: 'forest' }, shape: { name: 'upright' },
      varieties: [{ is_default: true, pokemon: { name: 'mon' + sid, url: '/pokemon/' + sid + '/' } }],
      is_legendary: false, is_mythical: false, is_baby: false,
      flavor_text_entries: [{ language: { name: 'en' }, flavor_text: 'A test mon.' }],
      genera: [{ language: { name: 'en' }, genus: 'Test Pokémon' }], evolution_chain: { url: '/evolution-chain/1/' } };
  }
  if (m('/evolution-chain/')) return { chain: { species: { name: 'mon1', url: '/pokemon-species/1/' }, evolves_to: [] } };
  const pm = url.match(/\/pokemon\/(\d+)/);
  if (pm) { const id = +pm[1]; return mkPoke(id, 'mon' + id, [TY[id % TY.length], TY[(id + 3) % TY.length]]); }
  return {};
}

const dexUrls = () => {
  const u = [];
  for (let i = 1; i <= NSPECIES; i++) { u.push(`${API}/pokemon/${i}`); u.push(`${API}/pokemon-species/${i}`); }
  return u;
};

async function boot(o = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://x.test/', pretendToBeVisual: true });
  const w = dom.window;
  const c = { w, dom, d: w.document, online: o.online !== false, fetchLog: [], hooks: { fail: null, gate: null }, copied: null };
  c.$ = id => c.d.getElementById(id);
  c.click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  c.toast = () => c.$('toast').textContent;
  c.errs = trackErrors(w);
  allErrs.push(c.errs);

  w.fetch = async url => {
    c.fetchLog.push(url);
    if (c.hooks.gate) { const g = c.hooks.gate(url); if (g) await g; }
    if (c.hooks.fail && c.hooks.fail(url)) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => pokeData(url) };
  };
  w.indexedDB = new IDBFactory();
  w.IDBKeyRange = IDBKeyRange;
  w.Audio = function () { return { play: async () => {} }; };
  w.confirm = () => true;
  w.CSS = { escape: s => s.replace(/[^a-zA-Z0-9_-]/g, '\\$&') };
  Object.defineProperty(w.navigator, 'onLine', { get: () => c.online, configurable: true });
  w.navigator.storage = { estimate: async () => ({ usage: 5e7, quota: 2e9 }), persist: async () => true };
  w.navigator.clipboard = { writeText: async t => { c.copied = t; } };
  w.localStorage.clear();
  for (const [k, v] of Object.entries(o.ls || {})) w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));

  if (o.now != null) {
    w.__now = o.now;
    w.eval(`(function () {
      const Real = Date;
      window.Date = class extends Real {
        constructor(...a) { if (a.length === 0) super(window.__now); else super(...a); }
        static now() { return window.__now; }
      };
    })();`);
  }
  w.eval(appjs);
  await waitFor(() => c.d.querySelectorAll('.poke-card').length > 0);
  /* The grid fetches details for its visible cards; wait until it goes quiet so
     later request counts are the test's own. */
  for (let last = -1, n = 0; n < 40 && last !== c.fetchLog.length; n++) { last = c.fetchLog.length; await wait(120); }
  c.go = async hash => { w.location.hash = hash; await wait(30); };
  c.seed = urls => new Promise((res, rej) => {
    const r = w.indexedDB.open('atlasdex', 1);
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const db = r.result, tx = db.transaction('api', 'readwrite'), s = tx.objectStore('api');
      urls.forEach(u => s.put({ seeded: true }, u));
      tx.oncomplete = () => { db.close(); res(); };
    };
  });
  c.keys = () => new Promise((res, rej) => {
    const r = w.indexedDB.open('atlasdex', 1);
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const db = r.result, q = db.transaction('api', 'readonly').objectStore('api').getAllKeys();
      q.onsuccess = () => { db.close(); res(q.result); };
    };
  });
  /* Let pending renders settle before the window goes away. */
  c.close = async () => { await wait(250); try { w.close(); } catch {} };
  return c;
}

const label = c => (c.$('dlLabel') || {}).textContent || '';
const stateText = c => (c.d.querySelector('.off-top small') || {}).textContent || '';
const mainButton = c => (c.d.querySelector('.offline-card .detail-actions button') || {}).textContent || '';
const dexFetches = (c, from = 0) => c.fetchLog.slice(from).filter(u => /\/pokemon(-species)?\/\d+$/.test(u));

async function offlineTests() {
  console.log('\n--- OFFLINE PROGRESS COUNTS ONLY DEX RECORDS ---');
  {
    const c = await boot();
    const dexSet = new Set(dexUrls());
    /* The grid has already cached a few dex records by the time the page is up. */
    const dexCount = async () => (await c.keys()).filter(k => dexSet.has(k)).length;
    const lbl = n => `${n} / 120 records · ${Math.round(n / 120 * 100)}%`;
    /* A big pile of non-dex records, as if the moves/items dexes had been browsed. */
    await c.seed(Array.from({ length: 130 }, (_, i) => `${API}/item/${i + 1}`));
    const n0 = await dexCount();
    ok('the fixture has fewer than 120 dex records but more than 120 records overall', n0 < 120 && (await c.keys()).length > 120);
    await c.go('#/matchups'); await c.go('#/offline');
    await waitFor(() => /records/.test(label(c)));
    ok('non-dex records do not count', label(c).trim() === lbl(n0));
    ok('so the dex is not reported as fully available', stateText(c) === 'PARTIALLY CACHED');
    ok('and the button offers resume/download, not refresh', mainButton(c) !== 'Refresh cache');

    const urls = dexUrls();
    await c.seed(urls.slice(60, 80));
    const n1 = await dexCount();
    await c.go('#/matchups'); await c.go('#/offline');
    await waitFor(() => label(c).trim() === lbl(n1));
    ok('only the exact dex URLs present are counted', n1 >= 20 && label(c).trim() === lbl(n1));
    ok('a partial cache offers resume', mainButton(c) === 'Resume download');

    /* Hold the network, then check the live label agrees with the first render. */
    const release = []; c.hooks.gate = u => /\/pokemon(-species)?\/\d+$/.test(u) ? new Promise(r => release.push(r)) : null;
    c.click(c.d.querySelector('[data-dlstart]'));
    await waitFor(() => release.length >= 6);
    ok('the running label uses the same dex-only count', label(c).trim() === lbl(n1));
    ok('and the card says DOWNLOADING', stateText(c) === 'DOWNLOADING');
    c.hooks.gate = null; release.forEach(r => r());
    await waitFor(() => /ready/.test(c.toast()));
    await c.go('#/matchups'); await c.go('#/offline');
    await waitFor(() => /^120 \//.test(label(c).trim()));
    ok('every dex record present reads as fully available', stateText(c) === 'FULLY AVAILABLE OFFLINE' && label(c).trim() === lbl(120));
    ok('and offers a refresh', mainButton(c) === 'Refresh cache');
    await c.close();
  }

  console.log('\n--- DOWNLOAD STATE ---');
  {
    const c = await boot();
    await c.go('#/offline');
    await waitFor(() => c.d.querySelector('[data-dlstart]'));
    const btn = c.d.querySelector('[data-dlstart]');
    const before = c.fetchLog.length;
    c.click(btn);
    ok('Pause shows at once, before any await settles', !!c.d.querySelector('[data-dlstop]') && !c.d.querySelector('[data-dlstart]'));
    c.click(btn);                      /* a second click on the same button */
    c.click(btn);
    /* A start control that is still live (a stale render, keyboard activation)
       must be refused by the state itself, not just by the button being swapped out. */
    const stale = c.d.createElement('button');
    stale.setAttribute('data-dlstart', '1');
    c.$('panel').appendChild(stale);
    c.click(stale);
    await waitFor(() => /ready/.test(c.toast()));
    const log = dexFetches(c, before);
    const counts = new Map(); log.forEach(u => counts.set(u, (counts.get(u) || 0) + 1));
    ok('a second click does not start a second download (no URL fetched twice)', [...counts.values()].every(n => n === 1) && counts.size > 0);
    ok('a clean run ends with the ready toast', /Offline dex ready/.test(c.toast()));
    await waitFor(() => stateText(c) === 'FULLY AVAILABLE OFFLINE');
    ok('and the view shows 120 of 120, fully available', /^120 \/ 120/.test(label(c).trim()) && stateText(c) === 'FULLY AVAILABLE OFFLINE' && !c.d.querySelector('[data-dlstop]'));
    await c.close();
  }
  {
    const c = await boot();
    await c.go('#/offline');
    await waitFor(() => c.d.querySelector('[data-dlstart]'));
    const bad = new Set([`${API}/pokemon/50`, `${API}/pokemon-species/55`]);
    c.hooks.fail = u => bad.has(u);
    c.$('toast').textContent = '';
    c.click(c.d.querySelector('[data-dlstart]'));
    await waitFor(() => c.toast() !== '' && !c.d.querySelector('[data-dlstop]'));
    ok('failures are counted in the end toast', /2 records failed/.test(c.toast()));
    ok('the end toast does not claim the dex is ready', !/ready/i.test(c.toast()));
    await waitFor(() => /^118 \//.test(label(c).trim()));
    ok('the view shows 118 of 120', /^118 \/ 120 records/.test(label(c).trim()) && stateText(c) === 'PARTIALLY CACHED');
    ok('and is resumable', mainButton(c) === 'Resume download');

    c.hooks.fail = null;
    const mark = c.fetchLog.length;
    c.$('toast').textContent = '';
    c.click(c.d.querySelector('[data-dlstart]'));
    await waitFor(() => /ready/.test(c.toast()));
    ok('resuming fetches only the two missing records', JSON.stringify(dexFetches(c, mark).sort()) === JSON.stringify([...bad].sort()));
    ok('and then reports ready', /Offline dex ready/.test(c.toast()));
    await c.close();
  }
  {
    const c = await boot();
    await c.go('#/offline');
    await waitFor(() => c.d.querySelector('[data-dlstart]'));
    const release = [];
    c.hooks.gate = u => /\/pokemon(-species)?\/\d+$/.test(u) ? new Promise(r => release.push(r)) : null;
    const mark = c.fetchLog.length;
    c.$('toast').textContent = '';
    c.click(c.d.querySelector('[data-dlstart]'));
    await waitFor(() => release.length >= 6);
    c.online = false;
    c.w.dispatchEvent(new c.w.Event('offline'));
    release.forEach(r => r());
    await waitFor(() => !c.d.querySelector('[data-dlstop]') && /offline|paused/i.test(c.toast()));
    await wait(100);
    ok('going offline stops the download cleanly', !c.d.querySelector('[data-dlstop]') && dexFetches(c, mark).length <= 6);
    ok('the toast says paused/offline, not ready', /offline/i.test(c.toast()) && !/ready/i.test(c.toast()));
    ok('the view is resumable', mainButton(c) === 'Resume download' || mainButton(c) === 'Download full dex');
    await c.close();
  }
  {
    /* The browser's offline event alone (navigator.onLine can lag) also stops it. */
    const c = await boot();
    await c.go('#/offline');
    await waitFor(() => c.d.querySelector('[data-dlstart]'));
    const release = [];
    c.hooks.gate = u => /\/pokemon(-species)?\/\d+$/.test(u) ? new Promise(r => release.push(r)) : null;
    const mark = c.fetchLog.length;
    c.click(c.d.querySelector('[data-dlstart]'));
    await waitFor(() => release.length >= 6);
    c.w.dispatchEvent(new c.w.Event('offline'));
    release.forEach(r => r());
    await waitFor(() => !c.d.querySelector('[data-dlstop]'));
    await wait(100);
    ok('the offline event stops the download after the requests in flight', dexFetches(c, mark).length <= 6 && /offline/i.test(c.toast()));
    await c.close();
  }
  {
    const c = await boot();
    await c.go('#/offline');
    await waitFor(() => c.d.querySelector('[data-dlstart]'));
    c.online = false;
    const mark = c.fetchLog.length;
    c.$('toast').textContent = '';
    c.click(c.d.querySelector('[data-dlstart]'));
    await waitFor(() => c.toast() !== '' && !c.d.querySelector('[data-dlstop]'));
    ok('starting while offline makes no dex requests', dexFetches(c, mark).length === 0);
    ok('and says so instead of claiming ready', /offline/i.test(c.toast()) && !/ready/i.test(c.toast()));
    await c.close();
  }
}

async function artworkTests() {
  console.log('\n--- ARTWORK IS REQUESTED WITH CORS ---');
  const c = await boot({ ls: { 'atlasdex:compare': [1, 2] } });
  const allCors = sel => {
    const imgs = [...c.d.querySelectorAll(sel)];
    return imgs.length > 0 && imgs.every(i => i.getAttribute('crossorigin') === 'anonymous');
  };
  ok('grid artwork has crossorigin=anonymous', allCors('.poke-card img'));

  await c.go('#/pokemon/5');
  await waitFor(() => c.d.querySelector('.detail-hero img'));
  ok('detail hero has crossorigin=anonymous', allCors('.detail-hero img'));
  c.click(c.$('closeModal'));

  await c.go('#/compare');
  await waitFor(() => c.d.querySelector('.comparebox img'));
  ok('compare boxes have crossorigin=anonymous', allCors('.comparebox img'));
  c.click(c.$('closeModal'));

  await c.go('#/items');
  await waitFor(() => c.d.querySelector('.dexrow.item img'));
  ok('item rows have crossorigin=anonymous', allCors('.dexrow.item img'));

  await c.go('#/item/potion');
  await waitFor(() => c.d.querySelector('.itemart img'));
  ok('item detail has crossorigin=anonymous', allCors('.itemart img'));
  c.click(c.$('closeModal'));

  await c.go('#/');
  const img = c.d.querySelector('.poke-card img');
  const handler = img.getAttribute('onerror');
  const fire = () => new c.w.Function(handler).call(img);
  const primary = img.getAttribute('src');
  fire();
  const fb = img.getAttribute('src') || img.src;
  ok('the onerror fallback still swaps in the plain sprite', /sprites\/pokemon\/\d+\.png$/.test(fb) && !/official-artwork/.test(fb) && fb !== primary);
  ok('the fallback attempts once only', img.onerror === null);
  await c.close();
}

/* ------------------------------------------------------------------ */
/* THE DAILY GAME                                                      */
/* ------------------------------------------------------------------ */

const optionsOf = c => [...c.d.querySelectorAll('.guessbtn')].map(b => b.textContent.trim()).join(',');
async function playOut(c, picks = () => 0, before = () => {}) {
  /* Answer all five questions; returns the options shown for each. before(i)
     runs just before question i is answered (used to move the clock). */
  if (!c.d.querySelector('[data-game="daily"]')) { await c.go('#/game'); await wait(20); }
  c.click(c.d.querySelector('[data-game="daily"]'));
  await waitFor(() => c.d.querySelector('.silhouette'));
  const shown = [];
  for (let i = 0; i < 5; i++) {
    await waitFor(() => c.d.querySelectorAll('.guessbtn').length === 4);
    shown.push(optionsOf(c));
    before(i);
    c.click(c.d.querySelectorAll('.guessbtn')[picks(i)]);
    await waitFor(() => c.d.querySelector('[data-gamenext]'));
    c.click(c.d.querySelector('[data-gamenext]'));
    await wait(10);
  }
  await waitFor(() => c.d.querySelector('[data-share]'));
  return shown.join('|');
}
const stats = c => JSON.parse(c.w.localStorage.getItem('atlasdex:game') || 'null');
const at = iso => Date.parse(iso);

async function dateTests() {
  console.log('\n--- DAILY CHALLENGE FOLLOWS THE LOCAL DATE ---');
  process.env.TZ = 'Asia/Dhaka';          /* UTC+6, no DST */

  /* Same Dhaka date (11 Mar), different UTC dates (10th and 11th). */
  const early = await boot({ now: at('2026-03-10T19:00:00Z') });
  const fpEarly = await playOut(early);
  await early.close();
  const late = await boot({ now: at('2026-03-11T10:00:00Z') });
  const fpLate = await playOut(late);
  await late.close();
  ok('the same local date gives the same puzzle across a UTC date change', fpEarly === fpLate);

  /* Same UTC date (10 Mar), different Dhaka dates (10th and 11th). */
  const a = await boot({ now: at('2026-03-10T17:00:00Z') });
  const fpA = await playOut(a);
  await a.close();
  const b = await boot({ now: at('2026-03-10T18:30:00Z') });
  const fpB = await playOut(b);
  ok('different local dates give different puzzles even within one UTC date', fpA !== fpB);

  /* Streak and share text use the local date. */
  const old = { streak: 3, best: 3, lastDaily: '2026-03-10', lastScore: 4 };
  await b.go('#/game');
  b.click(b.d.querySelector('[data-gamemenu]'));
  await wait(20);
  const menu = b.$('panel').innerHTML;
  ok('the menu says it resets at midnight your time', /resets at midnight your time/.test(menu));
  await b.close();

  const s = await boot({ now: at('2026-03-10T19:00:00Z'), ls: { 'atlasdex:game': old } });
  await s.go('#/game');
  ok('local 11 Mar with lastDaily 10 Mar is not "done today"', !/Replay today/.test(s.$('panel').innerHTML));
  await playOut(s);
  ok('local yesterday continues the streak (3 -> 4)', stats(s).streak === 4 && stats(s).best === 4);
  ok('lastDaily is stored under the local date', stats(s).lastDaily === '2026-03-11');
  s.click(s.d.querySelector('[data-share]'));
  await waitFor(() => s.copied);
  ok('the share text shows the local date', s.copied.includes('2026-03-11') && !s.copied.includes('2026-03-10'));
  ok('and the streak', /Streak: 4/.test(s.copied));
  await s.close();

  const t = await boot({ now: at('2026-03-10T19:00:00Z'), ls: { 'atlasdex:game': { streak: 5, best: 9, lastDaily: '2026-03-11', lastScore: 3 } } });
  await t.go('#/game');
  ok('lastDaily equal to the local date counts as played today', /Replay today/.test(t.$('panel').innerHTML) && /3\/5/.test(t.$('panel').innerHTML));
  await playOut(t, () => 0);
  ok('a replay leaves the streak and score alone', stats(t).streak === 5 && stats(t).lastScore === 3);
  await t.close();

  /* localDates marks stats recorded since dates became local, so no grace day applies. */
  const g = await boot({ now: at('2026-03-10T19:00:00Z'), ls: { 'atlasdex:game': { streak: 7, best: 7, lastDaily: '2026-03-09', lastScore: 5, localDates: true } } });
  await playOut(g);
  ok('a lastDaily older than yesterday resets the streak to 1 and keeps the best', stats(g).streak === 1 && stats(g).best === 7);
  await g.close();

  for (const junk of [12345, null, '', 'not-a-date', {}]) {
    const j = await boot({ now: at('2026-03-10T19:00:00Z'), ls: { 'atlasdex:game': { streak: 2, best: 2, lastDaily: junk, lastScore: 1 } } });
    await playOut(j);
    ok(`unusable saved lastDaily (${JSON.stringify(junk)}) does not crash and restarts the streak`, stats(j).streak === 1 && j.errs.length === 0);
    await j.close();
  }

  console.log('\n--- YESTERDAY IS DST SAFE ---');
  process.env.TZ = 'America/New_York';
  /* 00:30 EDT on 9 Mar, the morning after the spring-forward: minus 24 h would land on the 7th. */
  const n = await boot({ now: at('2026-03-09T04:30:00Z'), ls: { 'atlasdex:game': { streak: 3, best: 3, lastDaily: '2026-03-08', lastScore: 2 } } });
  await playOut(n);
  ok('the day after a DST change still counts as consecutive', stats(n).streak === 4 && stats(n).lastDaily === '2026-03-09');
  await n.close();
  const n2 = await boot({ now: at('2026-11-02T05:30:00Z'), ls: { 'atlasdex:game': { streak: 3, best: 3, lastDaily: '2026-11-01', lastScore: 2 } } });
  await playOut(n2);
  ok('and the day after the autumn change too', stats(n2).streak === 4 && stats(n2).lastDaily === '2026-11-02');
  await n2.close();
  process.env.TZ = 'Asia/Dhaka';
}

async function silhouetteTests() {
  console.log('\n--- THE SILHOUETTE DOES NOT GIVE THE ANSWER AWAY ---');
  const c = await boot({ now: at('2026-05-05T08:00:00Z') });
  await c.go('#/game');
  c.click(c.d.querySelector('[data-game="daily"]'));
  await waitFor(() => c.d.querySelector('.silhouette img'));
  const names = [...c.d.querySelectorAll('.guessbtn')].map(b => b.textContent.trim());
  const sil = c.d.querySelector('.silhouette');
  const img = sil.querySelector('img');
  ok('the unrevealed image has a neutral alt', img.getAttribute('alt') === 'Mystery Pokémon silhouette');
  const attrs = [sil, ...sil.querySelectorAll('*')].flatMap(el => [...el.attributes].filter(a => !/^(src|onerror)$/.test(a.name)).map(a => a.value));
  ok('no attribute inside the silhouette names any candidate', !attrs.some(v => names.some(n => new RegExp('\\b' + n + '\\b', 'i').test(v))));
  ok('no title or ARIA text on the image or its box', !img.hasAttribute('title') && !sil.hasAttribute('title')
    && ![...sil.querySelectorAll('*'), sil].some(el => el.hasAttribute('aria-label') || el.hasAttribute('aria-describedby')));
  ok('the silhouette box has no text content', sil.textContent.trim() === '');

  /* Fail the image twice, as a dead network would. */
  const fire = () => new c.w.Function(img.getAttribute('onerror')).call(img);
  fire();
  ok('first failure retries with the plain sprite and the alt stays neutral', /sprites\/pokemon\/\d+\.png$/.test(img.getAttribute('src')) && img.getAttribute('alt') === 'Mystery Pokémon silhouette');
  img.dispatchEvent(new c.w.Event('error'));
  const src2 = img.getAttribute('src');
  ok('second failure swaps in a neutral placeholder', /^data:image\/svg\+xml,/.test(src2));
  const decoded = decodeURIComponent(src2.replace(/^data:image\/svg\+xml,/, ''));
  ok('the placeholder carries no Pokémon name', !names.some(n => new RegExp('\\b' + n + '\\b', 'i').test(decoded)) && !/mon\d/i.test(decoded));
  ok('and the alt is still neutral', img.getAttribute('alt') === 'Mystery Pokémon silhouette');

  c.click(c.d.querySelectorAll('.guessbtn')[0]);
  await waitFor(() => c.d.querySelector('.reveal-row'));
  const revealed = c.d.querySelector('.reveal-row strong').textContent.trim();
  ok('after the reveal the alt is the real name', c.d.querySelector('.silhouette img').getAttribute('alt').toLowerCase() === revealed.toLowerCase() + ' artwork');
  await c.close();
}

async function resumeTests() {
  console.log('\n--- DAILY RESUME ---');
  const NOW = at('2026-05-05T08:00:00Z');
  const key = 'atlasdex:daily';
  const dots = c => [...c.d.querySelectorAll('.gp-dot')].map(d => d.classList.contains('hit') ? 'H' : d.classList.contains('miss') ? 'M' : '.').join('');
  const answer = async (c, i) => {
    c.click(c.d.querySelectorAll('.guessbtn')[i]);
    await waitFor(() => c.d.querySelector('.reveal-row'));
  };
  const c = await boot({ now: NOW });
  await c.go('#/game');
  c.click(c.d.querySelector('[data-game="daily"]'));
  await waitFor(() => c.d.querySelector('.silhouette'));
  const q1 = optionsOf(c);
  await answer(c, 0);
  const afterQ1 = dots(c);
  c.click(c.d.querySelector('[data-gamenext]')); await wait(10);
  const q2 = optionsOf(c);
  await answer(c, 1);
  const afterQ2 = dots(c);
  const saved = JSON.parse(c.w.localStorage.getItem(key));
  ok('progress is saved under atlasdex:daily', !!saved && saved.date === '2026-05-05' && saved.q === 1
    && Array.isArray(saved.results) && saved.results.length === 2 && Number.isInteger(saved.picked));
  c.click(c.d.querySelector('[data-gamemenu]')); await wait(20);
  ok('the menu offers to resume', /Resume today/.test(c.$('panel').innerHTML) && /2\/5 answered/.test(c.$('panel').innerHTML));

  c.click(c.d.querySelector('[data-game="daily"]'));
  await waitFor(() => c.d.querySelector('.silhouette'));
  ok('restarting resumes at question 2, not question 1', /Question 2 of 5/.test(c.$('panel').innerHTML) && optionsOf(c) === q2 && optionsOf(c) !== q1);
  ok('the earlier answers are kept', dots(c).slice(0, 2) === afterQ2.slice(0, 2) && afterQ2.startsWith(afterQ1.slice(0, 1)));
  ok('the answered question stays locked', c.d.querySelector('.reveal-row') && [...c.d.querySelectorAll('.guessbtn')].every(b => b.disabled));
  const before = JSON.parse(c.w.localStorage.getItem(key));
  c.click(c.d.querySelectorAll('.guessbtn')[2]);
  ok('clicking a locked answer changes nothing', dots(c) === afterQ2 && JSON.stringify(JSON.parse(c.w.localStorage.getItem(key))) === JSON.stringify(before));

  c.click(c.d.querySelector('[data-gamenext]')); await wait(10);
  c.click(c.d.querySelector('[data-gamemenu]')); await wait(20);   /* quit on an unanswered question 3 */
  c.click(c.d.querySelector('[data-game="daily"]'));
  await waitFor(() => c.d.querySelector('.silhouette'));
  ok('quitting on an unanswered question resumes there', /Question 3 of 5/.test(c.$('panel').innerHTML) && dots(c).slice(0, 2) === afterQ2.slice(0, 2));

  for (let i = 2; i < 5; i++) {
    await answer(c, 0);
    c.click(c.d.querySelector('[data-gamenext]')); await wait(10);
  }
  await waitFor(() => c.d.querySelector('[data-share]'));
  ok('finishing records the daily once', stats(c).lastDaily === '2026-05-05' && stats(c).streak === 1);
  const score = stats(c).lastScore;
  ok('the saved progress is cleared on finish', c.w.localStorage.getItem(key) === null);

  /* Replay after finishing: allowed, never counts, never resumes. */
  c.click(c.d.querySelector('[data-gamemenu]')); await wait(20);
  ok('the menu now offers a replay that says it does not count', /Replay today/.test(c.$('panel').innerHTML) && /won't change your streak/.test(c.$('panel').innerHTML));
  c.click(c.d.querySelector('[data-game="daily"]'));
  await waitFor(() => c.d.querySelector('.silhouette'));
  ok('a replay starts from question 1', /Question 1 of 5/.test(c.$('panel').innerHTML));
  await answer(c, 0);
  ok('replay progress is not persisted', c.w.localStorage.getItem(key) === null);
  c.click(c.d.querySelector('[data-gamemenu]')); await wait(20);
  c.click(c.d.querySelector('[data-game="daily"]'));
  await waitFor(() => c.d.querySelector('.silhouette'));
  ok('a replay quit midway restarts from question 1', /Question 1 of 5/.test(c.$('panel').innerHTML));
  for (let i = 0; i < 5; i++) { await answer(c, 3); c.click(c.d.querySelector('[data-gamenext]')); await wait(10); }
  await waitFor(() => c.d.querySelector('[data-share]'));
  ok('finishing a replay leaves the first recorded score and streak', stats(c).lastScore === score && stats(c).streak === 1);
  await c.close();

  /* Bad or stale saved progress is ignored rather than trusted. */
  const cases = {
    'a different day': { date: '2026-05-04', results: [true, false], q: 1, picked: 3 },
    'results that are not booleans': { date: '2026-05-05', results: ['x', 1], q: 1, picked: 3 },
    'an index past the round': { date: '2026-05-05', results: [true], q: 9, picked: 3 },
    'a result count that does not match the index': { date: '2026-05-05', results: [true, true, true], q: 0, picked: 3 },
    'an answered question with no pick': { date: '2026-05-05', results: [true, false], q: 1, picked: null },
    'a pick that is not one of the options': { date: '2026-05-05', results: [true], q: 0, picked: 999999 },
    'plain text': 'not json{'
  };
  for (const [name, val] of Object.entries(cases)) {
    const x = await boot({ now: NOW, ls: { [key]: val } });
    await x.go('#/game');
    x.click(x.d.querySelector('[data-game="daily"]'));
    await waitFor(() => x.d.querySelector('.silhouette'));
    ok(`saved progress with ${name} is ignored`, /Question 1 of 5/.test(x.$('panel').innerHTML) && dots(x) === '.....' && x.errs.length === 0);
    await x.close();
  }
}

/* Follow-ups from the independent review of batch 3. */
async function reviewFollowUps() {
  console.log('\n--- SERVICE WORKER: review follow-ups ---');
  {
    const sw = makeSW();
    sw.sandbox.fetchImpl = async req => new MResponse('body-for:' + req.url);
    await sw.fetchEv(BASE + 'app.js?v=1');
    await sw.fetchEv(BASE + 'app.js?v=2');
    const keys = [...sw.cacheMap(sw.read('SHELL_CACHE')).keys()];
    ok('query strings share one shell entry keyed by path', keys.length === 1 && keys[0] === BASE + 'app.js');
    sw.sandbox.fetchImpl = async () => { throw new TypeError('offline'); };
    ok('and that entry answers the same path with any query offline', (await sw.fetchEv(BASE + 'app.js?v=3')).res.body === 'body-for:' + BASE + 'app.js?v=2');
  }
  {
    const sw = makeSW();
    sw.sandbox.fetchImpl = async () => new MResponse('moved', { redirected: true });
    const r = await sw.fetchEv(BASE + 'old-path/', { mode: 'navigate' });
    ok('a redirected response is passed through', r.res.body === 'moved');
    ok('but never stored, since it cannot answer a navigation later', !sw.cacheMap(sw.read('SHELL_CACHE')).has(BASE + 'old-path/'));
  }
  {
    const sw = makeSW();
    sw.sandbox.caches.open = async () => { throw new Error('QuotaExceededError'); };
    sw.sandbox.fetchImpl = async req => new MResponse('net:' + req.url, { type: 'cors' });
    const art = await sw.fetchEv('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png');
    ok('when storage fails, artwork still comes from the network', art.res && art.res.body.startsWith('net:'));
    const shell = await sw.fetchEv(BASE + 'app.js');
    ok('and so does the app shell', shell.res && shell.res.body === 'net:' + BASE + 'app.js');
  }
  {
    const sw = makeSW();
    const js = BASE + 'app.js';
    sw.store.set(sw.read('SHELL_CACHE'), new Map([[js, new MResponse('old-app')]]));
    sw.sandbox.fetchImpl = () => new Promise(res => setTimeout(() => res(new MResponse('new-app')), 40));
    const r = await sw.fetchEv(js);   // resolves only once every waitUntil promise has settled
    ok('a network slower than the timeout is answered from the cache', r.res.body === 'old-app');
    ok('the worker is kept alive (waitUntil) until the late response refreshes the cache', sw.cacheMap(sw.read('SHELL_CACHE')).get(js).body === 'new-app');
  }

  {
    /* First visit: the page was already open when the worker claimed it. */
    const art = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/1.png';
    const sw = makeSW();
    sw.sandbox.openClients = ['first-visit-tab'];
    await sw.fire('activate', {});
    ok('activate still claims the pages that are open', sw.stats.claimed === 1);
    sw.sandbox.fetchImpl = async () => new MResponse('png', { type: 'cors' });
    const early = await sw.fetchEv(art, { clientId: 'first-visit-tab' });
    ok('artwork for a page open before the claim is left to the browser (not intercepted)', !early.responded);
    ok('...and nothing is cached on its behalf', !sw.cacheMap('atlasdex-art-v2').has(norm(art)));
    const later = await sw.fetchEv(art, { clientId: 'next-page-load' });
    ok('artwork for pages loaded under the worker is still served and cached', later.responded && later.res.body === 'png' && sw.cacheMap('atlasdex-art-v2').has(norm(art)));
  }

  console.log('\n--- DAILY DATES: review follow-ups ---');
  process.env.TZ = 'Asia/Dhaka';
  const DHAKA_28_10AM = at('2026-10-28T04:00:00Z');
  {
    /* Played at 02:00 Dhaka on 27 Oct under the old UTC keys, so 26 Oct was stored. */
    const c = await boot({ now: DHAKA_28_10AM, ls: { 'atlasdex:game': { streak: 5, best: 5, lastDaily: '2026-10-26', lastScore: 3 } } });
    await playOut(c);
    const st = stats(c);
    ok('a pre-local-date lastDaily one extra day back keeps the streak once (5 -> 6)', st.streak === 6 && st.lastDaily === '2026-10-28' && st.localDates === true);
    await c.close();
  }
  {
    const c = await boot({ now: DHAKA_28_10AM, ls: { 'atlasdex:game': { streak: 5, best: 5, lastDaily: '2026-10-26', lastScore: 3, localDates: true } } });
    await playOut(c);
    ok('after the first local-date finish the grace day is gone (streak resets)', stats(c).streak === 1 && stats(c).best === 5);
    await c.close();
  }
  {
    const c = await boot({ now: DHAKA_28_10AM, ls: { 'atlasdex:game': { streak: 5, best: 5, lastDaily: '2026-10-25', lastScore: 3 } } });
    await playOut(c);
    ok('the grace is one day only: three days back still resets', stats(c).streak === 1);
    await c.close();
  }
  {
    /* Dealt at 23:59 on 27 Oct, finished at 00:01 on the 28th. */
    const c = await boot({ now: at('2026-10-27T17:59:00Z'), ls: { 'atlasdex:game': { streak: 3, best: 3, lastDaily: '2026-10-26', lastScore: 2, localDates: true } } });
    await playOut(c, () => 0, i => { if (i === 4) c.w.__now = at('2026-10-27T18:01:00Z'); });
    const st = stats(c);
    ok('a daily finished after midnight is credited to the day it was dealt', st.lastDaily === '2026-10-27' && st.streak === 4);
    c.click(c.d.querySelector('[data-share]'));
    await waitFor(() => c.copied);
    ok('and its share text shows that day', c.copied.includes('2026-10-27') && !c.copied.includes('2026-10-28'));
    c.click(c.d.querySelector('[data-gamemenu]')); await wait(20);
    ok("the new day's puzzle is still there to play", /Play today's challenge/.test(c.$('panel').innerHTML));
    await c.close();
  }
  {
    const c = await boot({ now: at('2026-10-27T17:59:00Z'), ls: { 'atlasdex:game': { streak: 3, best: 3, lastDaily: '2026-10-27', lastScore: 2, localDates: true } } });
    await playOut(c, () => 3, i => { if (i === 4) c.w.__now = at('2026-10-27T18:01:00Z'); });
    ok('a replay that runs past midnight still does not count', stats(c).streak === 3 && stats(c).lastDaily === '2026-10-27' && stats(c).lastScore === 2);
    await c.close();
  }

  console.log('\n--- DAILY RESUME: review follow-ups ---');
  const NOW = at('2026-05-05T08:00:00Z');
  const key = 'atlasdex:daily';
  {
    /* 20000 passes the structural check (a species id) but is not an option here. */
    const c = await boot({ now: NOW, ls: { [key]: { date: '2026-05-05', results: [true], q: 0, picked: 20000 } } });
    await c.go('#/game');
    const menu = c.$('panel').innerHTML;
    ok('a saved pick that is not an option is not offered as a resume', /Play today's challenge/.test(menu) && !/Resume/.test(menu));
    ok('and the stale progress is cleared', c.w.localStorage.getItem(key) === null);
    c.click(c.d.querySelector('[data-game="daily"]'));
    await waitFor(() => c.d.querySelector('.silhouette'));
    ok('the game starts at question 1', /Question 1 of 5/.test(c.$('panel').innerHTML));
    await c.close();
  }
  {
    const probe = await boot({ now: NOW });
    await probe.go('#/game');
    probe.click(probe.d.querySelector('[data-game="daily"]'));
    await waitFor(() => probe.d.querySelectorAll('.guessbtn').length === 4);
    const optionId = Number(probe.d.querySelector('.guessbtn').dataset.guess);
    await probe.close();
    /* Yesterday's progress whose pick happens to be one of today's options: only the date can reject it. */
    const c = await boot({ now: NOW, ls: { [key]: { date: '2026-05-04', results: [true], q: 0, picked: optionId } } });
    await c.go('#/game');
    ok("yesterday's progress is not offered as a resume", !/Resume/.test(c.$('panel').innerHTML));
    c.click(c.d.querySelector('[data-game="daily"]'));
    await waitFor(() => c.d.querySelector('.silhouette'));
    ok('and the game starts fresh at question 1', /Question 1 of 5/.test(c.$('panel').innerHTML) && !c.d.querySelector('.reveal-row'));
    await c.close();
  }
}

(async () => {
  for (const section of [serviceWorkerTests, offlineTests, artworkTests, dateTests, silhouetteTests, resumeTests, reviewFollowUps]) {
    try { await section(); } catch (e) { ok(`${section.name} crashed: ${e && e.stack || e}`, false); }
  }

  finished = true;
  finish(fail, [...runtimeErrors, ...allErrs.flat()], 'All tests passed');
})().catch(crash);
