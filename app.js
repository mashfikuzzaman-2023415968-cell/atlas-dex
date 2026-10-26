(() => {
'use strict';

/* ------------------------------------------------------------------ */
/* CONSTANTS                                                           */
/* ------------------------------------------------------------------ */

const API = 'https://pokeapi.co/api/v2';
const GEN = [1, 152, 252, 387, 494, 650, 722, 810, 906, Infinity];
const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX'];

const TYPES = ['normal','fire','water','electric','grass','ice','fighting','poison',
  'ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'];

const COLORS = {
  normal:'#9da3a5', fire:'#f37853', water:'#539dd7', electric:'#e6b83d',
  grass:'#68b47e', ice:'#7dc9d0', fighting:'#cb6871', poison:'#ad78cb',
  ground:'#c9a86a', flying:'#8eaddb', psychic:'#ed7e9b', bug:'#99b54c',
  rock:'#ab9b7b', ghost:'#8070bd', dragon:'#7666de', dark:'#727283',
  steel:'#7094a6', fairy:'#da92c8'
};

/* Gen 6+ type chart. Only non-1x entries are listed. */
const CHART = {
  normal:   {rock:.5, ghost:0, steel:.5},
  fire:     {fire:.5, water:.5, grass:2, ice:2, bug:2, rock:.5, dragon:.5, steel:2},
  water:    {fire:2, water:.5, grass:.5, ground:2, rock:2, dragon:.5},
  electric: {water:2, electric:.5, grass:.5, ground:0, flying:2, dragon:.5},
  grass:    {fire:.5, water:2, grass:.5, poison:.5, ground:2, flying:.5, bug:.5, rock:2, dragon:.5, steel:.5},
  ice:      {fire:.5, water:.5, grass:2, ice:.5, ground:2, flying:2, dragon:2, steel:.5},
  fighting: {normal:2, ice:2, poison:.5, flying:.5, psychic:.5, bug:.5, rock:2, ghost:0, dark:2, steel:2, fairy:.5},
  poison:   {grass:2, poison:.5, ground:.5, rock:.5, ghost:.5, steel:0, fairy:2},
  ground:   {fire:2, electric:2, grass:.5, poison:2, flying:0, bug:.5, rock:2, steel:2},
  flying:   {electric:.5, grass:2, fighting:2, bug:2, rock:.5, steel:.5},
  psychic:  {fighting:2, poison:2, psychic:.5, dark:0, steel:.5},
  bug:      {fire:.5, grass:2, fighting:.5, poison:.5, flying:.5, psychic:2, ghost:.5, dark:2, steel:.5, fairy:.5},
  rock:     {fire:2, ice:2, fighting:.5, ground:.5, flying:2, bug:2, steel:.5},
  ghost:    {normal:0, psychic:2, ghost:2, dark:.5},
  dragon:   {dragon:2, steel:.5, fairy:0},
  dark:     {fighting:.5, psychic:2, ghost:2, dark:.5, fairy:.5},
  steel:    {fire:.5, water:.5, electric:.5, ice:2, rock:2, steel:.5, fairy:2},
  fairy:    {fire:.5, fighting:2, poison:.5, dragon:2, dark:2, steel:.5}
};

/* National Dex IDs of Legendary and Mythical species, so the filter needs no
   extra network calls. Extend this list as new generations are released. */
const LEGENDARY = new Set([
  144,145,146,150,151,
  243,244,245,249,250,251,
  377,378,379,380,381,382,383,384,385,386,
  480,481,482,483,484,485,486,487,488,489,490,491,492,493,
  494,638,639,640,641,642,643,644,645,646,647,648,649,
  716,717,718,719,720,721,
  772,773,785,786,787,788,789,790,791,792,800,801,802,807,808,809,
  888,889,890,891,892,893,894,895,896,897,898,905,
  1001,1002,1003,1004,1007,1008,1009,1010,1014,1015,1016,1017,
  1020,1021,1022,1023,1024,1025
]);

const STAT_LABEL = {
  'hp':'HP', 'attack':'Attack', 'defense':'Defense',
  'special-attack':'Sp. Attack', 'special-defense':'Sp. Defense', 'speed':'Speed'
};

/* ------------------------------------------------------------------ */
/* HELPERS                                                             */
/* ------------------------------------------------------------------ */

const $ = id => document.getElementById(id);
const safe = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const title = s => String(s || '').split('-')
  .map(p => (p[0] ? p[0].toUpperCase() + p.slice(1) : '')).join(' ');
const pad = id => '#' + String(id).padStart(4, '0');
const idOf = url => Number(String(url).match(/\/(\d+)\/?$/)?.[1] || 0);
const genOf = id => GEN.findIndex((start, i) => id >= start && id < GEN[i + 1]) + 1;

/* Ids and counters reach markup and URLs from storage and imported backups,
   so they are coerced to numbers at the point of use instead of trusted. */
const toId = v => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
const int0 = v => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : 0; };
/* Own-property lookup, so a type named "constructor" never resolves to
   something inherited from Object.prototype. */
const typeColor = (t, fallback = '#8a9ab1') =>
  Object.prototype.hasOwnProperty.call(COLORS, t) ? COLORS[t] : fallback;

/* Shape checks shared by the sanitisers. They sit up here, as consts, because
   the state literal below already uses asList while it is being built. */
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => (isObj(o) && hasOwn(o, k) ? o[k] : undefined);
const inRange = (v, lo, hi) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const asList = v => (Array.isArray(v) ? v : []);

const sprite = (id, shiny) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${shiny ? 'shiny/' : ''}${toId(id)}.png`;

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function store(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2400);
}
/* ------------------------------------------------------------------ */
/* OFFLINE STORE (IndexedDB)                                           */
/* ------------------------------------------------------------------ */
/* PokéAPI payloads are effectively immutable, so every response is kept
   on disk and served cache-first. That makes the app fully usable with
   no connection once data has been seen or bulk-downloaded.           */

const DB_NAME = 'atlasdex', DB_STORE = 'api';
let dbPromise = null;

function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(DB_STORE)) d.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

function idbRun(mode, fn) {
  return db().then(d => {
    if (!d) return null;
    return new Promise(resolve => {
      try {
        const tx = d.transaction(DB_STORE, mode);
        const req = fn(tx.objectStore(DB_STORE));
        if (req) { req.onsuccess = () => resolve(req.result ?? null); req.onerror = () => resolve(null); }
        else { tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(null); }
      } catch { resolve(null); }
    });
  }).catch(() => null);
}

const idbGet   = key      => idbRun('readonly',  s => s.get(key));
const idbSet   = (key, v) => idbRun('readwrite', s => s.put(v, key));
const idbCount = ()       => idbRun('readonly',  s => s.count());
const idbClear = ()       => idbRun('readwrite', s => s.clear());
const idbKeys  = ()       => idbRun('readonly',  s => s.getAllKeys());

async function netGet(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

/* Cache first, network second, stale cache as the last resort. */
async function get(url) {
  const cached = await idbGet(url);
  if (cached) return cached;
  try {
    const data = await netGet(url);
    idbSet(url, data);
    return data;
  } catch (err) {
    const stale = await idbGet(url);
    if (stale) return stale;
    throw err;
  }
}
/* Run async jobs with a concurrency cap so we never flood PokéAPI. */
async function pool(items, limit, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const item = items[i++]; try { await worker(item); } catch {} }
  }));
}

/* ------------------------------------------------------------------ */
/* TYPE MATH                                                           */
/* ------------------------------------------------------------------ */

/* How much damage `attack` does to a Pokémon with `defTypes`. */
function effectiveness(attack, defTypes) {
  let mult = 1;
  const row = CHART[attack] || {};
  for (const d of defTypes) mult *= (d in row) ? row[d] : 1;
  return mult;
}
/* Full defensive profile: every attacking type bucketed by multiplier. */
function defensiveProfile(defTypes) {
  const out = {};
  for (const t of TYPES) out[t] = effectiveness(t, defTypes);
  return out;
}
function multLabel(m) {
  if (m === 0) return '0×';
  if (m === 0.25) return '¼×';
  if (m === 0.5) return '½×';
  if (m === 1) return '1×';
  return m + '×';
}
function multClass(m) {
  if (m === 0) return 'm-immune';
  if (m < 1) return 'm-resist';
  if (m > 1) return 'm-weak';
  return 'm-neutral';
}

/* ------------------------------------------------------------------ */
/* STATE                                                               */
/* ------------------------------------------------------------------ */

const state = {
  list: [],
  types: new Map(),      // type name -> Set of species ids
  details: new Map(),    // id -> /pokemon payload
  species: new Map(),    // id -> /pokemon-species payload
  chains: new Map(),
  moves: new Map(),      // move name -> /move payload
  abilities: new Map(),  // ability name -> /ability payload
  mode: 'all',
  gen: '', type: '', search: '', sort: 'id-asc', chip: '',
  shown: 36,
  /* Raw reads only. NATURES is a const declared much further down, so the
     strict sanitising has to wait for init() (sanitizeLoadedState); asList just
     keeps a corrupt value from throwing here and breaking boot. */
  favorites: new Set(asList(read('atlasdex:favorites', []))),
  caught: new Set(asList(read('atlasdex:caught', []))),
  teams: read('atlasdex:teams', null) || [{ name: 'Team 1', members: asList(read('atlasdex:team', [])) }],
  activeTeam: read('atlasdex:activeTeam', 0),
  compare: asList(read('atlasdex:compare', [])),
  theme: read('atlasdex:theme', 'dark'),
  shiny: read('atlasdex:shiny', false),
  modalId: null,     // species id driving the modal
  formId: null,      // /pokemon id of the variety currently shown
  tab: 'overview',
  dl: { running: false, done: 0, total: 0, stop: false },
  items: new Map(),
  indexes: { move: null, ability: null, item: null },
  browse: { kind: 'move', search: '', filter: '', sort: '', shown: 48, loadedAll: {} },
  entity: null,
  editing: null,
  calcTab: 'stats',
  calc: {
    level: 50, nature: 'adamant', iv: 31, ev: 0,
    dLevel: 50, dPower: 80, dCat: 'physical', dAtk: 120, dDef: 100,
    dStab: true, dType: 1, dCrit: false, dBurn: false, dHp: 200,
    atkId: null, defId: null, moveName: '',
    cRate: 45, cBall: 'Poké Ball', cStatus: 'None', cHp: 100, cMaxHp: 100,
    eggGroup: 'monster'
  },
  palette: { open: false, q: '', sel: 0 },
  game: null,
  gameStats: read('atlasdex:game', { streak: 0, best: 0, lastDaily: null, lastScore: null }),
  gameGen: '',
  teamFailed: new Set(),   // member ids whose /pokemon data failed to load this session
  teamLoading: new Set(),  // member ids with a request in flight
  moveMethod: 'level-up',
  moveShown: 30,
  request: 0,
  atk: 'fire', def1: 'grass', def2: ''
};

/* `state.team` stays a plain array to the rest of the app, but reads and
   writes are routed to whichever saved team is currently selected. */
Object.defineProperty(state, 'team', {
  get() {
    if (!Array.isArray(state.teams) || !state.teams.length) state.teams = [{ name: 'Team 1', members: [] }];
    return state.teams[activeIdx()].members;
  },
  set(v) {
    if (!Array.isArray(state.teams) || !state.teams.length) state.teams = [{ name: 'Team 1', members: [] }];
    state.teams[activeIdx()].members = v;
    saveTeams();
  }
});

/* One clamp for the selected team. Storage and imports can hand us an
   out-of-range or non-integer index, and every reader must agree on the
   team it lands on (rename, delete, Showdown export, tab highlight). */
function clampTeamIndex(n, len) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(len - 1, Math.trunc(n)));
}
function activeIdx() {
  return clampTeamIndex(state.activeTeam, Array.isArray(state.teams) ? state.teams.length : 0);
}
function saveTeams() {
  state.activeTeam = activeIdx();
  store('atlasdex:teams', state.teams);
  store('atlasdex:activeTeam', state.activeTeam);
}

/* ---- team member loadouts ---------------------------------------- */

const STAT_KEYS = ['hp','attack','defense','special-attack','special-defense','speed'];
const EV_TOTAL_MAX = 510, EV_STAT_MAX = 252;

function blankSpread(v) {
  const o = {};
  for (const k of STAT_KEYS) o[k] = v;
  return o;
}
function newMember(id) {
  const d = state.details.get(id);
  return {
    id,
    level: 50,
    nature: 'hardy',
    ability: d?.abilities?.find(a => !a.is_hidden)?.ability?.name || null,
    item: '',
    ivs: blankSpread(31),
    evs: blankSpread(0),
    moves: []
  };
}
/* Older saves stored plain numeric ids. Anything that is neither a number nor
   an object is not a member at all, so it becomes null and is dropped. */
function normalizeMember(m) {
  if (typeof m === 'number') {
    return { id: m, level: 50, nature: 'hardy', ability: null, item: '',
             ivs: blankSpread(31), evs: blankSpread(0), moves: [] };
  }
  if (!isObj(m)) return null;
  m.ivs = m.ivs || blankSpread(31);
  m.evs = m.evs || blankSpread(0);
  m.moves = m.moves || [];
  m.level = m.level || 50;
  m.nature = m.nature || 'hardy';
  return m;
}
function migrateTeams() {
  /* A corrupt teams value is replaced by sanitizeLoadedState() straight after. */
  if (!Array.isArray(state.teams)) return;
  for (const t of state.teams) {
    if (isObj(t)) t.members = asList(t.members).map(normalizeMember).filter(Boolean);
  }
}

/* ---- sanitising stored and imported data ------------------------- */
/* A backup is a file from a stranger, and localStorage can still hold whatever
   an earlier import left in it, so every field is rebuilt into a fresh object
   under strict rules. Unknown keys are never copied (which also rules out
   prototype pollution) and values that fail a rule fall back to the default.
   These run from init() and importData(), after NATURES exists. */

const LIMITS = { species: 20000, pokemon: 100000, list: 20000, teams: 8, members: 6, scan: 100 };
const SLUG = /^[a-z0-9-]{1,50}$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const BACKUP_VERSION = 5;

function cleanIds(list, max) {
  const out = [], seen = new Set();
  for (const v of asList(list).slice(0, LIMITS.list)) {
    if (inRange(v, 1, max) && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

/* A held item is free text in the editor; keep only what a real item name uses
   ("King's Rock", "Never-Melt Ice"). Markup characters never appear in one, so
   text containing them is not an item at all and is dropped whole rather than
   stripped into harmless-looking leftovers. */
const cleanItem = v => (typeof v !== 'string' || /[<>"`=&\\]/.test(v)
  ? '' : v.replace(/[^a-z0-9 '.-]/gi, '').slice(0, 40));

/* Older versions clamped these inputs but never truncated them, so a saved
   build can hold 12.5 where 12 was meant: truncate first, then range-check. */
const clampInt = (v, lo, hi, fallback) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : NaN;
  return n >= lo && n <= hi ? n : fallback;
};
const slugOrNull = v => (typeof v === 'string' && SLUG.test(v) ? v : null);

function sanitizeMember(raw) {
  const m = normalizeMember(raw);
  if (!m) return null;
  const id = own(m, 'id');
  if (!inRange(id, 1, LIMITS.pokemon)) return null;

  const spread = (src, fallback, max) => {
    const out = {};
    for (const k of STAT_KEYS) out[k] = clampInt(own(src, k), 0, max, fallback);
    return out;
  };
  const moves = [];
  for (const n of asList(own(m, 'moves')).slice(0, LIMITS.scan)) {
    const slug = slugOrNull(n);
    if (slug && !moves.includes(slug)) moves.push(slug);
    if (moves.length === 4) break;
  }
  const nature = slugOrNull(own(m, 'nature'));
  return {
    id,
    level: clampInt(own(m, 'level'), 1, 100, 50),
    nature: nature && hasOwn(NATURES, nature) ? nature : 'hardy',
    ability: slugOrNull(own(m, 'ability')),
    item: cleanItem(own(m, 'item')),
    ivs: spread(own(m, 'ivs'), 31, 31),
    evs: spread(own(m, 'evs'), 0, EV_STAT_MAX),
    moves
  };
}

/* Returns a clean array, or null when the value is not an array of teams. */
function sanitizeTeams(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const t of raw.slice(0, LIMITS.teams)) {
    if (!isObj(t)) continue;
    const rawName = own(t, 'name');
    const name = typeof rawName === 'string' ? rawName.trim().slice(0, 24).trim() : '';
    const seen = new Set(), members = [];
    for (const r of asList(own(t, 'members')).slice(0, LIMITS.scan)) {
      const mem = sanitizeMember(r);
      if (!mem || seen.has(mem.id)) continue;
      seen.add(mem.id); members.push(mem);
      if (members.length === LIMITS.members) break;
    }
    out.push({ name: name || 'Team ' + (out.length + 1), members });
  }
  return out;
}

function sanitizeGame(raw) {
  const count = v => (inRange(v, 0, Number.MAX_SAFE_INTEGER) ? v : 0);
  const daily = own(raw, 'lastDaily'), score = own(raw, 'lastScore'), grid = own(raw, 'lastGrid');
  return {
    streak: count(own(raw, 'streak')),
    best: count(own(raw, 'best')),
    lastDaily: typeof daily === 'string' && DATE_KEY.test(daily) ? daily : null,
    lastScore: inRange(score, 0, ROUND) ? score : null,
    lastGrid: typeof grid === 'string'
      ? Array.from(grid).filter(c => c === '🟩' || c === '🟥').slice(0, ROUND).join('') : ''
  };
}

/* Everything read from localStorage is re-validated at boot, so a malicious
   import made by an older version cannot keep running on every load. */
function sanitizeLoadedState() {
  state.favorites = new Set(cleanIds([...state.favorites], LIMITS.species));
  state.caught = new Set(cleanIds([...state.caught], LIMITS.species));
  const teams = sanitizeTeams(state.teams);
  state.teams = teams && teams.length ? teams : [{ name: 'Team 1', members: [] }];
  state.activeTeam = clampTeamIndex(state.activeTeam, state.teams.length);
  state.compare = cleanIds(state.compare, LIMITS.pokemon).slice(0, 2);
  state.theme = state.theme === 'light' ? 'light' : 'dark';
  state.shiny = state.shiny === true;
  state.gameStats = sanitizeGame(state.gameStats);

  /* Write the cleaned values back, but only where something was stored. */
  const stored = key => { try { return localStorage.getItem(key) !== null; } catch { return false; } };
  if (stored('atlasdex:favorites')) store('atlasdex:favorites', [...state.favorites]);
  if (stored('atlasdex:caught'))    store('atlasdex:caught', [...state.caught]);
  if (stored('atlasdex:teams') || stored('atlasdex:team')) saveTeams();
  /* The single-team key predates multi-team saves. Its members now live in
     atlasdex:teams, so the old copy is dropped rather than left holding junk. */
  if (stored('atlasdex:team')) { try { localStorage.removeItem('atlasdex:team'); } catch {} }
  if (stored('atlasdex:compare'))   store('atlasdex:compare', state.compare);
  if (stored('atlasdex:theme'))     store('atlasdex:theme', state.theme);
  if (stored('atlasdex:shiny'))     store('atlasdex:shiny', state.shiny);
  if (stored('atlasdex:game'))      store('atlasdex:game', state.gameStats);
}

const memberIds   = () => state.team.map(m => m.id);
const findMember  = id => state.team.find(m => m.id === id);
const hasMember   = id => state.team.some(m => m.id === id);
const evTotal     = m => STAT_KEYS.reduce((t, k) => t + (m.evs[k] || 0), 0);

/* Real stats for a configured member, falling back to a neutral level 50. */
function memberStats(m) {
  const d = state.details.get(m.id);
  if (!d) return null;
  const out = {};
  for (const s of d.stats) {
    const k = s.stat.name;
    out[k] = realStat(s.base_stat, m.ivs[k] ?? 31, m.evs[k] ?? 0, m.level, k, m.nature);
  }
  return out;
}


/* ------------------------------------------------------------------ */
/* SHARED MARKUP                                                       */
/* ------------------------------------------------------------------ */

/* The id is coerced to a positive integer first: it ends up inside URLs, an
   inline handler and attributes, and team data can come from a stored import. */
function art(rawId, cls = '') {
  const id = toId(rawId);
  const name = safe(pokeName(id) || 'Pokémon');
  const fallback = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${state.shiny ? 'shiny/' : ''}${id}.png`;
  return `<img class="${safe(cls)}" loading="lazy" src="${sprite(id, state.shiny)}" alt="${name} artwork"
    onerror="this.onerror=null;this.src='${fallback}'">`;
}
function typeBadge(t) {
  return `<span class="type" style="--type-color:${typeColor(t)}">${safe(title(t))}</span>`;
}
function typesOf(id) {
  return state.details.get(id)?.types?.map(t => t.type.name) || [];
}

/* ---- alternate forms -------------------------------------------- */
/* A species can have many varieties (Alolan, Galarian, Mega, Therian…).
   Each variety is its own /pokemon entry with its own id, types and
   stats, so everything downstream keys off the variety id.           */

function varietiesOf(species) {
  return (species?.varieties || [])
    .map(v => ({ id: idOf(v.pokemon.url), name: v.pokemon.name, isDefault: !!v.is_default }))
    .filter(v => v.id > 0);
}

/* "raichu-alola" under species "raichu" becomes "Alola". */
function formLabel(varietyName, speciesName) {
  if (varietyName === speciesName) return 'Default';
  const rest = varietyName.startsWith(speciesName + '-')
    ? varietyName.slice(speciesName.length + 1)
    : varietyName;
  return title(rest) || 'Default';
}

/* Works for variety ids (>10000) as well as plain species ids. */
function pokeName(pokeId) {
  const d = state.details.get(pokeId);
  if (d?.name) return d.name;
  return state.list[pokeId - 1]?.name || ('#' + pokeId);
}
function speciesIdOf(pokeId) {
  const d = state.details.get(pokeId);
  const sid = d?.species?.url ? idOf(d.species.url) : 0;
  return sid || pokeId;
}
/* Caught ids are kept as stored (a backup can name species this API version
   does not list yet), but only ids in the species list count towards
   progress, so completion can never pass 100%. */
function caughtTotal() {
  if (!state.list.length) return state.caught.size;
  let n = 0;
  for (const id of state.caught) if (id <= state.list.length) n++;
  return n;
}
function syncCounts() {
  const caught = caughtTotal();
  $('favCount').textContent = state.favorites.size;
  $('compareCount').textContent = state.compare.length;
  $('teamCount').textContent = state.team.length;
  $('caughtCount').textContent = caught;
  $('streakCount').textContent = state.gameStats.streak || 0;
  const total = state.list.length || 1;
  $('heroCaught').textContent = caught.toLocaleString();
  $('heroPct').textContent = Math.round(caught / total * 100) + '%';
  renderDock();
}

/* ------------------------------------------------------------------ */
/* LIST / GRID                                                         */
/* ------------------------------------------------------------------ */

function filtered() {
  let a = state.list.filter(p =>
    (state.mode !== 'favorites' || state.favorites.has(p.id)) &&
    (!state.gen || genOf(p.id) === Number(state.gen)) &&
    (!state.search ||
      p.name.includes(state.search.toLowerCase()) ||
      String(p.id).includes(state.search.replace(/^#/, '').replace(/^0+/, '')))
  );

  if (state.chip === 'caught')   a = a.filter(p => state.caught.has(p.id));
  if (state.chip === 'uncaught') a = a.filter(p => !state.caught.has(p.id));
  if (state.chip === 'legendary') a = a.filter(p => LEGENDARY.has(p.id));

  if (state.type) {
    const allowed = state.types.get(state.type);
    if (allowed) a = a.filter(p => allowed.has(p.id)); else return [];
  }

  switch (state.sort) {
    case 'id-desc':   a = [...a].sort((x, y) => y.id - x.id); break;
    case 'name-asc':  a = [...a].sort((x, y) => x.name.localeCompare(y.name)); break;
    case 'name-desc': a = [...a].sort((x, y) => y.name.localeCompare(x.name)); break;
    case 'bst-desc': case 'bst-asc': {
      /* Only cached Pokémon have stats; uncached ones sort to the end. */
      const bst = p => {
        const d = state.details.get(p.id);
        return d ? d.stats.reduce((t, x) => t + x.base_stat, 0) : -1;
      };
      a = [...a].sort((x, y) => {
        const bx = bst(x), by = bst(y);
        if (bx < 0 && by < 0) return x.id - y.id;
        if (bx < 0) return 1;
        if (by < 0) return -1;
        return state.sort === 'bst-desc' ? by - bx : bx - by;
      });
      break;
    }
  }
  return a;
}

function card(p) {
  const types = typesOf(p.id);
  const isCaught = state.caught.has(p.id);
  const onTeam = hasMember(p.id);
  return `<article class="poke-card ${isCaught ? 'caught' : ''}" data-open="${p.id}" tabindex="0" role="button"
      aria-label="View ${safe(p.name)} details" style="--type-color:${typeColor(types[0], '#a8ef61')}">
    <div class="cardtop">
      <button class="catchbtn ${isCaught ? 'on' : ''}" data-catch="${p.id}"
        title="${isCaught ? 'Caught' : 'Mark as caught'}" aria-pressed="${isCaught}">${isCaught ? '◉' : '○'}</button>
      <span class="number">${pad(p.id)}</span>
      <button class="heart ${state.favorites.has(p.id) ? 'liked' : ''}" data-fav="${p.id}"
        aria-label="${state.favorites.has(p.id) ? 'Remove from' : 'Add to'} favorites"
        aria-pressed="${state.favorites.has(p.id)}">${state.favorites.has(p.id) ? '♥' : '♡'}</button>
    </div>
    <div class="art-area">${art(p.id)}</div>
    <div class="cardbottom">
      <h3>${safe(title(p.name))}</h3>
      <div class="types">${types.length
        ? types.map(typeBadge).join('')
        : `<span class="type" style="--type-color:#36445e">Gen ${genOf(p.id)}</span>`}</div>
    </div>
    <div class="cardactions">
      <button class="compbtn ${onTeam ? 'on' : ''}" data-team="${p.id}" title="Add to team" aria-label="Add ${safe(p.name)} to team">⬢</button>
      <button class="compbtn" data-compare="${p.id}" title="Add to compare" aria-label="Compare ${safe(p.name)}">⇄</button>
    </div>
  </article>`;
}

function showList(show) {
  $('listSection').hidden = !show;
  $('panel').hidden = show;
  $('hero').hidden = !show || state.mode === 'favorites';
}

function render() {
  const a = filtered();
  showList(true);
  $('heading').firstChild.textContent =
    state.mode === 'favorites' ? 'Your Favorites ' : 'National Pokédex ';
  $('crumb').textContent = state.mode === 'favorites' ? 'FAVORITES' : 'NATIONAL POKÉDEX';
  $('resultCount').textContent = a.length.toLocaleString();
  $('status').textContent =
    `Showing ${Math.min(a.length, state.shown).toLocaleString()} of ${a.length.toLocaleString()} Pokémon`;

  const items = a.slice(0, state.shown);
  $('grid').innerHTML = items.length
    ? items.map(card).join('')
    : `<div class="empty"><strong>No Pokémon found</strong>Try another search or reset your filters.<br>
       <button class="errorbutton" data-reset="1">Reset filters</button></div>`;
  $('loadMore').hidden = a.length <= state.shown;

  document.querySelectorAll('.navitem').forEach(n => n.classList.toggle('active', n.dataset.nav === state.mode));
  document.querySelectorAll('.genitem').forEach(n => n.classList.toggle('active', n.dataset.gen === String(state.gen)));
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.chip === state.chip));

  syncCounts();
  hydrate(items.map(i => i.id));
}

/* Fill in type badges for cards as their data arrives. */
async function hydrate(ids) {
  const token = ++state.request;
  const pending = ids.filter(id => !state.details.has(id));
  if (!pending.length) return;
  await pool(pending, 6, async id => {
    const d = await get(`${API}/pokemon/${id}`);
    state.details.set(id, d);
    if (token !== state.request) return;
    const card = document.querySelector(`.poke-card[data-open="${id}"]`);
    if (card) {
      card.style.setProperty('--type-color', typeColor(d.types[0]?.type.name, '#a8ef61'));
      const el = card.querySelector('.types');
      if (el) el.innerHTML = d.types.map(t => typeBadge(t.type.name)).join('');
    }
  });
}

/* ------------------------------------------------------------------ */
/* COLLECTIONS: favorites, caught, team, compare                       */
/* ------------------------------------------------------------------ */

function reset() {
  state.search = ''; state.gen = ''; state.type = ''; state.sort = 'id-asc'; state.chip = '';
  state.shown = 36;
  $('searchInput').value = ''; $('typeFilter').value = '';
  $('genFilter').value = ''; $('sortFilter').value = 'id-asc';
  render();
}

function favorite(id) {
  state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
  store('atlasdex:favorites', [...state.favorites]);
  if (state.modalId === id) showTab();
  else if (state.mode === 'all' || state.mode === 'favorites') render();
  else syncCounts();
  toast(state.favorites.has(id) ? 'Added to your favorites ♡' : 'Removed from favorites');
}

function markCaught(id) {
  state.caught.has(id) ? state.caught.delete(id) : state.caught.add(id);
  store('atlasdex:caught', [...state.caught]);
  const caught = state.caught.has(id);
  if (state.mode === 'progress') { renderProgress(); }
  else if (state.modalId === id) { showTab(); }
  else {
    const el = document.querySelector(`.poke-card[data-open="${id}"]`);
    if (el) {
      el.classList.toggle('caught', caught);
      const b = el.querySelector('.catchbtn');
      b.classList.toggle('on', caught);
      b.textContent = caught ? '◉' : '○';
      b.setAttribute('aria-pressed', caught);
    }
  }
  syncCounts();
  toast(caught ? 'Registered in your living dex ◉' : 'Removed from your living dex');
}

async function addToTeam(id) {
  let added = false;
  if (hasMember(id)) {
    state.team = state.team.filter(m => m.id !== id);
    /* Forget a failed load with the member, so adding it again tries afresh. */
    state.teamFailed.delete(id);
    toast('Removed from your team');
  } else if (state.team.length >= 6) {
    toast('Your team is full — remove one first');
    return;
  } else {
    state.teamFailed.delete(id);
    state.team.push(newMember(id));
    saveTeams();
    added = true;
    toast('Added to your team ⬢');
  }
  saveTeams();
  /* Only a newly added member needs data. Removing one (a failed placeholder
     included) must not trigger another request. */
  if (added && !state.details.has(id)) {
    /* Marked as loading so a Team Builder render meanwhile waits for this
       request instead of starting a second one. */
    state.teamLoading.add(id);
    try { state.details.set(id, await get(`${API}/pokemon/${id}`)); }
    catch { state.teamFailed.add(id); }
    finally { state.teamLoading.delete(id); }
  }
  syncCounts();
  if (state.mode === 'team') renderTeam();
  else document.querySelectorAll(`[data-team="${id}"]`).forEach(b => b.classList.toggle('on', hasMember(id)));
}

function compare(id) {
  if (state.compare.includes(id)) {
    state.compare = state.compare.filter(x => x !== id);
    toast('Removed from comparison');
  } else if (state.compare.length >= 2) {
    state.compare = [state.compare[1], id];
    toast('Comparison slot replaced');
  } else {
    state.compare.push(id);
    toast('Added to comparison');
  }
  store('atlasdex:compare', state.compare);
  syncCounts();
}

function renderDock() {
  const dock = $('teamDock');
  if (!state.team.length || state.mode === 'team') { dock.hidden = true; return; }
  dock.hidden = false;
  $('dockSlots').innerHTML = memberIds().map(id =>
    `<button class="dock-slot" data-open="${toId(speciesIdOf(id))}" title="${safe(title(pokeName(id)))}">${art(id)}</button>`
  ).join('') + Array.from({ length: 6 - state.team.length }, () => '<span class="dock-slot empty-slot"></span>').join('');
}

/* ------------------------------------------------------------------ */
/* DETAIL MODAL                                                        */
/* ------------------------------------------------------------------ */

async function details(id) {
  if (!state.details.has(id)) state.details.set(id, await get(`${API}/pokemon/${id}`));
  if (!state.species.has(id)) state.species.set(id, await get(`${API}/pokemon-species/${id}`));
  return [state.details.get(id), state.species.get(id)];
}

async function openPokemon(id) {
  if (!Number.isInteger(id) || id < 1 || id > state.list.length) return;
  state.modalId = id; state.formId = id;
  state.tab = 'overview'; state.moveShown = 30; state.moveMethod = 'level-up';
  $('overlay').hidden = false;
  document.body.style.overflow = 'hidden';
  $('modalContent').innerHTML = '<div class="empty">Loading Pokémon data…</div>';
  history.replaceState(null, '', `#/pokemon/${id}`);
  try {
    const [, s] = await details(id);
    if (state.modalId !== id) return;
    /* Prefer the species' declared default variety over the raw id. */
    const vars = varietiesOf(s);
    const def = vars.find(v => v.isDefault) || vars[0];
    if (def && !state.details.has(def.id)) {
      try { state.details.set(def.id, await get(`${API}/pokemon/${def.id}`)); } catch {}
    }
    if (state.modalId !== id) return;
    if (def && state.details.has(def.id)) state.formId = def.id;
    showTab();
  } catch {
    $('modalContent').innerHTML = `<div class="empty"><strong>Could not load this Pokémon</strong>
      Check your connection and try again.<br>
      <button class="errorbutton" data-retry="${id}">Retry</button></div>`;
  }
}

async function switchForm(formId) {
  if (state.formId === formId) return;
  state.formId = formId;
  state.moveShown = 30;
  if (!state.details.has(formId)) {
    const slot = document.querySelector('.formbar');
    if (slot) slot.insertAdjacentHTML('beforeend', '<span class="form-loading">loading…</span>');
    try { state.details.set(formId, await get(`${API}/pokemon/${formId}`)); }
    catch { toast('That form could not be loaded'); return; }
  }
  if (state.formId !== formId) return;
  /* Learn-method sets differ between forms. */
  state.moveMethod = 'level-up';
  showTab();
}

function closeModal() {
  state.modalId = null; state.formId = null; state.entity = null; state.editing = null;
  $('overlay').hidden = true;
  document.body.style.overflow = '';
  if (/^#\/(pokemon|move|ability|item)\//.test(location.hash)) {
    history.replaceState(null, '', state.mode === 'favorites' ? '#/favorites' : '#/');
  }
}

function statRows(d) {
  return d.stats.map(s => {
    const label = STAT_LABEL[s.stat.name] || title(s.stat.name);
    return `<div class="statrow"><span>${safe(label)}</span><b>${safe(s.base_stat)}</b>
      <div class="bar"><div style="width:${Math.min(100, s.base_stat / 255 * 100)}%"></div></div></div>`;
  }).join('');
}

/* ---- tab: type matchups (defensive) ---- */
function matchupPanel(types) {
  const prof = defensiveProfile(types);
  const group = m => TYPES.filter(t => prof[t] === m);
  const block = (heading, mult, note) => {
    const list = group(mult);
    if (!list.length) return '';
    return `<div class="mu-block"><h4>${heading} <small>${note}</small></h4>
      <div class="types">${list.map(typeBadge).join('')}</div></div>`;
  };
  return `<h3 class="paneltitle">Defensive matchups</h3>
    <p class="dex-desc">How much damage this Pokémon takes from each attacking type, based on its typing alone.
    Abilities such as Levitate or Water Absorb can change this in battle.</p>
    ${block('Critical weakness', 4, 'takes 4× damage')}
    ${block('Weak to', 2, 'takes 2× damage')}
    ${block('Resists', .5, 'takes ½ damage')}
    ${block('Strongly resists', .25, 'takes ¼ damage')}
    ${block('Immune to', 0, 'takes no damage')}
    <h3 class="paneltitle" style="margin-top:26px">Full chart</h3>
    <div class="mu-grid">${TYPES.map(t =>
      `<div class="mu-cell ${multClass(prof[t])}" style="--type-color:${COLORS[t]}">
        <span>${safe(title(t))}</span><b>${multLabel(prof[t])}</b></div>`).join('')}</div>`;
}

/* ---- tab: breeding & training ---- */
function breedingPanel(d, s) {
  const female = s.gender_rate < 0 ? null : s.gender_rate / 8 * 100;
  const evs = d.stats.filter(x => x.effort > 0)
    .map(x => `${x.effort} ${STAT_LABEL[x.stat.name] || title(x.stat.name)}`).join(', ') || 'None';
  const steps = s.hatch_counter != null ? ((s.hatch_counter + 1) * 255).toLocaleString() + ' steps' : '—';
  const catchPct = s.capture_rate != null ? (s.capture_rate / 255 * 100).toFixed(1) + '% at full HP' : '—';

  /* Every value here is API data (egg groups, habitat, shape, growth rate), so
     the helper escapes it once for all of them. */
  const fact = (label, value) => `<div class="fact"><small>${label}</small><strong>${safe(value)}</strong></div>`;

  return `<h3 class="paneltitle">Breeding</h3>
    <div class="facts">
      ${fact('EGG GROUPS', s.egg_groups?.map(g => title(g.name)).join(', ') || '—')}
      ${fact('GENDER RATIO', female === null ? 'Genderless' : `${(100 - female).toFixed(1)}% ♂ / ${female.toFixed(1)}% ♀`)}
      ${fact('HATCH TIME', steps)}
      ${fact('BABY FORM', s.is_baby ? 'Yes' : 'No')}
      ${fact('HABITAT', title(s.habitat?.name || 'Unknown'))}
      ${fact('SHAPE', title(s.shape?.name || 'Unknown'))}
    </div>
    <h3 class="paneltitle">Training</h3>
    <div class="facts">
      ${fact('EV YIELD', evs)}
      ${fact('CATCH RATE', `${s.capture_rate ?? '—'}`)}
      ${fact('CATCH CHANCE', catchPct)}
      ${fact('BASE HAPPINESS', s.base_happiness ?? '—')}
      ${fact('GROWTH RATE', title(s.growth_rate?.name || '—'))}
      ${fact('BASE EXP', d.base_experience ?? '—')}
    </div>
    <p class="dex-desc">EV yield is what you gain per knockout. Catch chance is a rough guide for a standard Poké Ball
    against a full-health, status-free target.</p>`;
}

/* ---- tab: moves ---- */
function movesPanel(d) {
  const rows = d.moves.map(m => {
    const vg = m.version_group_details[m.version_group_details.length - 1];
    return {
      name: m.move.name,
      method: vg?.move_learn_method?.name || 'unknown',
      level: vg?.level_learned_at || 0
    };
  });
  const methods = [...new Set(rows.map(r => r.method))].sort();
  const active = methods.includes(state.moveMethod) ? state.moveMethod : methods[0];
  state.moveMethod = active;

  const shown = rows.filter(r => r.method === active)
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
    .slice(0, state.moveShown);
  const totalForMethod = rows.filter(r => r.method === active).length;

  return `<h3 class="paneltitle">Moves</h3>
    <div class="chipbar">${methods.map(m =>
      `<button class="chip ${m === active ? 'on' : ''}" data-method="${safe(m)}">${safe(title(m))}</button>`).join('')}</div>
    <div class="movetable" id="moveTable">
      <div class="moverow movehead"><span>Move</span><span>Type</span><span>Pow</span><span>Acc</span><span>PP</span><span>Lv</span></div>
      ${shown.map(r => `<div class="moverow" data-move="${safe(r.name)}">
        <span class="mv-name">${safe(title(r.name))}</span>
        <span class="mv-type">…</span><span class="mv-pow">…</span>
        <span class="mv-acc">…</span><span class="mv-pp">…</span>
        <span class="mv-lv">${safe(r.level || '—')}</span></div>`).join('')}
    </div>
    ${totalForMethod > state.moveShown
      ? `<div class="loadMoreWrap"><button class="loadmore" data-moremoves="1">Show more moves ↓</button></div>`
      : ''}
    <p class="dex-desc">Showing ${Math.min(state.moveShown, totalForMethod)} of ${totalForMethod} ${safe(title(active))} moves.
    Availability differs between games.</p>`;
}

async function fillMoves() {
  const rows = [...document.querySelectorAll('.moverow[data-move]')];
  const names = rows.map(r => r.dataset.move);
  await pool(names, 8, async name => {
    if (!state.moves.has(name)) state.moves.set(name, await get(`${API}/move/${name}`));
    const m = state.moves.get(name);
    const row = document.querySelector(`.moverow[data-move="${CSS.escape(name)}"]`);
    if (!row || !m) return;
    row.querySelector('.mv-type').innerHTML = typeBadge(m.type.name);
    row.querySelector('.mv-pow').textContent = m.power ?? '—';
    row.querySelector('.mv-acc').textContent = m.accuracy ? m.accuracy + '%' : '—';
    row.querySelector('.mv-pp').textContent = m.pp ?? '—';
    row.dataset.class = m.damage_class?.name || '';
  });
}

async function fillAbilities(d) {
  await pool(d.abilities.map(a => a.ability.name), 4, async name => {
    if (!state.abilities.has(name)) state.abilities.set(name, await get(`${API}/ability/${name}`));
    const a = state.abilities.get(name);
    const el = document.querySelector(`[data-ability="${CSS.escape(name)}"] .ab-text`);
    if (!el || !a) return;
    const text = a.effect_entries?.find(e => e.language.name === 'en')?.short_effect
      || a.flavor_text_entries?.find(e => e.language.name === 'en')?.flavor_text
      || 'No description available.';
    el.textContent = text.replace(/[\f\n\r]/g, ' ');
  });
}

function showTab() {
  const id = state.modalId;
  if (!id) return;
  const s = state.species.get(id);
  const fid = state.formId && state.details.has(state.formId) ? state.formId : id;
  const d = state.details.get(fid);
  if (!d || !s) return;
  state.formId = fid;

  const types = d.types.map(t => t.type.name);
  const desc = s.flavor_text_entries?.find(x => x.language.name === 'en')?.flavor_text
    .replace(/[\f\n\r]/g, ' ') || 'No description available.';
  const genus = s.genera?.find(x => x.language.name === 'en')?.genus || 'Pokémon';
  const total = d.stats.reduce((a, x) => a + x.base_stat, 0);

  let body;
  if (state.tab === 'overview') {
    body = `<h3 class="paneltitle">About ${safe(title(s.name))}</h3>
      <p class="dex-desc">${safe(desc)}</p>
      <div class="facts">
        <div class="fact"><small>HEIGHT</small><strong>${(d.height / 10).toFixed(1)} m</strong></div>
        <div class="fact"><small>WEIGHT</small><strong>${(d.weight / 10).toFixed(1)} kg</strong></div>
        <div class="fact"><small>GENERATION</small><strong>Gen ${genOf(id)}</strong></div>
        <div class="fact"><small>STAT TOTAL</small><strong>${total}</strong></div>
        <div class="fact"><small>CLASSIFICATION</small><strong>${s.is_mythical ? 'Mythical' : s.is_legendary ? 'Legendary' : 'Regular'}</strong></div>
        <div class="fact"><small>LIVING DEX</small><strong>${state.caught.has(id) ? 'Caught ◉' : 'Not caught'}</strong></div>
      </div>
      <h3 class="paneltitle">Abilities</h3>
      ${d.abilities.map(a => `<div class="abilitycard" data-ability="${safe(a.ability.name)}">
        <strong>${safe(title(a.ability.name))}${a.is_hidden ? ' <em>· Hidden</em>' : ''}</strong>
        <p class="ab-text">Loading description…</p></div>`).join('')}
      <div class="detail-actions">
        <button class="primaryaction" data-catch="${id}">${state.caught.has(id) ? '◉ Caught' : '○ Mark as caught'}</button>
        <button class="secondaryaction" data-fav="${id}">${state.favorites.has(id) ? '♥ Remove favorite' : '♡ Add to favorites'}</button>
        <button class="secondaryaction" data-team="${fid}">⬢ ${hasMember(fid) ? 'Remove from team' : 'Add this form to team'}</button>
        <button class="secondaryaction" data-compare="${fid}">⇄ Compare</button>
        <button class="secondaryaction" data-cry="${fid}">♪ Hear cry</button>
      </div>`;
  } else if (state.tab === 'stats') {
    const c = state.calc;
    const realRows = d.stats.map(st => {
      const n2 = st.stat.name;
      const v = realStat(st.base_stat, c.iv, c.ev, c.level, n2, c.nature);
      const mod = natureMod(c.nature, n2);
      return `<div class="statrow"><span>${safe(STAT_LABEL[n2] || title(n2))}
          ${mod > 1 ? '<i class="up">▲</i>' : mod < 1 ? '<i class="down">▼</i>' : ''}</span>
        <b>${v}</b><div class="bar"><div style="width:${Math.min(100, v / 714 * 100)}%"></div></div></div>`;
    }).join('');
    body = `<h3 class="paneltitle">Base statistics · Total ${total}</h3>${statRows(d)}
      <h3 class="paneltitle" style="margin-top:26px">Actual stats</h3>
      <div class="fieldgrid">
        ${num('level', 'LEVEL', c.level, 1, 100)}
        ${sel('nature', 'NATURE', c.nature, Object.keys(NATURES))}
        ${num('iv', 'IV', c.iv, 0, 31)}
        ${num('ev', 'EV', c.ev, 0, 252, 4)}
      </div>
      ${realRows}
      <p class="dex-desc">Calculated with the Gen 3+ formula. The arrows mark the stats this nature raises and lowers.</p>`;
  } else if (state.tab === 'matchups') {
    body = matchupPanel(types);
  } else if (state.tab === 'evolution') {
    body = `<h3 class="paneltitle">Evolution family</h3><div id="evolutionContents" class="evoflow">Loading evolution chain…</div>`;
  } else if (state.tab === 'breeding') {
    body = breedingPanel(d, s);
  } else if (state.tab === 'encounters') {
    body = `<h3 class="paneltitle">Where to find it</h3>
      <div id="encContents" class="dex-desc">Loading encounter locations…</div>`;
  } else {
    body = movesPanel(d);
  }

  const vars = varietiesOf(s);
  const formBar = vars.length > 1
    ? `<div class="formbar" role="group" aria-label="Alternate forms">
        ${vars.map(v => `<button class="formchip ${v.id === fid ? 'on' : ''}" data-form="${v.id}">
          ${safe(formLabel(v.name, s.name))}</button>`).join('')}
       </div>`
    : '';

  const activeName = fid === id || !vars.length
    ? title(s.name)
    : `${title(s.name)} · ${formLabel(pokeName(fid), s.name)}`;

  const tabs = ['overview','stats','matchups','evolution','breeding','moves','encounters'];
  $('modalContent').innerHTML = `
    <div class="detail-hero" style="--detail-glow:${typeColor(types[0], '#355e47')}44">
      <div>
        <div class="detail-number">${pad(id)} · GENERATION ${genOf(id)}</div>
        <h2>${safe(activeName)}</h2>
        <div class="types">${d.types.map(t => typeBadge(t.type.name)).join('')}</div>
        <div class="detail-genus">${safe(genus)}</div>
        ${formBar}
      </div>
      <img src="${safe(state.shiny
        ? (d.sprites.other?.['official-artwork']?.front_shiny || sprite(fid, true))
        : (d.sprites.other?.['official-artwork']?.front_default || sprite(fid)))}" alt="${safe(d.name)}">
    </div>
    <div class="detail-body">
      <div class="detail-tabs">${tabs.map(t =>
        `<button data-tab="${t}" class="${state.tab === t ? 'selected' : ''}">${title(t)}</button>`).join('')}</div>
      ${body}
    </div>`;

  if (state.tab === 'evolution') loadEvolution(s);
  if (state.tab === 'moves') fillMoves();
  if (state.tab === 'encounters') loadEncounters(fid);
  if (state.tab === 'overview') fillAbilities(d);
}

async function loadEncounters(pokeId) {
  const target = $('encContents');
  if (!target) return;
  let data;
  try { data = await get(`${API}/pokemon/${pokeId}/encounters`); }
  catch { target.textContent = 'Encounter data unavailable right now.'; return; }
  if (state.tab !== 'encounters' || state.formId !== pokeId) return;

  if (!data.length) {
    target.innerHTML = `<div class="empty"><strong>Not found in the wild</strong>
      This Pokémon is obtained by evolution, trade, a gift, or an event rather than a wild encounter.</div>`;
    return;
  }

  /* Group location areas under each game version. */
  const byVersion = new Map();
  for (const entry of data) {
    for (const v of entry.version_details) {
      const ver = v.version.name;
      if (!byVersion.has(ver)) byVersion.set(ver, new Map());
      const areas = byVersion.get(ver);
      const area = title(entry.location_area.name.replace(/-area$/, ''));
      const best = Math.max(...v.encounter_details.map(e => e.chance || 0), 0);
      const levels = v.encounter_details.map(e => [e.min_level, e.max_level]);
      const lo = Math.min(...levels.map(l => l[0]));
      const hi = Math.max(...levels.map(l => l[1]));
      const prev = areas.get(area);
      if (!prev || best > prev.chance) areas.set(area, { chance: best, lo, hi });
    }
  }

  target.innerHTML = [...byVersion.entries()].map(([ver, areas]) => `
    <div class="encblock">
      <h4>${safe(title(ver))}</h4>
      <div class="enclist">
        ${[...areas.entries()].sort((a, b) => b[1].chance - a[1].chance).map(([area, info]) =>
          `<div class="encrow"><span>${safe(area)}</span>
            <small>Lv ${safe(info.lo)}${info.hi !== info.lo ? '–' + safe(info.hi) : ''}</small>
            <b>${info.chance ? safe(info.chance) + '%' : '—'}</b></div>`).join('')}
      </div>
    </div>`).join('');
}

async function loadEvolution(species) {
  const target = $('evolutionContents');
  try {
    const url = species.evolution_chain?.url;
    if (!url) { target.textContent = 'Evolution information unavailable.'; return; }
    let chain = state.chains.get(url);
    if (!chain) { chain = await get(url); state.chains.set(url, chain); }
    if (state.tab !== 'evolution' || state.modalId !== species.id) return;
    const nodes = [];
    (function walk(n, depth) {
      nodes.push({ id: idOf(n.species.url), name: n.species.name, depth, detail: n.evolution_details?.[0] });
      for (const child of n.evolves_to) walk(child, depth + 1);
    })(chain.chain, 0);
    target.innerHTML = nodes.map((n, i) => `${i ? '<span class="evoarrow">→</span>' : ''}
      <button class="evonode" data-open="${n.id}">${art(n.id)}<strong>${safe(title(n.name))}</strong>
      ${n.detail ? `<small>${safe(n.detail.min_level ? 'Lv. ' + n.detail.min_level
        : n.detail.item?.name ? title(n.detail.item.name)
        : title(n.detail.trigger?.name || ''))}</small>` : ''}</button>`).join('');
  } catch {
    if (target) target.textContent = 'Evolution data unavailable right now.';
  }
}

/* ------------------------------------------------------------------ */
/* VIEW: TEAM BUILDER + COVERAGE HEATMAP                               */
/* ------------------------------------------------------------------ */

function analyzeTeam(members) {
  const defense = {}, offense = {};
  for (const t of TYPES) {
    defense[t] = { weak: 0, resist: 0, immune: 0 };
    offense[t] = 0;
  }
  for (const m of members) {
    const prof = defensiveProfile(m.types);
    for (const t of TYPES) {
      if (prof[t] > 1) defense[t].weak++;
      else if (prof[t] === 0) defense[t].immune++;
      else if (prof[t] < 1) defense[t].resist++;
    }
    /* Prefer the member's actual damaging moves; fall back to its typing. */
    const atkTypes = attackingTypesOf(m.loadout, m.types);
    for (const t of TYPES) {
      if (atkTypes.some(own => effectiveness(own, [t]) > 1)) offense[t]++;
    }
  }
  const exact = members.length > 0 && members.every(m => damagingMoves(m.loadout).length > 0);
  return { defense, offense, exact };
}

/* Assigned moves that actually deal damage and whose data we have cached. */
function damagingMoves(loadout) {
  if (!loadout?.moves?.length) return [];
  return loadout.moves
    .map(n => state.moves.get(n))
    .filter(mv => mv && mv.power > 0 && mv.damage_class?.name !== 'status');
}

function attackingTypesOf(loadout, fallbackTypes) {
  const dmg = damagingMoves(loadout);
  if (dmg.length) return [...new Set(dmg.map(mv => mv.type.name))];
  return fallbackTypes;
}

function renderTeam() {
  showList(false);
  $('crumb').textContent = 'TEAM BUILDER';
  document.querySelectorAll('.navitem').forEach(n => n.classList.toggle('active', n.dataset.nav === 'team'));
  syncCounts();

  /* A team restored from localStorage has no cached /pokemon payloads yet.
     Each id is requested once: a failure is remembered for the session instead
     of re-rendering into another request, which would loop for as long as the
     data stays unreachable (offline, or an id PokéAPI does not have). Only the
     Retry button clears that memory. */
  const unloaded = memberIds().filter(id => !state.details.has(id));
  const toFetch = unloaded.filter(id => !state.teamFailed.has(id) && !state.teamLoading.has(id));
  if (unloaded.some(id => !state.teamFailed.has(id))) {
    $('panel').innerHTML = `<div class="kicker">STRATEGY</div><h2 class="panel-title">Team Builder</h2>
      <div class="empty">Analyzing your team…</div>`;
    if (toFetch.length) {
      toFetch.forEach(id => state.teamLoading.add(id));
      pool(toFetch, 6, async id => {
        try { state.details.set(id, await get(`${API}/pokemon/${id}`)); }
        catch { state.teamFailed.add(id); }
        finally { state.teamLoading.delete(id); }
      }).then(() => { if (state.mode === 'team') renderTeam(); });
    }
    return;
  }

  /* From here every member is either loaded or known to have failed. */
  const failed = state.team.filter(m => !state.details.has(m.id));
  const members = state.team.filter(m => state.details.has(m.id)).map(m => ({
    id: m.id,
    loadout: m,
    name: pokeName(m.id),
    types: typesOf(m.id),
    stats: state.details.get(m.id)?.stats || []
  })).filter(m => m.types.length);

  const slots = state.team.map(mem => { const id = toId(mem.id);
    if (!state.details.has(mem.id)) {
      /* Still removable, but nothing to open or edit without its data. */
      return `<div class="team-slot failed">
        <button class="slot-remove" data-team="${id}" aria-label="Remove ${safe(title(pokeName(id)))} from team">✕</button>
        <div class="slot-missing" aria-hidden="true">?</div>
        <strong>${safe(title(pokeName(id)))}</strong>
        <div class="slot-build"><small class="missing">Could not load</small></div>
      </div>`;
    }
    const types = typesOf(id);
    const filled = mem.moves.filter(Boolean).length;
    const evs = evTotal(mem);
    return `<div class="team-slot" style="--type-color:${typeColor(types[0], '#a8ef61')}">
      <button class="slot-remove" data-team="${id}" aria-label="Remove from team">✕</button>
      <div data-open="${toId(speciesIdOf(id))}" role="button" tabindex="0">${art(id)}
        <strong>${safe(title(pokeName(id)))}</strong>
        <div class="types">${types.map(typeBadge).join('')}</div></div>
      <div class="slot-build">
        <small>Lv ${int0(mem.level)} · ${safe(title(mem.nature))}</small>
        <small class="${filled === 4 ? 'good' : filled ? '' : 'missing'}">${filled}/4 moves${evs ? ` · ${evs} EVs` : ''}</small>
      </div>
      <button class="slot-edit" data-edit="${id}">✎ Edit build</button>
    </div>`;
  }).join('') + Array.from({ length: 6 - state.team.length }, () =>
    `<a class="team-slot empty" href="#/"><span>＋</span><small>Add a Pokémon</small></a>`).join('');

  const teamTabs = `<div class="teamtabs">
    ${state.teams.map((t, i) => `<button class="teamtab ${i === activeIdx() ? 'on' : ''}" data-teamsel="${i}">
      ${safe(t.name)} <i>${t.members.length}</i></button>`).join('')}
    ${state.teams.length < 8 ? '<button class="teamtab add" data-teamnew="1">＋ New team</button>' : ''}
  </div>`;

  const loadError = failed.length
    ? `<div class="team-error" role="alert">
        <p>${failed.length} team member${failed.length === 1 ? '' : 's'} could not be loaded. Check your connection.</p>
        <button class="errorbutton" data-teamretry="1">Retry</button>
      </div>`
    : '';

  if (!members.length) {
    $('panel').innerHTML = `<div class="kicker">STRATEGY</div><h2 class="panel-title">Team Builder</h2>
      ${teamTabs}
      ${loadError}
      <p class="dex-desc">Pick up to six Pokémon with the ⬢ button on any card. AtlasDex will map every shared weakness
      and every gap in your offensive coverage.</p>
      <div class="team-slots">${slots}</div>`;
    return;
  }

  const { defense, offense, exact } = analyzeTeam(members);
  const n = members.length;

  const threats = TYPES.filter(t => defense[t].weak >= Math.max(2, Math.ceil(n / 2)))
    .sort((a, b) => defense[b].weak - defense[a].weak);
  const blind = TYPES.filter(t => offense[t] === 0);
  const fortress = TYPES.filter(t => defense[t].weak === 0 && (defense[t].resist + defense[t].immune) >= Math.ceil(n / 2));

  const statTotals = members.map(m => ({
    name: m.name,
    total: m.stats.reduce((a, x) => a + x.base_stat, 0)
  }));
  const avg = Math.round(statTotals.reduce((a, x) => a + x.total, 0) / n);

  const heatRow = t => {
    const d = defense[t];
    const score = d.weak - (d.resist + d.immune * 1.5);
    const cls = score >= 2 ? 'h-bad' : score >= 1 ? 'h-warn' : score <= -2 ? 'h-good' : 'h-mid';
    return `<div class="heat-row">
      <span class="heat-type" style="--type-color:${COLORS[t]}">${safe(title(t))}</span>
      <span class="heat-cell ${cls}" title="${d.weak} weak, ${d.resist} resist, ${d.immune} immune">
        ${d.weak ? `<b>${d.weak}</b> weak` : 'safe'}${d.resist ? ` · ${d.resist} resist` : ''}${d.immune ? ` · ${d.immune} immune` : ''}
      </span>
      <span class="heat-cell ${offense[t] === 0 ? 'h-bad' : offense[t] >= 2 ? 'h-good' : 'h-mid'}">
        ${offense[t] === 0 ? 'no answer' : `<b>${offense[t]}</b> can hit`}
      </span>
    </div>`;
  };

  $('panel').innerHTML = `
    <div class="kicker">STRATEGY</div>
    <h2 class="panel-title">Team Builder <span class="heading-count">${state.team.length}/6</span></h2>
    ${teamTabs}
    ${loadError}
    <p class="dex-desc">Defensive column: how many of your team take extra damage from that type.
    Offensive column: how many can hit that type for super-effective damage.
    ${exact
      ? '<strong class="exactflag">Exact — calculated from the damaging moves you assigned.</strong>'
      : 'Members without assigned moves are approximated from their typing. Give everyone moves for an exact reading.'}</p>

    <div class="team-slots">${slots}</div>

    <div class="verdict-grid">
      <div class="verdict ${threats.length ? 'v-bad' : 'v-good'}">
        <small>SHARED WEAKNESSES</small>
        ${threats.length
          ? `<div class="types">${threats.map(typeBadge).join('')}</div>
             <p>${threats.length} type${threats.length > 1 ? 's' : ''} hit half your team or more. A single ${safe(title(threats[0]))} attacker could sweep you.</p>`
          : '<p>No type threatens half your team at once. This is a well-spread defensive core.</p>'}
      </div>
      <div class="verdict ${blind.length ? 'v-warn' : 'v-good'}">
        <small>OFFENSIVE BLIND SPOTS</small>
        ${blind.length
          ? `<div class="types">${blind.map(typeBadge).join('')}</div>
             <p>Nobody on your team hits these for extra damage. Cover them with a coverage move or a swap.</p>`
          : '<p>Your team has a super-effective answer to every single type.</p>'}
      </div>
      <div class="verdict v-good">
        <small>SOLID AGAINST</small>
        ${fortress.length
          ? `<div class="types">${fortress.map(typeBadge).join('')}</div><p>Resisted by much of your team with nobody vulnerable.</p>`
          : '<p>No standout defensive strengths yet.</p>'}
      </div>
      <div class="verdict v-mid">
        <small>POWER LEVEL</small>
        <strong class="big">${avg}</strong>
        <p>Average base stat total. ${avg >= 540 ? 'Heavy hitters — expect a high power bracket.' : avg >= 450 ? 'A balanced, competitive spread.' : 'A light team, strong for early-game or themed runs.'}</p>
      </div>
    </div>

    <h3 class="paneltitle">Coverage heatmap</h3>
    <div class="heatmap">
      <div class="heat-row heat-head"><span>TYPE</span><span>YOUR DEFENSE</span><span>YOUR OFFENSE</span></div>
      ${TYPES.map(heatRow).join('')}
    </div>

    <div class="detail-actions">
      <a class="secondaryaction" href="#/">＋ Add more Pokémon</a>
      <button class="secondaryaction" data-showdown="1">⧉ Copy as Showdown</button>
      <button class="secondaryaction" data-teamrename="1">✎ Rename</button>
      <button class="secondaryaction" data-clear-team="1">Clear team</button>
      ${state.teams.length > 1 ? '<button class="secondaryaction" data-teamdel="1">🗑 Delete team</button>' : ''}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* VIEW: LIVING DEX PROGRESS                                           */
/* ------------------------------------------------------------------ */

function renderProgress() {
  showList(false);
  $('crumb').textContent = 'LIVING DEX';
  document.querySelectorAll('.navitem').forEach(n => n.classList.toggle('active', n.dataset.nav === 'progress'));
  syncCounts();

  const total = state.list.length;
  const done = caughtTotal();
  const pct = total ? (done / total * 100) : 0;

  const gens = Array.from({ length: 9 }, (_, i) => {
    const g = i + 1;
    const all = state.list.filter(p => genOf(p.id) === g);
    const got = all.filter(p => state.caught.has(p.id)).length;
    return { g, total: all.length, got, pct: all.length ? got / all.length * 100 : 0 };
  });

  const nextUp = state.list.filter(p => !state.caught.has(p.id)).slice(0, 12);

  $('panel').innerHTML = `
    <div class="kicker">YOUR COLLECTION</div>
    <h2 class="panel-title">Living Dex <span class="heading-count">${done.toLocaleString()} / ${total.toLocaleString()}</span></h2>
    <p class="dex-desc">Mark any Pokémon as caught with the ◉ button on its card. Your progress is saved in this browser.</p>

    <div class="ring-wrap">
      <div class="ring" style="--pct:${pct.toFixed(2)}">
        <div class="ring-inner"><strong>${pct.toFixed(1)}%</strong><small>COMPLETE</small></div>
      </div>
      <div class="ring-facts">
        <div class="fact"><small>REGISTERED</small><strong>${done.toLocaleString()}</strong></div>
        <div class="fact"><small>REMAINING</small><strong>${(total - done).toLocaleString()}</strong></div>
        <div class="fact"><small>FAVORITES</small><strong>${state.favorites.size}</strong></div>
        <div class="fact"><small>FULL GENS</small><strong>${gens.filter(g => g.total && g.got === g.total).length} / 9</strong></div>
      </div>
    </div>

    <h3 class="paneltitle">By generation</h3>
    <div class="genprogress">
      ${gens.map(g => `<button class="genbar ${g.total && g.got === g.total ? 'done' : ''}" data-gen="${g.g}">
        <div class="gb-top"><strong>Generation ${ROMAN[g.g - 1]}</strong><span>${g.got} / ${g.total}</span></div>
        <div class="bar"><div style="width:${g.pct}%"></div></div>
      </button>`).join('')}
    </div>

    <h3 class="paneltitle">Next to catch</h3>
    <div class="nextup">
      ${nextUp.length
        ? nextUp.map(p => `<button class="nextcard" data-open="${p.id}">${art(p.id)}
            <strong>${safe(title(p.name))}</strong><small>${pad(p.id)}</small></button>`).join('')
        : '<p class="dex-desc">You have registered every species. The dex is complete.</p>'}
    </div>

    <div class="detail-actions">
      <a class="secondaryaction" href="#/" data-chipgo="uncaught">Browse everything I'm missing</a>
      <button class="secondaryaction" data-clear-caught="1">Reset progress</button>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* TEAM MEMBER EDITOR                                                  */
/* ------------------------------------------------------------------ */

/* Move names this Pokémon can legally learn, sorted. */
function learnableMoves(id) {
  const d = state.details.get(id);
  if (!d) return [];
  return [...new Set(d.moves.map(m => m.move.name))].sort();
}

async function openMemberEditor(id) {
  const m = findMember(id);
  if (!m) return;
  state.editing = id;
  state.modalId = null; state.entity = null;
  $('overlay').hidden = false;
  document.body.style.overflow = 'hidden';
  $('modalContent').innerHTML = '<div class="empty">Loading loadout…</div>';

  if (!state.details.has(id)) {
    try { state.details.set(id, await get(`${API}/pokemon/${id}`)); } catch {}
  }
  /* Assigned moves need their data for coverage and damage maths. */
  const need = m.moves.filter(n => !state.moves.has(n));
  if (need.length) await pool(need, 4, async n => { state.moves.set(n, await get(`${API}/move/${n}`)); });
  if (state.editing !== id) return;
  paintMemberEditor();
}

function paintMemberEditor() {
  const id = state.editing;
  const m = findMember(id);
  const d = state.details.get(id);
  if (!m || !d) { closeModal(); return; }

  const stats = memberStats(m) || {};
  const total = evTotal(m);
  const over = total > EV_TOTAL_MAX;
  const learnable = learnableMoves(id);

  const statRowsHtml = d.stats.map(s => {
    const k = s.stat.name;
    const mod = natureMod(m.nature, k);
    return `<div class="ldrow">
      <span class="ld-label">${safe(STAT_LABEL[k])}
        ${mod > 1 ? '<i class="up">▲</i>' : mod < 1 ? '<i class="down">▼</i>' : ''}</span>
      <span class="ld-base">${safe(s.base_stat)}</span>
      <input class="ld-in" type="number" min="0" max="31" value="${int0(m.ivs[k] ?? 31)}" data-iv="${safe(k)}" aria-label="${safe(STAT_LABEL[k])} IV">
      <input class="ld-in" type="number" min="0" max="${EV_STAT_MAX}" step="4" value="${int0(m.evs[k] ?? 0)}" data-ev="${safe(k)}" aria-label="${safe(STAT_LABEL[k])} EV">
      <span class="ld-final">${safe(stats[k] ?? '—')}</span>
    </div>`;
  }).join('');

  const moveSlots = Array.from({ length: 4 }, (_, i) => {
    const chosen = m.moves[i] || '';
    const mv = chosen ? state.moves.get(chosen) : null;
    return `<div class="moveslot">
      <select data-moveslot="${i}">
        <option value="">— empty slot —</option>
        ${learnable.map(n => `<option value="${safe(n)}" ${n === chosen ? 'selected' : ''}>${safe(title(n))}</option>`).join('')}
      </select>
      <span class="ms-meta">${mv
        ? `${typeBadge(mv.type.name)}<small>${safe(dmgIcon(mv.damage_class?.name))} ${safe(mv.power || '—')} pow · ${mv.accuracy ? safe(mv.accuracy) + '%' : '—'}</small>`
        : '<small>No move selected</small>'}</span>
    </div>`;
  }).join('');

  const coverage = attackingTypesOf(m, typesOf(id));
  const hits = TYPES.filter(t => coverage.some(a => effectiveness(a, [t]) > 1));

  $('modalContent').innerHTML = `
    <div class="entity-hero loadout-hero">
      <div class="lh-art">${art(id)}</div>
      <div>
        <div class="detail-number">LOADOUT</div>
        <h2>${safe(title(pokeName(id)))}</h2>
        <div class="types">${typesOf(id).map(typeBadge).join('')}</div>
      </div>
    </div>
    <div class="detail-body">
      <div class="fieldgrid">
        <label class="field"><small>LEVEL</small>
          <input type="number" min="1" max="100" value="${int0(m.level)}" data-ld="level"></label>
        <label class="field"><small>NATURE</small>
          <select data-ld="nature">${Object.keys(NATURES).map(n =>
            `<option value="${safe(n)}" ${n === m.nature ? 'selected' : ''}>${safe(title(n))}${NATURES[n][0] ? ` (+${safe(STAT_LABEL[NATURES[n][0]])} / −${safe(STAT_LABEL[NATURES[n][1]])})` : ''}</option>`).join('')}</select></label>
        <label class="field"><small>ABILITY</small>
          <select data-ld="ability">${d.abilities.map(a =>
            `<option value="${safe(a.ability.name)}" ${a.ability.name === m.ability ? 'selected' : ''}>${safe(title(a.ability.name))}${a.is_hidden ? ' (hidden)' : ''}</option>`).join('')}</select></label>
        <label class="field"><small>HELD ITEM</small>
          <input type="text" list="itemList" placeholder="e.g. leftovers" value="${safe(m.item || '')}" data-ld="item"></label>
      </div>
      <datalist id="itemList">${(state.indexes.item || []).slice(0, 600).map(i => `<option value="${safe(i.name)}">`).join('')}</datalist>

      <h3 class="paneltitle">Moves</h3>
      <div class="moveslots">${moveSlots}</div>
      <p class="dex-desc">Coverage from these moves: ${hits.length
        ? `super effective against ${hits.length} of 18 types.`
        : 'no damaging moves assigned yet, so the team analysis falls back to typing.'}</p>

      <h3 class="paneltitle">Stats, IVs and EVs</h3>
      <div class="ldrow ldhead"><span>Stat</span><span>Base</span><span>IV</span><span>EV</span><span>Total</span></div>
      ${statRowsHtml}
      <div class="evbar ${over ? 'over' : ''}">
        <div style="width:${Math.min(100, total / EV_TOTAL_MAX * 100)}%"></div>
      </div>
      <p class="dex-desc ${over ? 'warn' : ''}">EVs used: ${total} / ${EV_TOTAL_MAX}${over
        ? ' — over the legal limit for an in-game Pokémon.' : '.'} Maximum ${EV_STAT_MAX} in any single stat.</p>

      <div class="detail-actions">
        <button class="primaryaction" data-ldclose="1">Done</button>
        <button class="secondaryaction" data-ldspread="attack">Preset: physical sweeper</button>
        <button class="secondaryaction" data-ldspread="special-attack">Preset: special sweeper</button>
        <button class="secondaryaction" data-ldspread="bulk">Preset: bulky</button>
        <button class="secondaryaction" data-ldreset="1">Reset EVs</button>
      </div>
    </div>`;
}

/* Returns true when the element belonged to the loadout editor. */
function handleLoadoutEdit(t) {
  const m = findMember(state.editing);
  if (!m) return false;

  const slot = t.dataset?.moveslot;
  if (slot != null) { setMoveSlot(Number(slot), t.value); return true; }

  const iv = t.dataset?.iv;
  if (iv && STAT_KEYS.includes(iv)) {
    m.ivs[iv] = Math.max(0, Math.min(31, Math.trunc(Number(t.value)) || 0));
    saveTeams(); refreshLoadoutStats(); return true;
  }
  const ev = t.dataset?.ev;
  if (ev && STAT_KEYS.includes(ev)) {
    m.evs[ev] = Math.max(0, Math.min(EV_STAT_MAX, Math.trunc(Number(t.value)) || 0));
    saveTeams(); refreshLoadoutStats(); return true;
  }
  const ld = t.dataset?.ld;
  if (ld) {
    /* Same rules the boot-time sanitiser applies, so nothing saved here is
       blanked or rewritten on the next load. */
    if (ld === 'level')        m.level = Math.max(1, Math.min(100, Math.trunc(Number(t.value)) || 1));
    else if (ld === 'item')    m.item = cleanItem(t.value);
    else if (ld === 'nature')  { if (hasOwn(NATURES, t.value)) m.nature = t.value; }
    else if (ld === 'ability') m.ability = SLUG.test(t.value) ? t.value : null;
    else return false;
    saveTeams();
    if (ld === 'level' || ld === 'nature') refreshLoadoutStats();
    return true;
  }
  return false;
}

/* Update only the computed numbers, so focus is never stolen mid-typing. */
function refreshLoadoutStats() {
  const m = findMember(state.editing);
  const d = state.details.get(state.editing);
  if (!m || !d) return;
  const stats = memberStats(m) || {};
  document.querySelectorAll('.ldrow:not(.ldhead)').forEach((row, i) => {
    const k = d.stats[i]?.stat.name;
    if (!k) return;
    const cell = row.querySelector('.ld-final');
    if (cell) cell.textContent = stats[k] ?? '—';
    const label = row.querySelector('.ld-label');
    if (label) {
      const mod = natureMod(m.nature, k);
      label.innerHTML = `${safe(STAT_LABEL[k])} ${mod > 1 ? '<i class="up">▲</i>' : mod < 1 ? '<i class="down">▼</i>' : ''}`;
    }
  });
  const total = evTotal(m);
  const bar = document.querySelector('.evbar > div');
  if (bar) {
    bar.style.width = Math.min(100, total / EV_TOTAL_MAX * 100) + '%';
    bar.parentElement.classList.toggle('over', total > EV_TOTAL_MAX);
  }
}

function applySpread(kind) {
  const m = findMember(state.editing);
  if (!m) return;
  m.evs = blankSpread(0);
  if (kind === 'attack')              { m.evs.attack = 252; m.evs.speed = 252; m.evs.hp = 4; }
  else if (kind === 'special-attack') { m.evs['special-attack'] = 252; m.evs.speed = 252; m.evs.hp = 4; }
  else if (kind === 'bulk')           { m.evs.hp = 252; m.evs.defense = 128; m.evs['special-defense'] = 128; }
  saveTeams();
  paintMemberEditor();
}

async function setMoveSlot(index, name) {
  const m = findMember(state.editing);
  if (!m || (name && !SLUG.test(name))) return;
  const moves = [...m.moves];
  while (moves.length < 4) moves.push('');
  moves[index] = name;
  m.moves = moves.filter(Boolean);
  saveTeams();
  if (name && !state.moves.has(name)) {
    try { state.moves.set(name, await get(`${API}/move/${name}`)); } catch {}
  }
  if (state.editing === m.id) paintMemberEditor();
}

/* ------------------------------------------------------------------ */
/* VIEW: OFFLINE DEX                                                   */
/* ------------------------------------------------------------------ */

function dexUrls() {
  const urls = [];
  for (const p of state.list) {
    urls.push(`${API}/pokemon/${p.id}`);
    urls.push(`${API}/pokemon-species/${p.id}`);
  }
  return urls;
}

async function storageReport() {
  const entries = await idbCount();
  let used = null, quota = null;
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      used = est.usage; quota = est.quota;
    }
  } catch {}
  return { entries: entries || 0, used, quota };
}

const mb = n => n == null ? '—' : (n / 1048576).toFixed(0) + ' MB';

async function startDownload() {
  if (state.dl.running) return;
  try { await navigator.storage?.persist?.(); } catch {}

  const urls = dexUrls();
  const have = new Set((await idbKeys()) || []);
  const todo = urls.filter(u => !have.has(u));

  state.dl = { running: true, done: urls.length - todo.length, total: urls.length, stop: false };
  paintProgress();

  await pool(todo, 6, async url => {
    if (state.dl.stop) return;
    await get(url);
    state.dl.done++;
    if (state.dl.done % 5 === 0) paintProgress();
  });

  const stopped = state.dl.stop;
  state.dl.running = false;
  if (state.mode === 'offline') renderOffline();
  toast(stopped ? 'Download paused — progress is saved' : 'Offline dex ready ◍');
}

function paintProgress() {
  const bar = document.querySelector('#dlBar > div');
  const label = $('dlLabel');
  if (!bar || !label) return;
  const pct = state.dl.total ? state.dl.done / state.dl.total * 100 : 0;
  bar.style.width = pct.toFixed(1) + '%';
  label.textContent = `${state.dl.done.toLocaleString()} / ${state.dl.total.toLocaleString()} records · ${pct.toFixed(0)}%`;
}

async function renderOffline() {
  showList(false);
  $('crumb').textContent = 'OFFLINE DEX';
  document.querySelectorAll('.navitem').forEach(n => n.classList.toggle('active', n.dataset.nav === 'offline'));

  const { entries, used, quota } = await storageReport();
  if (state.mode !== 'offline') return;

  const total = state.list.length * 2;
  const pct = total ? Math.min(100, entries / total * 100) : 0;
  const ready = pct >= 99;

  $('panel').innerHTML = `
    <div class="kicker">DATA</div>
    <h2 class="panel-title">Offline Dex</h2>
    <p class="dex-desc">AtlasDex saves every Pokémon it loads to your device. Download the full National Dex
    and the app keeps working with no connection at all — search, stats, matchups, team analysis and the game.</p>

    <div class="offline-card ${ready ? 'ready' : ''}">
      <div class="off-top">
        <div>
          <small>${ready ? 'FULLY AVAILABLE OFFLINE' : state.dl.running ? 'DOWNLOADING' : 'PARTIALLY CACHED'}</small>
          <strong id="dlLabel">${entries.toLocaleString()} / ${total.toLocaleString()} records · ${pct.toFixed(0)}%</strong>
        </div>
        <span class="off-dot ${navigator.onLine ? '' : 'off'}">${navigator.onLine ? 'Online' : 'Offline'}</span>
      </div>
      <div class="bar" id="dlBar"><div style="width:${pct}%"></div></div>
      <div class="detail-actions">
        ${state.dl.running
          ? `<button class="secondaryaction" data-dlstop="1">Pause download</button>`
          : `<button class="primaryaction" data-dlstart="1">${pct > 0 && !ready ? 'Resume download' : ready ? 'Refresh cache' : 'Download full dex'}</button>`}
        <button class="secondaryaction" data-dlclear="1">Clear cached data</button>
      </div>
    </div>

    <div class="facts">
      <div class="fact"><small>STORAGE USED</small><strong>${mb(used)}</strong></div>
      <div class="fact"><small>STORAGE AVAILABLE</small><strong>${mb(quota)}</strong></div>
      <div class="fact"><small>SPECIES</small><strong>${state.list.length.toLocaleString()}</strong></div>
    </div>

    <h3 class="paneltitle">Your data</h3>
    <p class="dex-desc">Favorites, living dex progress, saved teams and your game streak live in this browser only.
    Clearing site data erases them, so keep a backup.</p>
    <div class="detail-actions">
      <button class="primaryaction" data-export="1">↓ Export backup (JSON)</button>
      <button class="secondaryaction" data-import="1">↑ Import backup</button>
    </div>

    <p class="dex-desc">The full download is roughly two records per species and usually lands between 60 and 150 MB.
    It is resumable, so pausing loses nothing. Artwork is cached separately by the browser as you browse,
    so Pokémon you have already seen will show their images offline too.</p>`;

  if (state.dl.running) paintProgress();
}

/* ------------------------------------------------------------------ */
/* VIEW: TYPE MATCHUP CALCULATOR                                       */
/* ------------------------------------------------------------------ */

function renderMatchups() {
  showList(false);
  $('crumb').textContent = 'TYPE MATCHUPS';
  document.querySelectorAll('.navitem').forEach(n => n.classList.toggle('active', n.dataset.nav === 'matchups'));

  const defTypes = [state.def1, state.def2].filter(Boolean);
  const result = effectiveness(state.atk, defTypes);
  const prof = defensiveProfile(defTypes);

  const verdict = result === 0 ? 'No effect at all.'
    : result >= 4 ? 'Devastating. Four times damage.'
    : result > 1 ? 'Super effective.'
    : result === 1 ? 'Normal damage.'
    : result <= 0.25 ? 'Barely scratches it.'
    : 'Not very effective.';

  const picker = (name, selected, allowNone) => `<div class="typepicker" data-picker="${safe(name)}">
    ${allowNone ? `<button class="tp ${!selected ? 'on' : ''}" data-val="">None</button>` : ''}
    ${TYPES.map(t => `<button class="tp ${selected === t ? 'on' : ''}" data-val="${safe(t)}"
      style="--type-color:${COLORS[t]}">${safe(title(t))}</button>`).join('')}</div>`;

  $('panel').innerHTML = `
    <div class="kicker">BATTLE MATH</div>
    <h2 class="panel-title">Type Matchup Calculator</h2>
    <p class="dex-desc">Pick an attacking type and up to two defending types to see the exact damage multiplier.</p>

    <h3 class="paneltitle">Attacking type</h3>
    ${picker('atk', state.atk, false)}
    <h3 class="paneltitle">Defending type 1</h3>
    ${picker('def1', state.def1, false)}
    <h3 class="paneltitle">Defending type 2 <small style="font-weight:400">(optional)</small></h3>
    ${picker('def2', state.def2, true)}

    <div class="result-card ${multClass(result)}">
      <small>${safe(title(state.atk))} → ${defTypes.map(t => safe(title(t))).join(' / ')}</small>
      <strong>${multLabel(result)}</strong>
      <p>${verdict}</p>
    </div>

    <h3 class="paneltitle">Everything that hits ${defTypes.map(t => safe(title(t))).join(' / ')}</h3>
    <div class="mu-grid">${TYPES.map(t =>
      `<div class="mu-cell ${multClass(prof[t])}" style="--type-color:${COLORS[t]}">
        <span>${safe(title(t))}</span><b>${multLabel(prof[t])}</b></div>`).join('')}</div>`;
}

/* ------------------------------------------------------------------ */
/* VIEW: WHO'S THAT POKÉMON?                                           */
/* ------------------------------------------------------------------ */

const ROUND = 5;
const todayKey = () => new Date().toISOString().slice(0, 10);

/* Deterministic PRNG so everyone gets the same daily puzzle. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function buildQuestions(mode) {
  const seed = mode === 'daily' ? seedFrom('atlasdex-' + todayKey()) : (Math.random() * 1e9) | 0;
  const rnd = mulberry32(seed);

  let pool = state.list;
  if (mode === 'endless' && state.gameGen) pool = pool.filter(p => genOf(p.id) === Number(state.gameGen));
  if (pool.length < 8) pool = state.list;

  const pick = () => pool[Math.floor(rnd() * pool.length)];
  const questions = [];
  const used = new Set();

  while (questions.length < ROUND) {
    const answer = pick();
    if (used.has(answer.id)) continue;
    used.add(answer.id);

    const options = [answer];
    let guard = 0;
    while (options.length < 4 && guard++ < 200) {
      const d = pick();
      if (!options.some(o => o.id === d.id)) options.push(d);
    }
    /* Shuffle with the same seeded generator. */
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    questions.push({ answer, options });
  }
  return questions;
}

function startGame(mode) {
  state.game = { mode, q: 0, questions: buildQuestions(mode), results: [], revealed: false, picked: null };
  renderGame();
}

function answerGame(id) {
  const g = state.game;
  if (!g || g.revealed) return;
  const q = g.questions[g.q];
  g.picked = id;
  g.revealed = true;
  g.results.push(id === q.answer.id);
  renderGame();
}

function nextGame() {
  const g = state.game;
  if (!g) return;
  if (g.q + 1 >= g.questions.length) { finishGame(); return; }
  g.q++; g.revealed = false; g.picked = null;
  renderGame();
}

function finishGame() {
  const g = state.game;
  g.finished = true;
  const score = g.results.filter(Boolean).length;

  if (g.mode === 'daily') {
    const st = state.gameStats;
    const today = todayKey();
    if (st.lastDaily !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      st.streak = st.lastDaily === yesterday ? (st.streak || 0) + 1 : 1;
      st.best = Math.max(st.best || 0, st.streak);
      st.lastDaily = today;
      st.lastScore = score;
      st.lastGrid = g.results.map(r => r ? '🟩' : '🟥').join('');
      store('atlasdex:game', st);
    }
  }
  renderGame();
}

function shareResult() {
  const g = state.game;
  const grid = g.results.map(r => r ? '🟩' : '🟥').join('');
  const score = g.results.filter(Boolean).length;
  const text = `AtlasDex — Who's That Pokémon?\n${g.mode === 'daily' ? todayKey() : 'Endless'}  ${grid}  ${score}/${ROUND}`
    + (g.mode === 'daily' ? `\nStreak: ${state.gameStats.streak} 🔥` : '');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Result copied to clipboard')).catch(() => toast('Could not copy'));
  } else toast('Clipboard unavailable');
}

function renderGame() {
  showList(false);
  $('crumb').textContent = "WHO'S THAT POKÉMON";
  document.querySelectorAll('.navitem').forEach(n => n.classList.toggle('active', n.dataset.nav === 'game'));

  syncCounts();
  const st = state.gameStats;
  const doneToday = st.lastDaily === todayKey();
  const header = `<div class="kicker">DAILY CHALLENGE</div>
    <h2 class="panel-title">Who's That Pokémon?</h2>
    <div class="game-stats">
      <div class="fact"><small>CURRENT STREAK</small><strong>${int0(st.streak)} 🔥</strong></div>
      <div class="fact"><small>BEST STREAK</small><strong>${int0(st.best)}</strong></div>
      <div class="fact"><small>TODAY</small><strong>${doneToday ? `${int0(st.lastScore)}/${ROUND} ✓` : 'Not played'}</strong></div>
    </div>`;

  /* --- menu --- */
  if (!state.game) {
    $('panel').innerHTML = `${header}
      <p class="dex-desc">Identify the Pokémon from its silhouette. The daily challenge is five
      Pokémon, the same five for everyone, and it resets at midnight.</p>
      <div class="game-menu">
        <button class="gamecard ${doneToday ? 'done' : ''}" data-game="daily">
          <span class="gc-icon">◐</span>
          <strong>${doneToday ? "Replay today's challenge" : "Play today's challenge"}</strong>
          <small>${doneToday ? `You scored ${int0(st.lastScore)}/${ROUND} — replaying won't change your streak` : `5 silhouettes · builds your streak`}</small>
        </button>
        <button class="gamecard" data-game="endless">
          <span class="gc-icon">∞</span>
          <strong>Endless practice</strong>
          <small>Random rounds, filter by generation, no streak pressure</small>
        </button>
      </div>
      <h3 class="paneltitle">Practice difficulty</h3>
      <div class="chipbar">
        <button class="chip ${!state.gameGen ? 'on' : ''}" data-gamegen="">All generations</button>
        ${Array.from({ length: 9 }, (_, i) => `<button class="chip ${state.gameGen == i + 1 ? 'on' : ''}" data-gamegen="${i + 1}">Gen ${ROMAN[i]}</button>`).join('')}
      </div>`;
    return;
  }

  const g = state.game;

  /* --- results --- */
  if (g.finished) {
    const score = g.results.filter(Boolean).length;
    const grid = g.results.map(r => r ? '🟩' : '🟥').join('');
    const verdict = score === ROUND ? 'Perfect round. A true Pokémon Master.'
      : score >= 4 ? 'Strong showing.'
      : score >= 2 ? 'Not bad — a few got away.'
      : 'Rough one. The silhouettes won today.';
    $('panel').innerHTML = `${header}
      <div class="result-card ${score >= 4 ? 'm-resist' : score >= 2 ? 'm-neutral' : 'm-weak'}">
        <small>${g.mode === 'daily' ? todayKey() : 'Endless round'}</small>
        <strong>${score}/${ROUND}</strong>
        <div class="sharegrid">${grid}</div>
        <p>${verdict}</p>
      </div>
      <div class="answer-list">
        ${g.questions.map((q, i) => `<button class="nextcard ${g.results[i] ? '' : 'missed'}" data-open="${q.answer.id}">
          ${art(q.answer.id)}<strong>${safe(title(q.answer.name))}</strong>
          <small>${g.results[i] ? '✓ correct' : '✕ missed'}</small></button>`).join('')}
      </div>
      <div class="detail-actions">
        <button class="primaryaction" data-share="1">Share result</button>
        <button class="secondaryaction" data-game="${safe(g.mode)}">Play again</button>
        <button class="secondaryaction" data-gamemenu="1">Back to menu</button>
      </div>`;
    return;
  }

  /* --- question --- */
  const q = g.questions[g.q];
  $('panel').innerHTML = `${header}
    <div class="game-progress">
      ${g.questions.map((_, i) => `<span class="gp-dot ${i < g.results.length ? (g.results[i] ? 'hit' : 'miss') : ''} ${i === g.q ? 'now' : ''}"></span>`).join('')}
      <span class="gp-label">Question ${g.q + 1} of ${ROUND}</span>
      <button class="gp-quit" data-gamemenu="1">Quit ✕</button>
    </div>

    <div class="silhouette ${g.revealed ? 'revealed' : ''}">
      ${art(q.answer.id)}
    </div>

    <div class="guess-grid">
      ${q.options.map(o => {
        let cls = '';
        if (g.revealed) {
          if (o.id === q.answer.id) cls = 'correct';
          else if (o.id === g.picked) cls = 'wrong';
          else cls = 'dim';
        }
        return `<button class="guessbtn ${cls}" data-guess="${o.id}" ${g.revealed ? 'disabled' : ''}>
          ${safe(title(o.name))}</button>`;
      }).join('')}
    </div>

    ${g.revealed ? `<div class="reveal-row">
      <p>${g.results[g.results.length - 1]
        ? `Correct — it's <strong>${safe(title(q.answer.name))}</strong>.`
        : `It was <strong>${safe(title(q.answer.name))}</strong>.`}</p>
      <button class="primaryaction" data-gamenext="1">${g.q + 1 >= ROUND ? 'See results' : 'Next →'}</button>
    </div>` : '<p class="dex-desc">Tap the name that matches the silhouette.</p>'}`;
}

/* ------------------------------------------------------------------ */
/* DEXES: moves, abilities, items                                      */
/* ------------------------------------------------------------------ */

const KINDS = {
  move:    { label: 'Moves',     endpoint: 'move',    limit: 2000, cache: 'moves' },
  ability: { label: 'Abilities', endpoint: 'ability', limit: 500,  cache: 'abilities' },
  item:    { label: 'Items',     endpoint: 'item',    limit: 3000, cache: 'items' }
};

const DMG_CLASS = { physical: '●', special: '◆', status: '○' };
/* Own keys only: a class name from the API must never resolve to something
   inherited from Object.prototype. */
function dmgIcon(name) { return hasOwn(DMG_CLASS, name) ? DMG_CLASS[name] : ''; }

async function loadIndex(kind) {
  if (state.indexes[kind]) return state.indexes[kind];
  const k = KINDS[kind];
  const data = await get(`${API}/${k.endpoint}?limit=${k.limit}`);
  state.indexes[kind] = data.results.map(r => ({ name: r.name, id: idOf(r.url) }));
  return state.indexes[kind];
}

const cacheFor = kind => state[KINDS[kind].cache];

async function entityDetail(kind, name) {
  const cache = cacheFor(kind);
  if (!cache.has(name)) cache.set(name, await get(`${API}/${KINDS[kind].endpoint}/${name}`));
  return cache.get(name);
}

function englishEffect(payload) {
  const e = payload?.effect_entries?.find(x => x.language.name === 'en');
  if (e) return (e.short_effect || e.effect || '').replace(/[\f\n\r]/g, ' ');
  const f = payload?.flavor_text_entries?.find(x => x.language?.name === 'en');
  return (f?.flavor_text || f?.text || 'No description available.').replace(/[\f\n\r]/g, ' ');
}

/* ---- browse view ------------------------------------------------- */

function browseFiltered(kind) {
  const b = state.browse;
  let rows = state.indexes[kind] || [];
  if (b.search) rows = rows.filter(r => r.name.includes(b.search));

  const cache = cacheFor(kind);
  if (b.filter) {
    rows = rows.filter(r => {
      const d = cache.get(r.name);
      if (!d) return false;
      if (kind === 'move') return d.type?.name === b.filter || d.damage_class?.name === b.filter;
      if (kind === 'item') return d.category?.name === b.filter;
      return true;
    });
  }
  if (kind === 'move' && b.sort === 'power') {
    rows = [...rows].sort((x, y) => (cache.get(y.name)?.power || 0) - (cache.get(x.name)?.power || 0));
  }
  return rows;
}

function browseRow(kind, r) {
  const d = cacheFor(kind).get(r.name);
  if (kind === 'move') {
    return `<button class="dexrow" data-entity="move:${safe(r.name)}">
      <span class="dx-name">${safe(title(r.name))}</span>
      <span class="dx-type">${d ? typeBadge(d.type.name) : '<i class="dx-wait"></i>'}</span>
      <span class="dx-cls">${d ? safe(dmgIcon(d.damage_class?.name) + ' ' + title(d.damage_class?.name || '')) : ''}</span>
      <span class="dx-num">${d ? safe(d.power ?? '—') : ''}</span>
      <span class="dx-num">${d ? (d.accuracy ? safe(d.accuracy) + '%' : '—') : ''}</span>
      <span class="dx-num">${d ? safe(d.pp ?? '—') : ''}</span>
    </button>`;
  }
  if (kind === 'item') {
    const img = d?.sprites?.default;
    return `<button class="dexrow item" data-entity="item:${safe(r.name)}">
      <span class="dx-img">${img ? `<img src="${safe(img)}" alt="" loading="lazy">` : ''}</span>
      <span class="dx-name">${safe(title(r.name))}</span>
      <span class="dx-cat">${d ? safe(title(d.category?.name || '')) : ''}</span>
      <span class="dx-num">${d ? (d.cost ? '₽' + safe(Number(d.cost).toLocaleString()) : '—') : ''}</span>
    </button>`;
  }
  return `<button class="dexrow ability" data-entity="ability:${safe(r.name)}">
    <span class="dx-name">${safe(title(r.name))}</span>
    <span class="dx-effect">${d ? safe(englishEffect(d).slice(0, 120)) : ''}</span>
  </button>`;
}

async function renderBrowse(kind) {
  showList(false);
  state.browse.kind = kind;
  $('crumb').textContent = KINDS[kind].label.toUpperCase();
  document.querySelectorAll('.navitem').forEach(n => n.classList.toggle('active', n.dataset.nav === kind));

  if (!state.indexes[kind]) {
    $('panel').innerHTML = `<div class="kicker">REFERENCE</div>
      <h2 class="panel-title">${KINDS[kind].label}</h2><div class="empty">Loading ${KINDS[kind].label.toLowerCase()}…</div>`;
    try { await loadIndex(kind); } catch {
      $('panel').innerHTML = `<div class="empty"><strong>Could not load ${KINDS[kind].label}</strong>Check your connection.</div>`;
      return;
    }
    if (state.mode !== kind) return;
  }

  const b = state.browse;
  const rows = browseFiltered(kind);
  const page = rows.slice(0, b.shown);
  const loadedAll = state.browse.loadedAll[kind];

  const filters = kind === 'move'
    ? `<select id="brFilter"><option value="">All types &amp; classes</option>
        <optgroup label="Type">${TYPES.map(t => `<option value="${safe(t)}" ${b.filter === t ? 'selected' : ''}>${safe(title(t))}</option>`).join('')}</optgroup>
        <optgroup label="Category">${['physical','special','status'].map(c => `<option value="${safe(c)}" ${b.filter === c ? 'selected' : ''}>${safe(title(c))}</option>`).join('')}</optgroup>
       </select>
       <select id="brSort"><option value="">Sort: A to Z</option>
        <option value="power" ${b.sort === 'power' ? 'selected' : ''}>Sort: highest power</option></select>`
    : kind === 'item'
    ? `<select id="brFilter"><option value="">All categories</option>
        ${[...new Set([...state.items.values()].map(d => d.category?.name).filter(Boolean))].sort()
          .map(c => `<option value="${safe(c)}" ${b.filter === c ? 'selected' : ''}>${safe(title(c))}</option>`).join('')}
       </select>`
    : '';

  const head = kind === 'move'
    ? `<div class="dexrow dexhead"><span>Move</span><span>Type</span><span>Category</span><span>Power</span><span>Acc</span><span>PP</span></div>`
    : kind === 'item'
    ? `<div class="dexrow item dexhead"><span></span><span>Item</span><span>Category</span><span>Cost</span></div>`
    : `<div class="dexrow ability dexhead"><span>Ability</span><span>Effect</span></div>`;

  $('panel').innerHTML = `
    <div class="kicker">REFERENCE</div>
    <h2 class="panel-title">${KINDS[kind].label} <span class="heading-count">${rows.length.toLocaleString()}</span></h2>
    <div class="filterbar browse">
      <label class="search"><span aria-hidden="true">⌕</span>
        <input id="brSearch" type="search" placeholder="Search ${KINDS[kind].label.toLowerCase()}" value="${safe(b.search)}"></label>
      ${filters}
    </div>
    ${(kind !== 'ability' && !loadedAll) ? `<div class="loadall">
      <span>Filtering and sorting need the full dataset. Rows fill in as you scroll.</span>
      <button class="chip" data-loadall="${kind}">Load all ${KINDS[kind].label.toLowerCase()} data</button></div>` : ''}
    <div class="dextable">${head}${page.map(r => browseRow(kind, r)).join('')
      || '<div class="empty">Nothing matches that filter yet.</div>'}</div>
    ${rows.length > b.shown ? `<div class="loadMoreWrap"><button class="loadmore" data-browsemore="1">Load more ↓</button></div>` : ''}`;

  hydrateBrowse(kind, page.map(r => r.name));
}

async function hydrateBrowse(kind, names) {
  const token = ++state.request;
  const cache = cacheFor(kind);
  const pending = names.filter(n => !cache.has(n));
  if (!pending.length) return;
  await pool(pending, 6, async name => {
    cache.set(name, await get(`${API}/${KINDS[kind].endpoint}/${name}`));
  });
  if (token === state.request && state.mode === kind) renderBrowse(kind);
}

async function loadAllOf(kind) {
  const idx = state.indexes[kind] || [];
  const cache = cacheFor(kind);
  const pending = idx.filter(r => !cache.has(r.name)).map(r => r.name);
  if (!pending.length) { state.browse.loadedAll[kind] = true; renderBrowse(kind); return; }
  toast(`Loading ${pending.length.toLocaleString()} records — this runs in the background`);
  let done = 0;
  await pool(pending, 8, async name => {
    cache.set(name, await get(`${API}/${KINDS[kind].endpoint}/${name}`));
    if (++done % 100 === 0 && state.mode === kind) renderBrowse(kind);
  });
  state.browse.loadedAll[kind] = true;
  if (state.mode === kind) renderBrowse(kind);
  toast('All data loaded and cached');
}

/* ---- entity modal ------------------------------------------------ */

async function openEntity(kind, name) {
  state.entity = { kind, name };
  state.modalId = null;
  $('overlay').hidden = false;
  document.body.style.overflow = 'hidden';
  $('modalContent').innerHTML = '<div class="empty">Loading…</div>';
  history.replaceState(null, '', `#/${kind}/${name}`);
  let d;
  try { d = await entityDetail(kind, name); } catch {
    $('modalContent').innerHTML = '<div class="empty">Could not load that entry.</div>'; return;
  }
  if (state.entity?.name !== name) return;

  let body;
  if (kind === 'move') {
    const learners = (d.learned_by_pokemon || []).slice(0, 60);
    body = `<div class="facts">
        <div class="fact"><small>TYPE</small><strong>${safe(title(d.type.name))}</strong></div>
        <div class="fact"><small>CATEGORY</small><strong>${safe(title(d.damage_class?.name || '—'))}</strong></div>
        <div class="fact"><small>POWER</small><strong>${safe(d.power ?? '—')}</strong></div>
        <div class="fact"><small>ACCURACY</small><strong>${d.accuracy ? safe(d.accuracy) + '%' : '—'}</strong></div>
        <div class="fact"><small>PP</small><strong>${safe(d.pp ?? '—')}</strong></div>
        <div class="fact"><small>PRIORITY</small><strong>${safe(d.priority > 0 ? '+' + d.priority : d.priority ?? 0)}</strong></div>
      </div>
      <h3 class="paneltitle">Effect</h3><p class="dex-desc">${safe(englishEffect(d))}</p>
      ${d.effect_chance ? `<p class="dex-desc">Effect chance: ${safe(d.effect_chance)}%</p>` : ''}
      <h3 class="paneltitle">Learned by ${(d.learned_by_pokemon || []).length} Pokémon</h3>
      <div>${learners.map(p => `<span class="pill" data-openname="${safe(p.name)}">${safe(title(p.name))}</span>`).join('') || '<p class="dex-desc">None.</p>'}</div>
      ${(d.learned_by_pokemon || []).length > 60 ? '<p class="dex-desc">Showing the first 60.</p>' : ''}`;
  } else if (kind === 'ability') {
    const mons = (d.pokemon || []).slice(0, 60);
    body = `<div class="facts">
        <div class="fact"><small>GENERATION</small><strong>${safe(title(d.generation?.name?.replace('generation-', 'Gen ') || '—'))}</strong></div>
        <div class="fact"><small>POKÉMON</small><strong>${(d.pokemon || []).length}</strong></div>
        <div class="fact"><small>MAIN SERIES</small><strong>${d.is_main_series ? 'Yes' : 'No'}</strong></div>
      </div>
      <h3 class="paneltitle">Effect</h3><p class="dex-desc">${safe(englishEffect(d))}</p>
      <h3 class="paneltitle">Pokémon with this ability</h3>
      <div>${mons.map(p => `<span class="pill" data-openname="${safe(p.pokemon.name)}">${safe(title(p.pokemon.name))}${p.is_hidden ? ' · hidden' : ''}</span>`).join('')}</div>`;
  } else {
    const img = d.sprites?.default;
    body = `${img ? `<div class="itemart"><img src="${safe(img)}" alt="${safe(d.name)}"></div>` : ''}
      <div class="facts">
        <div class="fact"><small>CATEGORY</small><strong>${safe(title(d.category?.name || '—'))}</strong></div>
        <div class="fact"><small>COST</small><strong>${d.cost ? '₽' + safe(Number(d.cost).toLocaleString()) : '—'}</strong></div>
        <div class="fact"><small>FLING POWER</small><strong>${safe(d.fling_power ?? '—')}</strong></div>
      </div>
      <h3 class="paneltitle">Effect</h3><p class="dex-desc">${safe(englishEffect(d))}</p>
      ${d.held_by_pokemon?.length ? `<h3 class="paneltitle">Held in the wild by</h3>
        <div>${d.held_by_pokemon.slice(0, 30).map(h => `<span class="pill" data-openname="${safe(h.pokemon.name)}">${safe(title(h.pokemon.name))}</span>`).join('')}</div>` : ''}`;
  }

  $('modalContent').innerHTML = `
    <div class="entity-hero">
      <div class="detail-number">${KINDS[kind].label.toUpperCase().replace(/S$/, '')}</div>
      <h2>${safe(title(d.name))}</h2>
    </div>
    <div class="detail-body">${body}</div>`;
}

/* Jump from a name chip to that species' page. */
function openByName(name) {
  const base = name.split('-')[0];
  const hit = state.list.find(p => p.name === name) || state.list.find(p => p.name === base);
  if (hit) openPokemon(hit.id); else toast('That Pokémon is not in the species list');
}

/* ------------------------------------------------------------------ */
/* BATTLE MATH: natures, stats, damage, capture                        */
/* ------------------------------------------------------------------ */

/* [raised stat, lowered stat]; null/null means neutral. */
const NATURES = {
  hardy:[null,null], lonely:['attack','defense'], brave:['attack','speed'],
  adamant:['attack','special-attack'], naughty:['attack','special-defense'],
  bold:['defense','attack'], docile:[null,null], relaxed:['defense','speed'],
  impish:['defense','special-attack'], lax:['defense','special-defense'],
  timid:['speed','attack'], hasty:['speed','defense'], serious:[null,null],
  jolly:['speed','special-attack'], naive:['speed','special-defense'],
  modest:['special-attack','attack'], mild:['special-attack','defense'],
  quiet:['special-attack','speed'], bashful:[null,null], rash:['special-attack','special-defense'],
  calm:['special-defense','attack'], gentle:['special-defense','defense'],
  sassy:['special-defense','speed'], careful:['special-defense','special-attack'], quirky:[null,null]
};

const BALLS = {
  'Poké Ball':1, 'Great Ball':1.5, 'Ultra Ball':2, 'Dusk Ball':3,
  'Quick Ball':5, 'Net Ball':3.5, 'Timer Ball':4, 'Master Ball':255
};
const STATUSES = { None:1, 'Burn / Poison / Paralysis':1.5, 'Sleep / Freeze':2.5 };

function natureMod(nature, statName) {
  const [up, down] = NATURES[nature] || [null, null];
  if (up === statName && down !== statName) return 1.1;
  if (down === statName && up !== statName) return 0.9;
  return 1;
}

/* Gen 3+ stat formula. */
function realStat(base, iv, ev, level, statName, nature) {
  const core = Math.floor((2 * base + iv + Math.floor(ev / 4)) * level / 100);
  if (statName === 'hp') {
    if (base === 1) return 1;            // Shedinja
    return core + level + 10;
  }
  return Math.floor((core + 5) * natureMod(nature, statName));
}

/* Gen 5+ damage formula, returning the 85–100% roll spread. */
function damageRange(opts) {
  const { level, power, atk, def, stab, typeMult, crit, burn, other } = opts;
  if (!power || typeMult === 0) return { min: 0, max: 0 };
  const base = Math.floor(Math.floor(Math.floor(2 * level / 5 + 2) * power * atk / def) / 50) + 2;
  const mods = (crit ? 1.5 : 1) * (stab ? 1.5 : 1) * typeMult * (burn ? 0.5 : 1) * (other || 1);
  return {
    min: Math.max(typeMult > 0 ? 1 : 0, Math.floor(base * 0.85 * mods)),
    max: Math.max(typeMult > 0 ? 1 : 0, Math.floor(base * 1.00 * mods))
  };
}

/* Gen 5+ capture probability, including the four shake checks. */
function catchChance(maxHp, currentHp, captureRate, ballMult, statusMult) {
  if (ballMult >= 255) return 1;
  const a = ((3 * maxHp - 2 * currentHp) * captureRate * ballMult) / (3 * maxHp) * statusMult;
  if (a >= 255) return 1;
  const b = 65536 / Math.pow(255 / a, 3 / 16);
  return Math.pow(b / 65536, 4);
}

/* ------------------------------------------------------------------ */
/* VIEW: CALCULATORS                                                   */
/* ------------------------------------------------------------------ */

const num = (id, label, val, min, max, step) =>
  `<label class="field"><small>${safe(label)}</small>
    <input type="number" data-calc="${safe(id)}" value="${safe(val)}" min="${safe(min)}" max="${safe(max)}" step="${safe(step || 1)}"></label>`;
const sel = (id, label, val, opts) =>
  `<label class="field"><small>${safe(label)}</small><select data-calc="${safe(id)}">
    ${opts.map(o => `<option value="${safe(o)}" ${String(o) === String(val) ? 'selected' : ''}>${safe(title(String(o)))}</option>`).join('')}
  </select></label>`;
const chk = (id, label, val) =>
  `<label class="field check"><input type="checkbox" data-calc="${safe(id)}" ${val ? 'checked' : ''}><small>${safe(label)}</small></label>`;

function statsCalcPanel() {
  const c = state.calc;
  const mon = state.details.get(state.calcMon) || null;
  const rows = (mon?.stats || []).map(s => {
    const name = s.stat.name;
    const value = realStat(s.base_stat, c.iv, c.ev, c.level, name, c.nature);
    const mod = natureMod(c.nature, name);
    return `<div class="statrow"><span>${safe(STAT_LABEL[name] || title(name))}
        ${mod > 1 ? '<i class="up">▲</i>' : mod < 1 ? '<i class="down">▼</i>' : ''}</span>
      <b>${value}</b>
      <div class="bar"><div style="width:${Math.min(100, value / 714 * 100)}%"></div></div></div>`;
  }).join('');

  return `<p class="dex-desc">Converts base stats into real in-game stats using the Gen 3+ formula.
    Pick a Pokémon from any card with the ⬢ team button, or open one and use its Stats tab for a prefilled version.</p>
    <div class="fieldgrid">
      ${num('level', 'LEVEL', c.level, 1, 100)}
      ${sel('nature', 'NATURE', c.nature, Object.keys(NATURES))}
      ${num('iv', 'IV (0–31)', c.iv, 0, 31)}
      ${num('ev', 'EV (0–252)', c.ev, 0, 252, 4)}
    </div>
    ${mon ? `<h3 class="paneltitle">${safe(title(mon.name))} at level ${c.level}</h3>${rows}`
      : `<div class="empty">Open any Pokémon and use its <strong>Stats</strong> tab to calculate with real base stats.</div>`}
    <p class="dex-desc">Nature arrows mark the raised and lowered stat. 31 IVs and 252 EVs is the competitive maximum
    for a single stat, with 510 EVs total across all six.</p>`;
}

/* Pick-two-Pokémon damage calculation driven by real loadouts. */
function teamDamagePanel() {
  const c = state.calc;
  const roster = state.team.filter(m => state.details.has(m.id));
  if (roster.length < 1) {
    return `<div class="empty"><strong>Add Pokémon to your team first</strong>
      This mode reads real stats and moves from your saved team.<br>
      <a class="errorbutton" href="#/">Browse the Pokédex</a></div>`;
  }

  /* Select values arrive as strings, so compare numerically. */
  const atkM = roster.find(m => m.id === Number(c.atkId)) || roster[0];
  const defM = roster.find(m => m.id === Number(c.defId)) || roster[roster.length > 1 ? 1 : 0];
  const aStats = memberStats(atkM), dStats = memberStats(defM);
  const aMoves = damagingMoves(atkM);
  const move = aMoves.find(mv => mv.name === c.moveName) || aMoves[0];

  const picker = (key, cur) => `<label class="field"><small>${key === 'atkId' ? 'ATTACKER' : 'DEFENDER'}</small>
    <select data-calc="${key}">${roster.map(m =>
      `<option value="${toId(m.id)}" ${m.id === cur.id ? 'selected' : ''}>${safe(title(pokeName(m.id)))} (Lv ${int0(m.level)})</option>`).join('')}</select></label>`;

  if (!move) {
    return `<div class="fieldgrid">${picker('atkId', atkM)}${picker('defId', defM)}</div>
      <div class="empty"><strong>${safe(title(pokeName(atkM.id)))} has no damaging moves</strong>
        Open the Team Builder and give it a move.<br>
        <a class="errorbutton" href="#/team">Go to Team Builder</a></div>`;
  }

  const defTypes = typesOf(defM.id);
  const typeMult = effectiveness(move.type.name, defTypes);
  const stab = typesOf(atkM.id).includes(move.type.name);
  const physical = move.damage_class?.name === 'physical';
  const atk = physical ? aStats.attack : aStats['special-attack'];
  const def = physical ? dStats.defense : dStats['special-defense'];

  const { min, max } = damageRange({
    level: atkM.level, power: move.power, atk, def,
    stab, typeMult, crit: c.dCrit, burn: c.dBurn && physical
  });
  const hp = dStats.hp;
  const pMin = min / hp * 100, pMax = max / hp * 100;
  const hits = max > 0 ? Math.ceil(hp / max) : null;
  const guaranteed = min >= hp;

  return `<p class="dex-desc">Reads real stats, natures, EVs and moves straight from your saved team.</p>
    <div class="fieldgrid">
      ${picker('atkId', atkM)}
      <label class="field"><small>MOVE</small>
        <select data-calc="moveName">${aMoves.map(mv =>
          `<option value="${safe(mv.name)}" ${mv.name === move.name ? 'selected' : ''}>${safe(title(mv.name))} (${safe(mv.power)})</option>`).join('')}</select></label>
      ${picker('defId', defM)}
    </div>
    <div class="checkrow">
      ${chk('dCrit', 'Critical hit', c.dCrit)}
      ${chk('dBurn', 'Attacker burned', c.dBurn)}
    </div>

    <div class="matchline">
      <span>${safe(title(pokeName(atkM.id)))}</span>
      <b>${safe(title(move.name))} ${typeBadge(move.type.name)}</b>
      <span>${safe(title(pokeName(defM.id)))}</span>
    </div>

    <div class="result-card ${pMax >= 100 ? 'm-weak' : pMax >= 50 ? 'm-neutral' : 'm-resist'}">
      <small>${multLabel(typeMult)}${stab ? ' · STAB' : ''} · ${physical ? 'Physical' : 'Special'}</small>
      <strong>${min} – ${max}</strong>
      <p>${pMin.toFixed(1)}% – ${pMax.toFixed(1)}% of ${safe(title(pokeName(defM.id)))}'s ${hp} HP.
      ${typeMult === 0 ? 'No effect at all.'
        : guaranteed ? 'Guaranteed one-hit KO.'
        : max >= hp ? 'Possible one-hit KO on a high roll.'
        : `Needs about ${hits} hits.`}</p>
    </div>

    <div class="facts">
      <div class="fact"><small>ATTACK USED</small><strong>${atk}</strong></div>
      <div class="fact"><small>DEFENCE USED</small><strong>${def}</strong></div>
      <div class="fact"><small>MOVE POWER</small><strong>${safe(move.power)}</strong></div>
      <div class="fact"><small>EFFECTIVENESS</small><strong>${multLabel(typeMult)}</strong></div>
    </div>`;
}

function damageCalcPanel() {
  const c = state.calc;
  const { min, max } = damageRange({
    level: c.dLevel, power: c.dPower, atk: c.dAtk, def: c.dDef,
    stab: c.dStab, typeMult: Number(c.dType), crit: c.dCrit, burn: c.dBurn
  });
  const pctMin = c.dHp ? (min / c.dHp * 100) : 0;
  const pctMax = c.dHp ? (max / c.dHp * 100) : 0;
  const hits = max > 0 ? Math.ceil(c.dHp / max) : '∞';
  const koText = max >= c.dHp ? 'Guaranteed one-hit KO at maximum roll.'
    : `Roughly a ${hits}-hit KO at best rolls.`;

  return `<p class="dex-desc">The Gen 5+ damage formula including the 85–100% random roll.
    Use the Stats calculator or a Pokémon's Stats tab to get real attack and defence numbers.</p>
    <div class="fieldgrid">
      ${num('dLevel', 'ATTACKER LEVEL', c.dLevel, 1, 100)}
      ${num('dPower', 'MOVE POWER', c.dPower, 0, 250)}
      ${num('dAtk', 'ATTACK STAT', c.dAtk, 1, 999)}
      ${num('dDef', 'DEFENCE STAT', c.dDef, 1, 999)}
      ${num('dHp', 'DEFENDER MAX HP', c.dHp, 1, 999)}
      ${sel('dType', 'TYPE EFFECTIVENESS', c.dType, [0, 0.25, 0.5, 1, 2, 4])}
    </div>
    <div class="checkrow">
      ${chk('dStab', 'STAB (same type as attacker)', c.dStab)}
      ${chk('dCrit', 'Critical hit', c.dCrit)}
      ${chk('dBurn', 'Attacker burned (physical)', c.dBurn)}
    </div>
    <div class="result-card ${pctMax >= 100 ? 'm-weak' : pctMax >= 50 ? 'm-neutral' : 'm-resist'}">
      <small>DAMAGE RANGE</small>
      <strong>${min} – ${max}</strong>
      <p>${pctMin.toFixed(1)}% – ${pctMax.toFixed(1)}% of the defender's HP. ${koText}</p>
    </div>`;
}

function catchCalcPanel() {
  const c = state.calc;
  const p = catchChance(c.cMaxHp, Math.max(1, c.cHp), c.cRate, BALLS[c.cBall] || 1, STATUSES[c.cStatus] || 1);
  const pct = p * 100;
  const expected = p > 0 ? Math.ceil(1 / p) : '∞';
  return `<p class="dex-desc">Gen 5+ capture formula, including all four shake checks.
    A species' capture rate is shown on its Breeding tab.</p>
    <div class="fieldgrid">
      ${num('cRate', 'CAPTURE RATE (3–255)', c.cRate, 3, 255)}
      ${num('cMaxHp', 'MAX HP', c.cMaxHp, 1, 999)}
      ${num('cHp', 'CURRENT HP', c.cHp, 1, 999)}
      ${sel('cBall', 'BALL', c.cBall, Object.keys(BALLS))}
      ${sel('cStatus', 'STATUS', c.cStatus, Object.keys(STATUSES))}
    </div>
    <div class="result-card ${pct >= 50 ? 'm-resist' : pct >= 15 ? 'm-neutral' : 'm-weak'}">
      <small>CATCH CHANCE PER BALL</small>
      <strong>${pct.toFixed(1)}%</strong>
      <p>Expect about ${expected} ball${expected === 1 ? '' : 's'} on average.
      ${c.cHp / c.cMaxHp > 0.5 ? 'Lowering its HP further would help a lot.' : 'HP is already low enough to matter.'}</p>
    </div>`;
}

async function breedingCalcPanel() {
  const c = state.calc;
  const groups = ['monster','water1','water2','water3','bug','flying','ground','fairy','plant',
    'humanshape','mineral','indeterminate','ditto','dragon','no-eggs'];
  let listing = '<div class="empty">Loading egg group…</div>';
  try {
    const d = await get(`${API}/egg-group/${c.eggGroup}`);
    const mons = (d.pokemon_species || []).slice(0, 120);
    listing = `<h3 class="paneltitle">${mons.length}${(d.pokemon_species || []).length > 120 ? '+' : ''} compatible species</h3>
      <div>${mons.map(m => `<span class="pill" data-openname="${safe(m.name)}">${safe(title(m.name))}</span>`).join('')}</div>`;
  } catch { listing = '<div class="empty">Could not load that egg group.</div>'; }
  return `<p class="dex-desc">Two Pokémon can breed if they share an egg group and have opposite genders.
    Ditto is the exception and pairs with almost anything.</p>
    <div class="fieldgrid">${sel('eggGroup', 'EGG GROUP', c.eggGroup, groups)}</div>
    ${listing}`;
}

function naturesPanel() {
  return `<p class="dex-desc">Each nature raises one stat by 10% and lowers another by 10%.
    Five natures are neutral and change nothing.</p>
    <div class="naturegrid">
      ${Object.entries(NATURES).map(([n, [up, down]]) => `<div class="naturecard ${!up ? 'neutral' : ''}">
        <strong>${safe(title(n))}</strong>
        ${up ? `<span class="nt-up">▲ ${safe(STAT_LABEL[up])}</span><span class="nt-down">▼ ${safe(STAT_LABEL[down])}</span>`
             : '<span class="nt-flat">No change</span>'}
      </div>`).join('')}
    </div>`;
}

async function renderCalculators() {
  showList(false);
  $('crumb').textContent = 'CALCULATORS';
  document.querySelectorAll('.navitem').forEach(n => n.classList.toggle('active', n.dataset.nav === 'calc'));

  const tabs = [['stats','Stats'],['team-damage','Team Damage'],['damage','Damage (manual)'],
    ['catch','Catch Rate'],['breeding','Breeding'],['natures','Natures']];
  const body = state.calcTab === 'stats' ? statsCalcPanel()
    : state.calcTab === 'team-damage' ? teamDamagePanel()
    : state.calcTab === 'damage' ? damageCalcPanel()
    : state.calcTab === 'catch' ? catchCalcPanel()
    : state.calcTab === 'natures' ? naturesPanel()
    : '<div class="empty">Loading…</div>';

  $('panel').innerHTML = `<div class="kicker">TOOLS</div>
    <h2 class="panel-title">Calculators</h2>
    <div class="detail-tabs">${tabs.map(([k, l]) =>
      `<button data-calctab="${k}" class="${state.calcTab === k ? 'selected' : ''}">${l}</button>`).join('')}</div>
    <div id="calcBody">${body}</div>`;

  if (state.calcTab === 'breeding') {
    const html = await breedingCalcPanel();
    if (state.mode === 'calc' && state.calcTab === 'breeding') $('calcBody').innerHTML = html;
  }
}

/* ------------------------------------------------------------------ */
/* VIEW: COMPARE                                                       */
/* ------------------------------------------------------------------ */

async function openComparison() {
  if (state.compare.length !== 2) { toast('Choose two Pokémon using the ⇄ button'); location.hash = '#/'; return; }
  state.modalId = null;
  $('overlay').hidden = false;
  document.body.style.overflow = 'hidden';
  $('modalContent').innerHTML = '<div class="empty">Preparing comparison…</div>';
  try {
    const [a, b] = await Promise.all(state.compare.map(id => get(`${API}/pokemon/${id}`)));
    const box = p => {
      const types = p.types.map(t => t.type.name);
      const total = p.stats.reduce((x, y) => x + y.base_stat, 0);
      const prof = defensiveProfile(types);
      const weak = TYPES.filter(t => prof[t] > 1);
      return `<div class="comparebox">
        <img src="${sprite(p.id, state.shiny)}" alt="${safe(p.name)}">
        <h3>${safe(title(p.name))} <small>${pad(p.id)}</small></h3>
        <div class="types" style="justify-content:center">${p.types.map(t => typeBadge(t.type.name)).join('')}</div>
        <div class="cmp-total">${total} <small>TOTAL</small></div>
        ${statRows(p)}
        <div class="cmp-weak"><small>WEAK TO</small>
          <div class="types">${weak.length ? weak.map(typeBadge).join('') : '<span class="pill">Nothing</span>'}</div></div>
      </div>`;
    };
    $('modalContent').innerHTML = `<div class="detail-body">
      <h2 class="paneltitle">Head-to-head comparison</h2>
      <p class="dex-desc">Base stats, typing and defensive weaknesses side by side.</p>
      <div class="compare-grid">${box(a)}${box(b)}</div>
      <div class="detail-actions"><button class="secondaryaction" data-clear-compare="1">Clear comparison</button></div>
    </div>`;
  } catch {
    $('modalContent').innerHTML = '<div class="empty">Comparison unavailable. Check your network and retry.</div>';
  }
}

/* ------------------------------------------------------------------ */
/* COMMAND PALETTE                                                     */
/* ------------------------------------------------------------------ */

const ROUTES = [
  ['Pokédex', '#/'], ['Moves', '#/moves'], ['Abilities', '#/abilities'], ['Items', '#/items'],
  ['Favorites', '#/favorites'], ['Living Dex', '#/progress'], ['Team Builder', '#/team'],
  ["Who's That Pokémon", '#/game'], ['Calculators', '#/calc'], ['Type Matchups', '#/matchups'],
  ['Compare', '#/compare'], ['Offline & Data', '#/offline']
];

function openPalette() {
  state.palette = { open: true, q: '', sel: 0 };
  $('palette').hidden = false;
  $('paletteInput').value = '';
  $('paletteInput').focus();
  paintPalette();
  /* Indexes make the palette far more useful; load them quietly. */
  ['move', 'ability', 'item'].forEach(k => {
    if (!state.indexes[k]) loadIndex(k).then(() => { if (state.palette.open) paintPalette(); }).catch(() => {});
  });
}
function closePalette() {
  state.palette.open = false;
  $('palette').hidden = true;
}

function paletteResults() {
  const q = state.palette.q.trim().toLowerCase();
  const out = [];
  const push = (kind, label, sub, action) => out.push({ kind, label, sub, action });

  if (!q) {
    ROUTES.slice(0, 8).forEach(([l, h]) => push('Go', l, h, () => { location.hash = h; }));
    return out;
  }
  ROUTES.filter(([l]) => l.toLowerCase().includes(q))
    .forEach(([l, h]) => push('Go', l, h, () => { location.hash = h; }));

  state.list.filter(p => p.name.includes(q)).slice(0, 8)
    .forEach(p => push('Pokémon', title(p.name), pad(p.id), () => openPokemon(p.id)));

  for (const kind of ['move', 'ability', 'item']) {
    (state.indexes[kind] || []).filter(r => r.name.includes(q)).slice(0, 5)
      .forEach(r => push(KINDS[kind].label.replace(/s$/, ''), title(r.name), '', () => openEntity(kind, r.name)));
  }
  return out.slice(0, 24);
}

function paintPalette() {
  const rows = paletteResults();
  state.palette.rows = rows;
  if (state.palette.sel >= rows.length) state.palette.sel = Math.max(0, rows.length - 1);
  $('paletteResults').innerHTML = rows.length
    ? rows.map((r, i) => `<button class="pal-row ${i === state.palette.sel ? 'on' : ''}" data-pal="${i}">
        <span class="pal-kind">${safe(r.kind)}</span>
        <span class="pal-label">${safe(r.label)}</span>
        <span class="pal-sub">${safe(r.sub || '')}</span></button>`).join('')
    : '<div class="pal-empty">Nothing found. Try a different spelling.</div>';
}

function runPalette(i) {
  const row = (state.palette.rows || [])[i];
  if (!row) return;
  closePalette();
  row.action();
}

/* ------------------------------------------------------------------ */
/* DATA EXPORT / IMPORT                                                */
/* ------------------------------------------------------------------ */

function exportData() {
  const payload = {
    app: 'AtlasDex', version: BACKUP_VERSION, exported: new Date().toISOString(),
    favorites: [...state.favorites], caught: [...state.caught],
    teams: state.teams, activeTeam: activeIdx(),
    compare: state.compare, game: state.gameStats,
    settings: { theme: state.theme, shiny: state.shiny }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `atlasdex-backup-${todayKey()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup downloaded');
}

/* A real backup is a few hundred KB at most (every species caught, eight full
   teams). Anything far beyond that is not one, so it is refused unread. */
const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

/* Turns parsed JSON into a clean backup, or says why it cannot be one. Nothing
   in `d` is ever copied through: each field is rebuilt by its sanitiser. */
function sanitizeBackup(d) {
  if (!isObj(d) || own(d, 'app') !== 'AtlasDex') return { error: 'That is not an AtlasDex backup' };
  const version = own(d, 'version');
  if (version != null && !inRange(version, 1, BACKUP_VERSION)) {
    return { error: 'That backup was made by a different version of AtlasDex' };
  }
  const present = k => own(d, k) != null;
  for (const k of ['favorites', 'caught', 'compare', 'teams']) {
    if (present(k) && !Array.isArray(own(d, k))) return { error: `That backup is damaged (${k} is not a list)` };
  }
  for (const k of ['game', 'settings']) {
    if (present(k) && !isObj(own(d, k))) return { error: `That backup is damaged (${k} is not an object)` };
  }

  /* No prototype, so a polluted Object.prototype cannot make `c.favorites` look present. */
  const clean = Object.create(null);
  if (present('favorites')) clean.favorites = cleanIds(own(d, 'favorites'), LIMITS.species);
  if (present('caught'))    clean.caught = cleanIds(own(d, 'caught'), LIMITS.species);
  if (present('compare'))   clean.compare = cleanIds(own(d, 'compare'), LIMITS.pokemon).slice(0, 2);
  const teams = present('teams') ? sanitizeTeams(own(d, 'teams')) : null;
  if (teams && teams.length) {
    clean.teams = teams;
    clean.activeTeam = clampTeamIndex(own(d, 'activeTeam'), teams.length);
  }
  if (present('game')) clean.game = sanitizeGame(own(d, 'game'));
  const theme = own(own(d, 'settings'), 'theme'), shiny = own(own(d, 'settings'), 'shiny');
  if (theme === 'light' || theme === 'dark') clean.theme = theme;
  if (typeof shiny === 'boolean') clean.shiny = shiny;
  return { clean };
}

function paintShinyButton() {
  $('shinyButton').setAttribute('aria-pressed', String(state.shiny));
  $('shinyButton').classList.toggle('on', state.shiny);
}

function importData(file) {
  if (file.size > IMPORT_MAX_BYTES) { toast('That file is too large to be an AtlasDex backup'); return; }
  const reader = new FileReader();
  reader.onerror = () => toast('Could not read that file');
  reader.onload = () => {
    let d;
    try { d = JSON.parse(reader.result); } catch { toast('That file is not valid JSON'); return; }
    const { clean: c, error } = sanitizeBackup(d);
    if (error) { toast(error); return; }
    if (!confirm('Replace your current favorites, living dex and teams with this backup?')) return;

    if (c.favorites) { state.favorites = new Set(c.favorites); store('atlasdex:favorites', c.favorites); }
    if (c.caught)    { state.caught = new Set(c.caught); store('atlasdex:caught', c.caught); }
    if (c.teams) {
      state.teams = c.teams; state.activeTeam = c.activeTeam;
      state.teamFailed.clear();
      saveTeams();
    }
    if (c.compare)   { state.compare = c.compare; store('atlasdex:compare', c.compare); }
    if (c.game)      { state.gameStats = c.game; store('atlasdex:game', c.game); }
    if (c.theme) {
      state.theme = c.theme;
      document.body.classList.toggle('light', state.theme === 'light');
      store('atlasdex:theme', state.theme);
    }
    if (typeof c.shiny === 'boolean') {
      state.shiny = c.shiny;
      store('atlasdex:shiny', state.shiny);
      paintShinyButton();
    }
    syncCounts();
    toast('Backup restored');
    route();
  };
  reader.readAsText(file);
}

/* Pokémon Showdown team format, built from each member's full loadout. */
const SHOWDOWN_STAT = {
  hp: 'HP', attack: 'Atk', defense: 'Def',
  'special-attack': 'SpA', 'special-defense': 'SpD', speed: 'Spe'
};

function showdownExport() {
  const t = state.teams[activeIdx()];
  if (!t?.members.length) { toast('This team is empty'); return; }

  const text = t.members.map(m => {
    const name = title(pokeName(m.id));
    const lines = [m.item ? `${name} @ ${title(m.item)}` : name];
    if (m.ability) lines.push(`Ability: ${title(m.ability)}`);
    if (m.level !== 100) lines.push(`Level: ${m.level}`);

    const evs = STAT_KEYS.filter(k => m.evs[k] > 0).map(k => `${m.evs[k]} ${SHOWDOWN_STAT[k]}`);
    if (evs.length) lines.push(`EVs: ${evs.join(' / ')}`);

    lines.push(`${title(m.nature)} Nature`);

    /* Showdown only needs IVs that differ from the 31 default. */
    const ivs = STAT_KEYS.filter(k => (m.ivs[k] ?? 31) !== 31).map(k => `${m.ivs[k]} ${SHOWDOWN_STAT[k]}`);
    if (ivs.length) lines.push(`IVs: ${ivs.join(' / ')}`);

    for (const mv of m.moves.filter(Boolean)) lines.push(`- ${title(mv)}`);
    return lines.join('\n');
  }).join('\n\n');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Showdown team copied')).catch(() => toast('Could not copy'));
  } else toast('Clipboard unavailable');
}

/* ------------------------------------------------------------------ */
/* ROUTING                                                             */
/* ------------------------------------------------------------------ */

function route() {
  const hash = location.hash;

  if (hash.startsWith('#/pokemon/')) {
    const id = Number(hash.split('/')[2]);
    if (!state.list.length) return;
    /* A hand-edited id that is not a real species falls through to the home view
       instead of leaving the page blank. */
    if (Number.isInteger(id) && id >= 1 && id <= state.list.length) { openPokemon(id); return; }
  }
  const ent = hash.match(/^#\/(move|ability|item)\/(.+)$/);
  if (ent) {
    /* The name goes straight into an API path, and a hand-edited or shared link
       can say anything (including a malformed %-escape, which would throw). */
    let name = '';
    try { name = decodeURIComponent(ent[2]); } catch {}
    if (SLUG.test(name)) { if (state.list.length) openEntity(ent[1], name); return; }
  }

  if (state.modalId || state.entity || !$('overlay').hidden) closeModal();

  if (hash === '#/moves')     { state.mode = 'move';    state.browse = { ...state.browse, search: '', shown: 48 }; renderBrowse('move'); return; }
  if (hash === '#/abilities') { state.mode = 'ability'; state.browse = { ...state.browse, search: '', shown: 48 }; renderBrowse('ability'); return; }
  if (hash === '#/items')     { state.mode = 'item';    state.browse = { ...state.browse, search: '', shown: 48 }; renderBrowse('item'); return; }
  if (hash === '#/calc')      { state.mode = 'calc'; renderCalculators(); return; }

  if (hash === '#/favorites')      { state.mode = 'favorites'; state.shown = 36; render(); }
  else if (hash === '#/team')      { state.mode = 'team'; renderTeam(); }
  else if (hash === '#/progress')  { state.mode = 'progress'; renderProgress(); }
  else if (hash === '#/matchups')  { state.mode = 'matchups'; renderMatchups(); }
  else if (hash === '#/offline')   { state.mode = 'offline'; renderOffline(); }
  else if (hash === '#/game')      { state.mode = 'game'; renderGame(); }
  else if (hash === '#/compare')   { state.mode = 'compare'; openComparison(); }
  else                             { state.mode = 'all'; state.shown = 36; render(); }
}

/* ------------------------------------------------------------------ */
/* INIT                                                                */
/* ------------------------------------------------------------------ */

async function init() {
  migrateTeams();
  sanitizeLoadedState();
  document.body.classList.toggle('light', state.theme === 'light');
  paintShinyButton();

  TYPES.forEach(t => $('typeFilter').insertAdjacentHTML('beforeend',
    `<option value="${t}">${title(t)}</option>`));

  for (let g = 1; g <= 9; g++) {
    $('genFilter').insertAdjacentHTML('beforeend', `<option value="${g}">Generation ${g}</option>`);
    $('sideGens').insertAdjacentHTML('beforeend',
      `<button class="genitem" data-gen="${g}"><span>${String(g).padStart(2, '0')}</span> Generation ${ROMAN[g - 1]}</button>`);
  }

  $('grid').innerHTML = Array.from({ length: 12 }, () => '<div class="skeleton"></div>').join('');

  try {
    const data = await get(`${API}/pokemon-species?limit=20000`);
    state.list = data.results.map(x => ({ name: x.name, id: idOf(x.url) }))
      .filter(x => x.id > 0).sort((a, b) => a.id - b.id);
    $('totalStat').textContent = state.list.length.toLocaleString();
    route();
  } catch {
    $('grid').innerHTML = `<div class="empty"><strong>Pokédex is temporarily unavailable</strong>
      We couldn’t connect to PokéAPI.<br><button class="errorbutton" id="retryInit">Try again</button></div>`;
    $('status').textContent = 'Unable to load Pokémon data';
    $('retryInit').addEventListener('click', init);
  }
}

async function setType(type) {
  state.type = type; state.shown = 36;
  if (type && !state.types.has(type)) {
    $('status').textContent = 'Loading type filter…';
    try {
      const d = await get(`${API}/type/${type}`);
      state.types.set(type, new Set(d.pokemon.map(x => idOf(x.pokemon.url))));
    } catch {
      toast('Type filter unavailable. Try again.');
      state.type = ''; $('typeFilter').value = '';
    }
  }
  render();
}

function setChip(chip) {
  state.chip = state.chip === chip ? '' : chip;
  state.shown = 36;
  render();
}

/* ------------------------------------------------------------------ */
/* EVENTS                                                              */
/* ------------------------------------------------------------------ */

$('searchInput').addEventListener('input', e => {
  state.search = e.target.value.trim().toLowerCase(); state.shown = 36; render();
});
$('typeFilter').addEventListener('change', e => setType(e.target.value));
$('genFilter').addEventListener('change', e => { state.gen = e.target.value; state.shown = 36; render(); });
$('sortFilter').addEventListener('change', e => { state.sort = e.target.value; state.shown = 36; render(); });
$('clearFilters').addEventListener('click', reset);
$('loadMore').addEventListener('click', () => { state.shown += 36; render(); });
$('randomButton').addEventListener('click', () => {
  if (state.list.length) openPokemon(state.list[Math.floor(Math.random() * state.list.length)].id);
});
$('themeButton').addEventListener('click', () => {
  document.body.classList.toggle('light');
  state.theme = document.body.classList.contains('light') ? 'light' : 'dark';
  store('atlasdex:theme', state.theme);
});
$('shinyButton').addEventListener('click', e => {
  state.shiny = !state.shiny;
  store('atlasdex:shiny', state.shiny);
  e.currentTarget.classList.toggle('on', state.shiny);
  e.currentTarget.setAttribute('aria-pressed', String(state.shiny));
  toast(state.shiny ? 'Showing shiny artwork ✦' : 'Showing standard artwork');
  if (state.modalId) showTab(); else route();
});
$('closeModal').addEventListener('click', closeModal);
$('overlay').addEventListener('click', e => { if (e.target === $('overlay')) closeModal(); });
$('palette').addEventListener('click', e => { if (e.target === $('palette')) closePalette(); });
$('paletteButton').addEventListener('click', openPalette);

/* Delegated input handling for dynamically rendered controls. */
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'paletteInput') { state.palette.q = t.value; state.palette.sel = 0; paintPalette(); return; }
  if (t.id === 'brSearch') {
    state.browse.search = t.value.trim().toLowerCase();
    state.browse.shown = 48;
    clearTimeout(state.browseTimer);
    state.browseTimer = setTimeout(() => renderBrowse(state.browse.kind), 180);
    return;
  }
  if (state.editing != null && handleLoadoutEdit(t)) return;

  const calc = t.closest('[data-calc]');
  if (calc) {
    const key = calc.dataset.calc;
    state.calc[key] = calc.type === 'checkbox' ? calc.checked
      : calc.type === 'number' ? Number(calc.value) : calc.value;
    /* The modal wins: it can be open over any view, including the calculators. */
    if (state.modalId) showTab(); else if (state.mode === 'calc') renderCalculators();
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (state.editing != null && handleLoadoutEdit(t)) return;
  if (t.id === 'brFilter') { state.browse.filter = t.value; state.browse.shown = 48; renderBrowse(state.browse.kind); return; }
  if (t.id === 'brSort')   { state.browse.sort = t.value; renderBrowse(state.browse.kind); return; }
  if (t.id === 'importFile' && t.files?.[0]) { importData(t.files[0]); t.value = ''; return; }
  const calc = t.closest('[data-calc]');
  if (calc && (calc.tagName === 'SELECT' || calc.type === 'checkbox')) {
    state.calc[calc.dataset.calc] = calc.type === 'checkbox' ? calc.checked : calc.value;
    /* The modal wins: it can be open over any view, including the calculators. */
    if (state.modalId) showTab(); else if (state.mode === 'calc') renderCalculators();
  }
});

document.addEventListener('keydown', e => {
  /* Command palette */
  if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
    e.preventDefault(); state.palette.open ? closePalette() : openPalette(); return;
  }
  if (state.palette.open) {
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
    const rows = state.palette.rows || [];
    if (e.key === 'ArrowDown') { e.preventDefault(); state.palette.sel = Math.min(rows.length - 1, state.palette.sel + 1); paintPalette(); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); state.palette.sel = Math.max(0, state.palette.sel - 1); paintPalette(); return; }
    if (e.key === 'Enter')     { e.preventDefault(); runPalette(state.palette.sel); return; }
    return;
  }
  if (e.key === 'Escape' && !$('overlay').hidden) closeModal();
  if (e.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) {
    e.preventDefault(); $('searchInput').focus();
  }
  if (state.modalId && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)
      && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const next = state.modalId + (e.key === 'ArrowRight' ? 1 : -1);
    if (next >= 1 && next <= state.list.length) openPokemon(next);
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.poke-card')) {
    e.preventDefault(); openPokemon(Number(e.target.dataset.open));
  }
});

document.addEventListener('click', e => {
  const hit = sel => e.target.closest(sel);

  const fav = hit('[data-fav]');       if (fav) { e.stopPropagation(); favorite(Number(fav.dataset.fav)); return; }
  const cat = hit('[data-catch]');     if (cat) { e.stopPropagation(); markCaught(Number(cat.dataset.catch)); return; }
  const tm  = hit('[data-team]');      if (tm)  { e.stopPropagation(); addToTeam(Number(tm.dataset.team)); return; }
  const cmp = hit('[data-compare]');   if (cmp) { e.stopPropagation(); compare(Number(cmp.dataset.compare)); return; }

  const tab = hit('[data-tab]');       if (tab) { state.tab = tab.dataset.tab; state.moveShown = 30; showTab(); return; }
  const mth = hit('[data-method]');    if (mth) { state.moveMethod = mth.dataset.method; state.moveShown = 30; showTab(); return; }
  const mm  = hit('[data-moremoves]'); if (mm)  { state.moveShown += 30; showTab(); return; }

  const pick = hit('.tp');
  if (pick) {
    const key = pick.closest('[data-picker]').dataset.picker;
    state[key] = pick.dataset.val;
    if (key === 'def1' && state.def1 === state.def2) state.def2 = '';
    renderMatchups();
    return;
  }

  const form = hit('[data-form]');     if (form) { switchForm(Number(form.dataset.form)); return; }

  const edit = hit('[data-edit]');     if (edit) { openMemberEditor(Number(edit.dataset.edit)); return; }
  if (hit('[data-ldclose]')) { closeModal(); renderTeam(); return; }
  const spread = hit('[data-ldspread]'); if (spread) { applySpread(spread.dataset.ldspread); return; }
  if (hit('[data-ldreset]')) {
    const m = findMember(state.editing);
    if (m) { m.evs = blankSpread(0); saveTeams(); paintMemberEditor(); }
    return;
  }

  const pal = hit('[data-pal]');       if (pal) { runPalette(Number(pal.dataset.pal)); return; }

  const ent = hit('[data-entity]');
  if (ent) { const [k, ...r] = ent.dataset.entity.split(':'); openEntity(k, r.join(':')); return; }
  const byName = hit('[data-openname]'); if (byName) { openByName(byName.dataset.openname); return; }

  if (hit('[data-browsemore]')) { state.browse.shown += 48; renderBrowse(state.browse.kind); return; }
  const la = hit('[data-loadall]'); if (la) { loadAllOf(la.dataset.loadall); return; }

  const ctab = hit('[data-calctab]'); if (ctab) { state.calcTab = ctab.dataset.calctab; renderCalculators(); return; }

  /* Retry forgets which members failed, then renderTeam() tries each once more. */
  if (hit('[data-teamretry]')) { state.teamFailed.clear(); renderTeam(); return; }
  const tsel = hit('[data-teamsel]');
  if (tsel) { state.activeTeam = clampTeamIndex(Number(tsel.dataset.teamsel), state.teams.length); saveTeams(); renderTeam(); return; }
  if (hit('[data-teamnew]')) {
    if (state.teams.length >= 8) { toast('Maximum of 8 teams'); return; }
    state.teams.push({ name: 'Team ' + (state.teams.length + 1), members: [] });
    state.activeTeam = state.teams.length - 1; saveTeams(); renderTeam(); return;
  }
  if (hit('[data-teamrename]')) {
    const team = state.teams[activeIdx()];
    const name = prompt('Team name:', team.name);
    if (name && name.trim()) { team.name = name.trim().slice(0, 24); saveTeams(); renderTeam(); }
    return;
  }
  if (hit('[data-teamdel]')) {
    if (state.teams.length < 2) return;
    const at = activeIdx();
    if (!confirm(`Delete "${state.teams[at].name}"?`)) return;
    state.teams.splice(at, 1);
    state.activeTeam = Math.max(0, at - 1);
    saveTeams(); renderTeam(); toast('Team deleted'); return;
  }
  if (hit('[data-showdown]')) { showdownExport(); return; }
  if (hit('[data-export]'))   { exportData(); return; }
  if (hit('[data-import]'))   { $('importFile').click(); return; }

  if (hit('[data-dlstart]')) { startDownload(); renderOffline(); return; }
  if (hit('[data-dlstop]'))  { state.dl.stop = true; toast('Pausing…'); return; }
  if (hit('[data-dlclear]')) {
    if (confirm('Clear all cached Pokémon data from this device?')) {
      idbClear().then(() => { toast('Cached data cleared'); renderOffline(); });
    }
    return;
  }

  const gstart = hit('[data-game]');   if (gstart) { startGame(gstart.dataset.game); return; }
  const guess  = hit('[data-guess]');  if (guess)  { answerGame(Number(guess.dataset.guess)); return; }
  if (hit('[data-gamenext]')) { nextGame(); return; }
  if (hit('[data-gamemenu]')) { state.game = null; renderGame(); return; }
  if (hit('[data-share]'))    { shareResult(); return; }
  const ggen = hit('[data-gamegen]');  if (ggen) { state.gameGen = ggen.dataset.gamegen; renderGame(); return; }

  const chip = hit('[data-chip]');     if (chip) { setChip(chip.dataset.chip); return; }
  const retry = hit('[data-retry]');   if (retry) { openPokemon(Number(retry.dataset.retry)); return; }

  if (hit('[data-clear-compare]')) {
    state.compare = []; store('atlasdex:compare', []); closeModal(); syncCounts(); toast('Comparison cleared'); return;
  }
  if (hit('[data-clear-team]')) {
    state.team = []; saveTeams(); renderTeam(); toast('Team cleared'); return;
  }
  if (hit('[data-clear-caught]')) {
    if (confirm('Reset your living dex progress? This cannot be undone.')) {
      state.caught = new Set(); store('atlasdex:caught', []); renderProgress(); toast('Progress reset');
    }
    return;
  }
  const chipgo = hit('[data-chipgo]'); if (chipgo) { state.chip = chipgo.dataset.chipgo; return; }

  const cry = hit('[data-cry]');
  if (cry) {
    const p = state.details.get(Number(cry.dataset.cry));
    const url = p?.cries?.latest || p?.cries?.legacy;
    if (url) new Audio(url).play().catch(() => toast('Audio could not play'));
    else toast('No cry available');
    return;
  }

  const open = hit('[data-open]');     if (open) { openPokemon(Number(open.dataset.open)); return; }
  if (hit('[data-reset]')) { reset(); return; }

  const gen = hit('[data-gen]');
  if (gen) {
    state.gen = gen.dataset.gen;
    $('genFilter').value = state.gen;
    state.mode = 'all';
    state.shown = 36;
    if (location.hash !== '#/') location.hash = '#/';
    else render();
  }
});

window.addEventListener('online',  () => { toast('Back online'); if (state.mode === 'offline') renderOffline(); });
window.addEventListener('offline', () => {
  toast('Offline — showing data saved on this device');
  if (state.mode === 'offline') renderOffline();
});

window.addEventListener('hashchange', route);
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
init();
})();
