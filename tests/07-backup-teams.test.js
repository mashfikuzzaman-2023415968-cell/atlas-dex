/* Backup import and stored-data validation, escaping of API/user values,
   activeTeam robustness, the Team Builder's single-attempt loading, and a check
   that the test harness itself can fail.

   Windows here run with runScripts "dangerously" so inline event handlers
   really execute: a payload that slips into an attribute would set
   window.__pwned, and the suite fails.                                      */

const fs = require('fs'), os = require('os'), path = require('path');
const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const { JSDOM } = require('jsdom');
const { waitFor, trackErrors, finish, crash } = require('./harness');

const dir = path.resolve(__dirname, '..');
const html = fs.readFileSync(dir + '/index.html', 'utf8');
const appjs = fs.readFileSync(dir + '/app.js', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fail = 0;
const ok = (l, c) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) fail++; };
const norm = v => (v === undefined ? '<undefined>' : JSON.parse(JSON.stringify(v)));
const same = (a, b) => {
  try { assert.deepStrictEqual(norm(a), norm(b)); return true; } catch { return false; }
};
const eq = (l, got, want) => ok(l + (same(got, want) ? '' : `  [got ${JSON.stringify(got)?.slice(0, 400)}  want ${JSON.stringify(want)?.slice(0, 400)}]`), same(got, want));

/* ------------------------------------------------------------------ */
/* Fixture: a mocked PokéAPI and a window factory                      */
/* ------------------------------------------------------------------ */

const SPECIES = 30;
const H = '<img src=x onerror=window.__pwned=1>';   // hostile API value
const TY = ['fire', 'water', 'grass', 'electric', 'flying', 'steel', 'ghost', 'dragon'];

const mkPoke = (id, hostile) => ({
  id, name: 'mon' + id, height: 10, weight: 100, base_experience: 60,
  species: { url: '/pokemon-species/' + (id > 10000 ? 26 : id) + '/' },
  types: [TY[id % 8], TY[(id + 3) % 8]].map(t => ({ type: { name: t } })),
  /* HP varies with the id so team averages differ from one member set to the next. */
  stats: [['hp', 60 + (id * 37) % 50], ['attack', 80], ['defense', 70], ['special-attack', 90], ['special-defense', 75], ['speed', 100]]
    .map(([n, v]) => ({ base_stat: v, effort: 0, stat: { name: n } })),
  abilities: [{ ability: { name: hostile ? H : 'blaze' }, is_hidden: false }],
  moves: ['ember', 'surf'].map(n => ({ move: { name: n }, version_group_details: [{ level_learned_at: 5, move_learn_method: { name: 'level-up' } }] })),
  sprites: { other: { 'official-artwork': { front_default: 'x.png', front_shiny: 's.png' } } }, cries: { latest: 'c.ogg' }
});
const bst = id => mkPoke(id).stats.reduce((t, x) => t + x.base_stat, 0);

function makeFetch(env) {
  const res = (data, ok = true, status = 200) => ({ ok, status, json: async () => data });
  return async url => {
    env.calls.push(url);
    /* Like a real network, answer on a later macrotask. A mock that settles in the
       same microtask run would let a request loop starve the timers and hang the suite
       instead of failing it. */
    await new Promise(r => setTimeout(r, 1));
    let m;
    if (url.includes('pokemon-species?')) return res({ results: Array.from({ length: SPECIES }, (_, i) => ({ name: 'mon' + (i + 1), url: '/pokemon-species/' + (i + 1) + '/' })) });
    if (url.includes('/move?limit')) return res({ results: ['ember', 'surf'].map((n, i) => ({ name: n, url: '/move/' + (i + 1) + '/' })) });
    if (url.includes('/ability?limit')) return res({ results: [{ name: 'blaze', url: '/ability/1/' }] });
    if (url.includes('/item?limit')) return res({ results: ['leftovers', 'life-orb'].map((n, i) => ({ name: n, url: '/item/' + (i + 1) + '/' })) });
    if (url.includes('/encounters')) return res([]);
    if ((m = url.match(/\/pokemon\/(\d+)$/))) {
      const id = +m[1];
      if (env.delayMs) await new Promise(r => setTimeout(r, env.delayMs));
      if (env.failIds.has('*') || env.failIds.has(id)) {
        if (env.failMode === 'throw') throw new TypeError('Failed to fetch');
        return res({}, false, 503);
      }
      if (!(id >= 1 && id <= SPECIES) && id !== 10100) return res({}, false, 404);   // an id PokéAPI does not have
      const p = mkPoke(id, env.hostile);
      if (env.types[id]) p.types = env.types[id].map(t => ({ type: { name: t } }));
      return res(p);
    }
    if ((m = url.match(/\/pokemon-species\/(\d+)$/))) {
      const sid = +m[1], f = env.hostile ? H : null;
      return res({ name: 'mon' + sid, id: sid, gender_rate: 4, capture_rate: 45, hatch_counter: 20, base_happiness: 50,
        egg_groups: [{ name: f || 'monster' }], growth_rate: { name: f || 'medium-slow' }, habitat: { name: f || 'forest' }, shape: { name: f || 'upright' },
        varieties: [{ is_default: true, pokemon: { name: 'mon' + sid, url: '/pokemon/' + sid + '/' } }],
        is_legendary: false, is_mythical: false, is_baby: false,
        flavor_text_entries: [{ language: { name: 'en' }, flavor_text: 'A test mon.' }],
        genera: [{ language: { name: 'en' }, genus: 'Test' }], evolution_chain: { url: '/evolution-chain/1/' } });
    }
    if (url.includes('/evolution-chain/')) return res({ chain: { species: { name: 'mon1', url: '/pokemon-species/1/' }, evolves_to: [] } });
    if ((m = url.match(/\/move\/([^/]+)$/))) return res({ name: m[1], power: 90, accuracy: 100, pp: 15, priority: 0, type: { name: 'fire' },
      damage_class: { name: env.dmgClass || (env.hostile ? H : 'special') }, effect_entries: [{ language: { name: 'en' }, short_effect: 'x' }], learned_by_pokemon: [] });
    if ((m = url.match(/\/ability\/([^/]+)$/))) return res({ name: m[1], effect_entries: [{ language: { name: 'en' }, short_effect: 'x' }], pokemon: [] });
    if ((m = url.match(/\/item\/([^/]+)$/))) return res({ name: m[1], cost: 200, category: { name: env.hostile ? H : 'held' }, sprites: { default: 'i.png' },
      effect_entries: [{ language: { name: 'en' }, short_effect: 'x' }], held_by_pokemon: [] });
    if (url.includes('/egg-group/')) return res({ pokemon_species: [{ name: 'mon1' }] });
    return res({});
  };
}

const allErrs = [];

/* opts: hash, seed (JSON-encoded into localStorage), seedRaw (stored verbatim),
   failIds (Set-like of ids or '*'), failMode ('http' | 'throw'), hostile,
   types ({id: [type names]} overrides), dmgClass (damage class for every move) */
async function boot(opts = {}) {
  const env = { calls: [], failIds: new Set(opts.failIds || []), failMode: opts.failMode || 'http', hostile: !!opts.hostile,
    confirms: 0, copied: null, blob: null, downloaded: false, promptValue: 'Renamed', delayMs: 0,
    types: opts.types || {}, dmgClass: opts.dmgClass || null };
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/' + (opts.hash || ''), pretendToBeVisual: true });
  const w = dom.window;
  env.w = w; env.d = w.document; env.$ = id => w.document.getElementById(id);
  w.fetch = makeFetch(env);
  w.Audio = function () { return { play: async () => {} }; };
  w.confirm = () => { env.confirms++; return true; };
  w.prompt = () => env.promptValue;
  w.CSS = { escape: s => s.replace(/[^a-zA-Z0-9_-]/g, '\\$&') };
  w.URL.createObjectURL = blob => { env.blob = blob; return 'blob:x'; };
  w.URL.revokeObjectURL = () => {};
  w.navigator.clipboard = { writeText: async t => { env.copied = t; } };
  const origCreate = w.document.createElement.bind(w.document);
  w.document.createElement = tag => { const el = origCreate(tag); if (tag === 'a') el.click = () => { env.downloaded = true; }; return el; };
  w.localStorage.clear();
  for (const [k, v] of Object.entries(opts.seed || {})) w.localStorage.setItem(k, JSON.stringify(v));
  for (const [k, v] of Object.entries(opts.seedRaw || {})) w.localStorage.setItem(k, v);
  trackErrors(w, allErrs);
  w.eval(appjs);

  env.click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  env.chg = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  env.stored = k => { const raw = w.localStorage.getItem(k); return raw === null ? undefined : JSON.parse(raw); };
  env.snapshot = () => { const o = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; };
  env.ready = () => waitFor(() => env.$('totalStat').textContent === String(SPECIES), 20000);
  env.pokeCalls = id => env.calls.filter(u => u.endsWith('/pokemon/' + id)).length;
  env.allPokeCalls = () => env.calls.filter(u => /\/pokemon\/\d+$/.test(u)).length;
  env.go = async (hash, cond) => { w.location.hash = hash; await waitFor(cond, 20000); };
  await env.ready();
  return env;
}

/* Push a backup through the real file input's change handler. Resolves to the toast text. */
async function importText(env, text) {
  const { w, $ } = env;
  const file = new w.File([text], 'backup.json', { type: 'application/json' });
  const input = $('importFile');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  $('toast').textContent = '';
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  await waitFor(() => $('toast').textContent !== '', 20000);
  return $('toast').textContent;
}
const importObj = (env, obj) => importText(env, JSON.stringify(obj));

/* What a view may contain: no inline script, no event handler other than art()'s
   own onerror, no autofocus/srcdoc, numeric ids in data-* actions, known image sources. */
/* The game's silhouette has a second fixed shape: a constant, name-free SVG data URI. */
const MYSTERY_HANDLER = /^this\.onerror=function\(\)\{this\.onerror=null;this\.src='data:image\/svg\+xml,[A-Za-z0-9%_.~!*()-]*'\};this\.src='https:\/\/raw\.githubusercontent\.com\/PokeAPI\/sprites\/master\/sprites\/pokemon\/(shiny\/)?\d+\.png'$/;
const ART_HANDLER = /^this\.onerror=null;this\.src='https:\/\/raw\.githubusercontent\.com\/PokeAPI\/sprites\/master\/sprites\/pokemon\/(shiny\/)?\d+\.png'$/;
const ART_SRC = /^https:\/\/raw\.githubusercontent\.com\/PokeAPI\/sprites\/master\/sprites\/pokemon\/(other\/official-artwork\/)?(shiny\/)?\d+\.png$/;
const NUMERIC_DATA = ['data-open', 'data-team', 'data-edit', 'data-catch', 'data-fav', 'data-compare', 'data-cry', 'data-form', 'data-guess', 'data-retry', 'data-gen', 'data-teamsel'];
function audit(env) {
  const bad = [];
  for (const el of env.d.body.querySelectorAll('*')) {
    if (el.tagName === 'SCRIPT' && !el.getAttribute('src')) bad.push('inline <script>');
    for (const a of el.attributes) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') && !(el.tagName === 'IMG' && n === 'onerror' && (ART_HANDLER.test(a.value) || MYSTERY_HANDLER.test(a.value)))) bad.push(`${el.tagName} ${n}="${a.value.slice(0, 60)}"`);
      if (n === 'autofocus' || n === 'srcdoc' || n === 'formaction') bad.push(`${el.tagName} ${n}`);
      if (NUMERIC_DATA.includes(n) && !/^\d+$/.test(a.value)) bad.push(`${n}="${a.value.slice(0, 60)}"`);
    }
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src') || '';
      if (!ART_SRC.test(src) && !['x.png', 's.png', 'i.png'].includes(src)) bad.push('img src=' + src.slice(0, 80));
    }
  }
  return bad;
}
/* Fire every inline handler that exists (error, load, ...) so a smuggled one would run. */
function fireInlineHandlers(env) {
  for (const el of env.d.querySelectorAll('*')) {
    for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.dispatchEvent(new env.w.Event(a.name.slice(2).toLowerCase()));
  }
}

/* True when no stored value carries payload text. Team names are free text and may
   legitimately contain such characters (they are always escaped on output), so they are blanked first. */
const PAYLOAD_RE = /__pwned|<img|onerror|autofocus|polluted/;
function storageIsClean(env) {
  const snap = env.snapshot();
  const teams = env.stored('atlasdex:teams');
  if (teams) snap['atlasdex:teams'] = JSON.stringify(teams.map(t => ({ ...t, name: '' })));
  return !PAYLOAD_RE.test(JSON.stringify(snap));
}

const VIEWS = env => {
  const { d, $ } = env;
  return [
    ['#/', () => d.querySelectorAll('.poke-card').length > 0 && !$('listSection').hidden],
    ['#/favorites', () => /Favorites/.test($('heading').textContent)],
    ['#/team', () => $('crumb').textContent === 'TEAM BUILDER' && !$('panel').innerHTML.includes('Analyzing')],
    ['#/progress', () => d.querySelectorAll('.genbar').length === 9],
    ['#/game', () => d.querySelectorAll('.gamecard').length === 2],
    ['#/matchups', () => !!d.querySelector('.result-card strong')],
    ['#/offline', () => $('panel').innerHTML.includes('Offline Dex')],
    ['#/calc', () => d.querySelectorAll('[data-calctab]').length === 6],
    ['#/moves', () => d.querySelectorAll('.dexrow[data-entity]').length > 0],
    ['#/abilities', () => d.querySelectorAll('.dexrow.ability[data-entity]').length > 0],
    ['#/items', () => d.querySelectorAll('.dexrow.item[data-entity]').length > 0]
  ];
};

/* Visit every view, the calculators, the game, a detail modal and the loadout
   editor, then fire inline handlers. Returns the problems found. */
async function exerciseEverything(env) {
  const { d, $, w } = env;
  const problems = [];
  const notes = [];
  for (const [hash, cond] of VIEWS(env)) {
    w.location.hash = hash;
    if (!await waitFor(cond, 20000)) notes.push('view did not render: ' + hash);
    await sleep(30);
    problems.push(...audit(env));
  }
  for (const tab of ['stats', 'team-damage', 'damage', 'catch', 'breeding', 'natures']) {
    w.location.hash = '#/calc'; await waitFor(() => d.querySelectorAll('[data-calctab]').length === 6);
    env.click(d.querySelector(`[data-calctab="${tab}"]`)); await sleep(60);
    problems.push(...audit(env));
  }
  w.location.hash = '#/game'; await waitFor(() => d.querySelectorAll('.gamecard').length === 2);
  env.click(d.querySelector('[data-game="daily"]')); await sleep(30);
  problems.push(...audit(env));
  w.location.hash = '#/team'; await waitFor(VIEWS(env)[2][1]);
  const edit = d.querySelector('[data-edit]');
  if (edit) { env.click(edit); await waitFor(() => $('modalContent').innerHTML.includes('LOADOUT'), 20000); problems.push(...audit(env)); env.click($('closeModal')); }
  w.location.hash = '#/pokemon/1'; await waitFor(() => !$('overlay').hidden && $('modalContent').innerHTML.includes('About'), 20000);
  for (const tab of ['overview', 'stats', 'matchups', 'evolution', 'breeding', 'moves', 'encounters']) {
    env.click(d.querySelector(`[data-tab="${tab}"]`)); await sleep(60);
    problems.push(...audit(env));
  }
  env.click($('closeModal'));
  w.location.hash = '#/compare'; await waitFor(() => $('modalContent').innerHTML.includes('Head-to-head') || $('modalContent').innerHTML.includes('Comparison unavailable'), 20000);
  problems.push(...audit(env));
  fireInlineHandlers(env);
  return { problems: [...new Set(problems)], notes };
}

/* ------------------------------------------------------------------ */
/* Payloads                                                            */
/* ------------------------------------------------------------------ */

const P = '"><img src=x onerror=window.__pwned=1>';
const P2 = '" autofocus onfocus="window.__pwned=1" data-x="';
/* Own "__proto__" / "constructor" keys, which only JSON.parse (and spread) create. */
const PROTO = JSON.parse('{"__proto__":{"polluted":"proto"},"constructor":{"prototype":{"polluted":"ctor"}},"prototype":{"polluted":"proto2"}}');
const blank = v => ({ hp: v, attack: v, defense: v, 'special-attack': v, 'special-defense': v, speed: v });
const member = (id, over = {}) => ({ id, level: 50, nature: 'hardy', ability: null, item: '', ivs: blank(31), evs: blank(0), moves: [], ...over });

const EVIL_BACKUP = {
  app: 'AtlasDex', version: 4, exported: P, evil: P, ...PROTO,
  favorites: [P, 5, 5, '7', -1, 0, 20001, 1.5, null, {}, [], 20000, 1, true],
  caught: [3, 3, P, 99999, 2],
  compare: [P, 25, 25, 10100, 26],
  teams: [
    { name: '   ' + P + '  and a name far longer than twenty-four characters', evil: P, ...PROTO, members: [
      { id: 25, level: 101, nature: P, ability: P, item: P, evil: P, ...PROTO,
        ivs: { hp: 99, attack: '<b>', defense: -1, 'special-attack': 5.5, 'special-defense': 0, speed: 31, evil: P, ...PROTO },
        evs: { hp: 253, attack: 252, defense: 'x', evil: 1, ...PROTO },
        moves: [P, 'ember', 'ember', 'surf', 'bad move', 'tackle', 'flamethrower', 'ice-beam'] },
      { id: '26' }, { id: 25 }, { id: P }, { id: P2 }, { id: 0 }, { id: -1 }, { id: 1.5 }, { id: 100001 },
      null, 'str', [], true, { name: 'no id' },
      { id: 10100 }, { id: 100000, item: 'Life Orb', ability: 'flash-fire' }, 4, 1
    ] },
    { members: 'not-an-array' },
    P,
    { name: 123, members: [7] }
  ],
  activeTeam: 99,
  game: { streak: P, best: -5, lastDaily: P, lastScore: 99, lastGrid: P + '🟩x🟥🟩🟩🟩🟩🟩', evil: P, ...PROTO },
  settings: { theme: P, shiny: 'yes', evil: P, ...PROTO }
};
const EVIL_TEAM1_NAME = ('   ' + P + '  and a name far longer than twenty-four characters').trim().slice(0, 24).trim();
const EXPECTED_TEAMS = [
  { name: EVIL_TEAM1_NAME, members: [
    /* special-attack 5.5 is truncated to 5, not reset: older versions saved fractions. */
    member(25, { moves: ['ember', 'surf', 'tackle', 'flamethrower'], ivs: { ...blank(31), 'special-attack': 5, 'special-defense': 0 }, evs: { ...blank(0), attack: 252 } }),
    member(10100),
    member(100000, { item: 'Life Orb', ability: 'flash-fire' }),
    member(4),
    member(1)
  ] },
  { name: 'Team 2', members: [] },
  { name: 'Team 3', members: [member(7)] }
];
const EXPECTED_GAME = { streak: 0, best: 0, lastDaily: null, lastScore: null, lastGrid: '🟩🟥🟩🟩🟩' };

/* ------------------------------------------------------------------ */

(async () => {
  console.log('--- 1.2  IMPORT: REJECTIONS CHANGE NOTHING ---');
  {
    const e = await boot();
    const seedState = { favorites: [5], caught: [6], teams: [{ name: 'Keep', members: [member(25)] }], activeTeam: 0, compare: [1],
      game: { streak: 3, best: 4, lastDaily: null, lastScore: null, lastGrid: '' } };
    ok('baseline import works', await importObj(e, { app: 'AtlasDex', ...seedState }) === 'Backup restored');
    const base = e.snapshot();
    const cases = [
      ['malformed JSON', '{not json', 'That file is not valid JSON'],
      ['empty file', '', 'That file is not valid JSON'],
      ['JSON array at the top level', '[1,2,3]', 'That is not an AtlasDex backup'],
      ['JSON null', 'null', 'That is not an AtlasDex backup'],
      ['JSON number', '42', 'That is not an AtlasDex backup'],
      ['wrong app name', JSON.stringify({ app: 'Other', favorites: [1] }), 'That is not an AtlasDex backup'],
      ['no app name', JSON.stringify({ favorites: [1] }), 'That is not an AtlasDex backup'],
      ['version from the future', JSON.stringify({ app: 'AtlasDex', version: 6, favorites: [1] }), 'That backup was made by a different version of AtlasDex'],
      ['version 0', JSON.stringify({ app: 'AtlasDex', version: 0 }), 'That backup was made by a different version of AtlasDex'],
      ['version as text', JSON.stringify({ app: 'AtlasDex', version: '4' }), 'That backup was made by a different version of AtlasDex'],
      ['fractional version', JSON.stringify({ app: 'AtlasDex', version: 4.5 }), 'That backup was made by a different version of AtlasDex'],
      ['favorites is a string', JSON.stringify({ app: 'AtlasDex', favorites: 'abc' }), 'That backup is damaged (favorites is not a list)'],
      ['caught is an object', JSON.stringify({ app: 'AtlasDex', caught: { 0: 1 } }), 'That backup is damaged (caught is not a list)'],
      ['compare is a number', JSON.stringify({ app: 'AtlasDex', compare: 7 }), 'That backup is damaged (compare is not a list)'],
      ['teams is an object', JSON.stringify({ app: 'AtlasDex', teams: {} }), 'That backup is damaged (teams is not a list)'],
      ['game is an array', JSON.stringify({ app: 'AtlasDex', game: [] }), 'That backup is damaged (game is not an object)'],
      ['settings is a string', JSON.stringify({ app: 'AtlasDex', settings: 'dark' }), 'That backup is damaged (settings is not an object)'],
      ['a valid field next to a damaged one', JSON.stringify({ app: 'AtlasDex', favorites: [1, 2, 3], teams: 'x' }), 'That backup is damaged (teams is not a list)']
    ];
    for (const [label, text, toast] of cases) {
      const before = e.confirms;
      const got = await importText(e, text);
      eq(`rejected: ${label}`, got, toast);
      ok(`  ...and nothing was stored or confirmed (${label})`, same(e.snapshot(), base) && e.confirms === before);
    }
    const tooBig = await importText(e, 'x'.repeat(2 * 1024 * 1024 + 1));
    eq('a file over 2 MB is refused unread', tooBig, 'That file is too large to be an AtlasDex backup');
    ok('  ...and nothing was stored', same(e.snapshot(), base));
    eq('counters still show the baseline', [e.$('favCount').textContent, e.$('caughtCount').textContent, e.$('teamCount').textContent], ['1', '1', '1']);

    // accepted shapes
    for (const [label, doc] of [['no version', {}], ['version 1', { version: 1 }], ['version 3', { version: 3 }], ['version 5', { version: 5 }]]) {
      eq(`accepted: ${label}`, await importObj(e, { app: 'AtlasDex', favorites: [9], ...doc }), 'Backup restored');
    }
    eq('an empty backup (only app) is accepted and changes no stored list', (await importObj(e, { app: 'AtlasDex' }), e.stored('atlasdex:favorites')), [9]);
    eq('null fields are treated as absent', (await importObj(e, { app: 'AtlasDex', favorites: null, teams: null, game: null, settings: null }), e.stored('atlasdex:favorites')), [9]);
    // a declined confirm changes nothing
    e.w.confirm = () => false;
    const keep = e.snapshot();
    const declined = await Promise.race([importObj(e, { app: 'AtlasDex', favorites: [1, 2, 3] }), sleep(600).then(() => 'no toast')]);
    ok('declining the confirm dialog stores nothing', declined === 'no toast' && same(e.snapshot(), keep));
  }

  console.log('\n--- 1.2  IMPORT: HOSTILE BACKUP IS SANITISED, NOTHING RUNS ---');
  {
    const e = await boot();
    const text = JSON.stringify(EVIL_BACKUP);
    ok('payload really carries own __proto__ / constructor keys', text.includes('"__proto__":{"polluted"') && text.includes('"constructor":{"prototype"'));
    eq('hostile backup is accepted (version 4)', await importText(e, text), 'Backup restored');
    eq('favorites: only integers 1..20000, deduped, in order', e.stored('atlasdex:favorites'), [5, 20000, 1]);
    eq('caught: out-of-range ids dropped', e.stored('atlasdex:caught'), [3, 2]);
    eq('compare: at most 2 valid, deduped', e.stored('atlasdex:compare'), [25, 10100]);
    eq('teams: names, members and loadouts rebuilt strictly', e.stored('atlasdex:teams'), EXPECTED_TEAMS);
    eq('activeTeam clamped into range', e.stored('atlasdex:activeTeam'), 2);
    eq('game stats rebuilt', e.stored('atlasdex:game'), EXPECTED_GAME);
    ok('hostile theme was ignored (stored theme untouched)', e.stored('atlasdex:theme') === undefined && !e.d.body.classList.contains('light'));
    ok('non-boolean shiny was ignored', e.stored('atlasdex:shiny') === undefined && e.$('shinyButton').getAttribute('aria-pressed') === 'false');
    ok('no payload text survives in storage (team names aside)', storageIsClean(e));
    ok('prototype not polluted (page realm, test realm, plain objects)',
      e.w.Object.prototype.polluted === undefined && Object.prototype.polluted === undefined && ({}).polluted === undefined && e.w.eval('({}).polluted') === undefined);
    eq('header counters follow the clean data', [e.$('favCount').textContent, e.$('caughtCount').textContent, e.$('compareCount').textContent, e.$('teamCount').textContent], ['3', '2', '2', '1']);
    // the active team is Team 3 (clamped from 99); look at team 1 as well
    const { problems, notes } = await exerciseEverything(e);
    eq('no inline handlers, injected attributes or odd ids in any view', problems, []);
    eq('every view rendered', notes, []);
    ok('no payload script ran (window.__pwned unset)', e.w.__pwned === undefined);
    e.w.location.hash = '#/team'; await waitFor(VIEWS(e)[2][1]);
    e.click(e.d.querySelector('[data-teamsel="0"]')); await waitFor(() => e.d.querySelectorAll('.team-slot:not(.empty)').length > 0);
    const tab0 = e.d.querySelector('[data-teamsel="0"]').textContent;
    ok('hostile team name is shown as text, not markup', tab0.includes('<img src=x') && !e.d.querySelector('[data-teamsel="0"] img'));
    ok('team 1 has the five sanitised members', e.d.querySelectorAll('#panel [data-team]').length === 5);
    fireInlineHandlers(e);
    eq('no injection after switching to the hostile team', audit(e), []);
    ok('still no payload script', e.w.__pwned === undefined);
  }

  console.log('\n--- 1.2  IMPORT: EVERY FIELD RULE, BOUNDARIES AND DEFAULTS ---');
  {
    const e = await boot();
    const a50 = 'a'.repeat(50), x40 = 'x'.repeat(40);
    const rules = { app: 'AtlasDex', teams: [{ name: 'rules', members: [
      { id: 1, level: 1, nature: 'adamant', ability: a50, item: x40, ivs: { ...blank(31), hp: 0 }, evs: { ...blank(0), hp: 252 }, moves: ['a'] },
      { id: 2, level: 100, nature: 'quirky', ability: 'flash-fire', item: 'Life Orb-2', ivs: blank(0), evs: blank(252) },
      { id: 3, level: 0, nature: 'constructor', ability: 'a'.repeat(51), item: 'x'.repeat(41),
        ivs: { hp: 32, attack: -1, defense: '31', 'special-attack': null, 'special-defense': 1.5 }, evs: { hp: 253, attack: 0.5, defense: '4', 'special-attack': -4 } },
      { id: 100000, level: 50.5, nature: '__proto__', ability: 'Has Space', item: 'bad<item>', moves: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { id: 5, level: '50', nature: 5, ability: 5, item: 5, ivs: 'x', evs: [1, 2], moves: 'ember' },
      { id: 6, ability: 'UPPER', moves: ['Ember', 'ok-move', 'ok-move', 'a_b', 'x'.repeat(51), 7, null, 'surf'] },
      { id: 100001 }, { id: '4' }
    ] }] };
    eq('rules import accepted', await importObj(e, rules), 'Backup restored');
    eq('every rule: boundaries kept, anything else falls back to its default', e.stored('atlasdex:teams'), [{ name: 'rules', members: [
      member(1, { level: 1, nature: 'adamant', ability: a50, item: x40, ivs: { ...blank(31), hp: 0 }, evs: { ...blank(0), hp: 252 }, moves: ['a'] }),
      member(2, { level: 100, nature: 'quirky', ability: 'flash-fire', item: 'Life Orb-2', ivs: blank(0), evs: blank(252) }),
      /* Fractions are truncated (older versions saved 1.5 from a typed input),
         an over-long item is cut to 40 characters, everything else defaults. */
      member(3, { item: x40, ivs: { ...blank(31), 'special-defense': 1 } }),
      member(100000, { moves: ['a', 'b', 'c', 'd'] }),
      member(5),
      member(6, { moves: ['ok-move', 'surf'] })
    ] }]);

    // old-format saves: plain numbers, and objects missing newer fields
    eq('old-format numeric members import', await importObj(e, { app: 'AtlasDex', version: 2,
      teams: [{ name: 'Old', members: [25, 6, 'bad', 25, { id: 7 }, { id: 8, level: 0 }] }] }), 'Backup restored');
    eq('numbers become default loadouts, partial objects are completed', e.stored('atlasdex:teams'),
      [{ name: 'Old', members: [member(25), member(6), member(7), member(8)] }]);
    await e.go('#/team', VIEWS(e)[2][1]);
    ok('old-format team renders as four members', e.d.querySelectorAll('.team-slot:not(.empty):not(.failed)').length === 4);
    ok('slots show the default level and nature', e.$('panel').innerHTML.includes('Lv 50 · Hardy'));
    e.click(e.d.querySelector('[data-edit="25"]')); await waitFor(() => e.$('modalContent').innerHTML.includes('LOADOUT'));
    ok('loadout editor works for an imported numeric member', e.d.querySelectorAll('[data-moveslot]').length === 4 && e.d.querySelectorAll('[data-iv]').length === 6);
    e.chg(e.d.querySelector('[data-ld="nature"]'), 'adamant');
    e.chg(e.d.querySelector('[data-ld="item"]'), "King's Rock!");
    e.click(e.d.querySelector('[data-ldclose]')); await waitFor(VIEWS(e)[2][1]);
    eq('editor keeps what the boot sanitiser accepts (nature, item stripped to safe chars, apostrophe kept)',
      [e.stored('atlasdex:teams')[0].members[0].nature, e.stored('atlasdex:teams')[0].members[0].item], ['adamant', "King's Rock"]);
    e.click(e.d.querySelector('[data-showdown]')); await waitFor(() => !!e.copied);
    ok('Showdown export works on the imported team', e.copied.includes("Mon25 @ King's Rock") && e.copied.includes('Adamant Nature') && e.copied.includes('Level: 50') && e.copied.includes('Mon6'));

    // caps
    const many = Array.from({ length: 30000 }, (_, i) => i + 1);
    const repeated = Array(50000).fill(7);
    const teams12 = Array.from({ length: 12 }, (_, i) => ({ name: 'T' + i, members: [i + 1] }));
    const nineMembers = { name: 'x'.repeat(100), members: Array.from({ length: 9 }, (_, i) => i + 1) };
    eq('caps import accepted', await importObj(e, { app: 'AtlasDex', favorites: many, caught: repeated, compare: [1, 2, 3, 4, 5], teams: [nineMembers, { name: '   ', members: [] }, ...teams12] }), 'Backup restored');
    const fav = e.stored('atlasdex:favorites');
    ok('favorites capped at 20000 entries, all in range', fav.length === 20000 && fav[0] === 1 && fav[19999] === 20000);
    eq('50000 repeats of one id dedupe to one', e.stored('atlasdex:caught'), [7]);
    eq('compare capped at two', e.stored('atlasdex:compare'), [1, 2]);
    const capped = e.stored('atlasdex:teams');
    ok('at most 8 teams', capped.length === 8);
    ok('at most 6 members per team', capped[0].members.length === 6 && same(capped[0].members.map(m => m.id), [1, 2, 3, 4, 5, 6]));
    eq('names trimmed to 24 chars, blank name becomes "Team N"', [capped[0].name, capped[1].name], ['x'.repeat(24), 'Team 2']);

    // activeTeam clamping, through the real UI as well
    const three = [{ name: 'A', members: [1] }, { name: 'B', members: [2] }, { name: 'C', members: [3] }];
    for (const [given, want] of [[99, 2], [-3, 0], [1.9, 1], ['x', 0], [null, 0], [2, 2], [0, 0], [1, 1], [1e9, 2], [-0.5, 0]]) {
      await importObj(e, { app: 'AtlasDex', teams: three, activeTeam: given });
      await e.go('#/team', () => e.d.querySelectorAll('.teamtab.on').length === 1);
      const on = e.d.querySelector('.teamtab.on');
      ok(`activeTeam ${JSON.stringify(given)} -> ${want} (stored ${e.stored('atlasdex:activeTeam')}, highlighted tab ${on && on.dataset.teamsel})`,
        e.stored('atlasdex:activeTeam') === want && on && on.dataset.teamsel === String(want));
    }
    await importObj(e, { app: 'AtlasDex', teams: three });
    eq('activeTeam missing -> first team', e.stored('atlasdex:activeTeam'), 0);

    // game stats rules
    const g = async game => { await importObj(e, { app: 'AtlasDex', game }); return e.stored('atlasdex:game'); };
    eq('game: boundaries kept', await g({ streak: 0, best: 12, lastDaily: '2026-01-31', lastScore: 5, lastGrid: '🟩🟥🟩🟥🟩' }), { streak: 0, best: 12, lastDaily: '2026-01-31', lastScore: 5, lastGrid: '🟩🟥🟩🟥🟩' });
    eq('game: lastScore 0 is valid', (await g({ lastScore: 0 })).lastScore, 0);
    eq('game: bad numbers become 0 / null', await g({ streak: -1, best: 1.5, lastDaily: '2026-1-1', lastScore: 6 }), { streak: 0, best: 0, lastDaily: null, lastScore: null, lastGrid: '' });
    eq('game: text numbers rejected, trailing junk in the date rejected', await g({ streak: '5', best: '7', lastDaily: '2026-01-01\n', lastScore: '3' }), { streak: 0, best: 0, lastDaily: null, lastScore: null, lastGrid: '' });
    eq('game: grid keeps only the share squares, at most five', (await g({ lastGrid: '🟩a🟥<>🟩🟩🟩🟩🟥' })).lastGrid, '🟩🟥🟩🟩🟩');

    // settings: theme and shiny
    eq('light theme + shiny imported', await importObj(e, { app: 'AtlasDex', settings: { theme: 'light', shiny: true } }), 'Backup restored');
    ok('theme applied and stored', e.d.body.classList.contains('light') && e.stored('atlasdex:theme') === 'light');
    ok('shiny applied: state, storage and the button', e.stored('atlasdex:shiny') === true && e.$('shinyButton').getAttribute('aria-pressed') === 'true' && e.$('shinyButton').classList.contains('on'));
    await e.go('#/progress', () => e.d.querySelectorAll('.nextcard img').length > 0);
    ok('shiny artwork is used after import', [...e.d.querySelectorAll('.nextcard img')].every(i => /\/shiny\/\d+\.png$/.test(i.getAttribute('src'))));
    await importObj(e, { app: 'AtlasDex', settings: { theme: 'dark', shiny: false } });
    ok('dark theme and non-shiny imported', !e.d.body.classList.contains('light') && e.stored('atlasdex:theme') === 'dark' && e.stored('atlasdex:shiny') === false && e.$('shinyButton').getAttribute('aria-pressed') === 'false');
    await importObj(e, { app: 'AtlasDex', settings: { theme: 'neon', shiny: 1 } });
    ok('invalid theme and shiny leave the settings alone', e.stored('atlasdex:theme') === 'dark' && e.stored('atlasdex:shiny') === false);
  }

  console.log('\n--- 1.2  EXPORT VERSION AND ROUND TRIP ---');
  {
    const e = await boot();
    const rich = { app: 'AtlasDex', version: 5, favorites: [1, 4, 150], caught: [25, 26], compare: [25, 10100], activeTeam: 1,
      teams: [{ name: 'Alpha', members: [member(25, { level: 100, nature: 'timid', ability: 'static', item: 'life-orb', ivs: { ...blank(31), attack: 0 }, evs: { ...blank(0), speed: 252, 'special-attack': 252 }, moves: ['ember', 'surf', 'thunderbolt', 'tackle'] }), member(6)] },
        { name: 'Beta', members: [member(10100, { level: 5 })] }],
      game: { streak: 3, best: 9, lastDaily: '2026-02-02', lastScore: 4, lastGrid: '🟩🟩🟥🟩' }, settings: { theme: 'light', shiny: true } };
    await importObj(e, rich);
    eq('a legitimate backup is stored exactly as given', [e.stored('atlasdex:favorites'), e.stored('atlasdex:caught'), e.stored('atlasdex:compare'), e.stored('atlasdex:teams'), e.stored('atlasdex:activeTeam'), e.stored('atlasdex:game')],
      [rich.favorites, rich.caught, rich.compare, rich.teams, rich.activeTeam, rich.game]);
    await e.go('#/offline', () => !!e.d.querySelector('[data-export]'));
    e.click(e.d.querySelector('[data-export]')); await waitFor(() => e.downloaded && e.blob);
    const text = await new Promise(r => { const fr = new e.w.FileReader(); fr.onload = () => r(fr.result); fr.readAsText(e.blob); });
    const out = JSON.parse(text);
    eq('export version is 5', out.version, 5);
    eq('export carries app, active team and settings', [out.app, out.activeTeam, out.settings], ['AtlasDex', 1, { theme: 'light', shiny: true }]);
    const snap = e.snapshot();
    await importObj(e, { app: 'AtlasDex', favorites: [2], teams: [{ name: 'Other', members: [] }], settings: { theme: 'dark', shiny: false }, game: { streak: 1 } });
    ok('state was changed in between', !same(e.snapshot(), snap));
    eq('re-importing the export restores everything', await importText(e, text), 'Backup restored');
    eq('storage is identical after the round trip', e.snapshot(), snap);
  }

  console.log('\n--- 1.2  BOOT SANITISES WHAT IS ALREADY IN localStorage ---');
  {
    const seed = { 'atlasdex:favorites': EVIL_BACKUP.favorites, 'atlasdex:caught': EVIL_BACKUP.caught, 'atlasdex:compare': EVIL_BACKUP.compare,
      'atlasdex:teams': EVIL_BACKUP.teams, 'atlasdex:activeTeam': 99, 'atlasdex:game': EVIL_BACKUP.game, 'atlasdex:theme': P, 'atlasdex:shiny': 'yes' };
    const e = await boot({ seed });
    ok('app booted and rendered cards despite hostile storage', e.d.querySelectorAll('.poke-card').length > 0);
    eq('favorites sanitised and written back', e.stored('atlasdex:favorites'), [5, 20000, 1]);
    eq('caught sanitised and written back', e.stored('atlasdex:caught'), [3, 2]);
    eq('compare sanitised and written back', e.stored('atlasdex:compare'), [25, 10100]);
    eq('teams sanitised and written back', e.stored('atlasdex:teams'), EXPECTED_TEAMS);
    eq('activeTeam clamped and written back', e.stored('atlasdex:activeTeam'), 2);
    eq('game sanitised and written back', e.stored('atlasdex:game'), EXPECTED_GAME);
    eq('hostile theme and shiny become the defaults', [e.stored('atlasdex:theme'), e.stored('atlasdex:shiny'), e.d.body.classList.contains('light'), e.$('shinyButton').getAttribute('aria-pressed')], ['dark', false, false, 'false']);
    ok('no payload text survives in storage (team names aside)', storageIsClean(e));
    eq('counters from the clean data', [e.$('favCount').textContent, e.$('caughtCount').textContent, e.$('compareCount').textContent, e.$('teamCount').textContent, e.$('streakCount').textContent], ['3', '2', '2', '1', '0']);
    const { problems, notes } = await exerciseEverything(e);
    eq('nothing injected in any view after a hostile boot', problems, []);
    eq('every view rendered', notes, []);
    ok('no payload script ran', e.w.__pwned === undefined);
    ok('prototype not polluted', e.w.eval('({}).polluted') === undefined);
  }
  {
    // containers of the wrong type must not break boot
    const garbage = [
      ['numbers and objects', { 'atlasdex:favorites': 5, 'atlasdex:caught': { a: 1 }, 'atlasdex:teams': 'abc', 'atlasdex:compare': 7, 'atlasdex:activeTeam': { x: 1 }, 'atlasdex:game': [1], 'atlasdex:theme': 5, 'atlasdex:shiny': {} }],
      ['null team list and a team that is null', { 'atlasdex:teams': [null, 5, 'x', { members: null }] }],
      ['empty team list', { 'atlasdex:teams': [] }],
      ['team whose members is a string', { 'atlasdex:teams': [{ name: 'S', members: 'abc' }] }]
    ];
    for (const [label, seed] of garbage) {
      const e = await boot({ seed });
      ok(`boots with garbage storage (${label})`, e.d.querySelectorAll('.poke-card').length > 0);
      await e.go('#/team', VIEWS(e)[2][1]);
      ok(`  ...team view renders (${label})`, e.$('crumb').textContent === 'TEAM BUILDER' && e.d.querySelectorAll('.teamtab').length >= 1);
      ok(`  ...a team always exists (${label})`, e.d.querySelectorAll('[data-teamsel]').length >= 1);
    }
    const e = await boot({ seedRaw: { 'atlasdex:favorites': '{{{not json', 'atlasdex:teams': '' } });
    ok('boots when stored JSON is unparseable', e.d.querySelectorAll('.poke-card').length > 0);
    // legacy single-team key still migrates (migrateTeams stays)
    const old = await boot({ seed: { 'atlasdex:team': [25, 6, 'x', 0] } });
    await old.go('#/team', VIEWS(old)[2][1]);
    ok('legacy "atlasdex:team" numeric list still becomes a team of two', old.d.querySelectorAll('.team-slot:not(.empty):not(.failed)').length === 2);
    eq('...with default loadouts, stored in the new key', old.stored('atlasdex:teams'), [{ name: 'Team 1', members: [member(25), member(6)] }]);
    const old2 = await boot({ seed: { 'atlasdex:teams': [{ name: 'Old', members: [3, { id: 4, moves: ['ember'] }] }] } });
    eq('numeric members inside the teams key are migrated at boot', old2.stored('atlasdex:teams'), [{ name: 'Old', members: [member(3), member(4, { moves: ['ember'] })] }]);
  }

  console.log('\n--- 1.4  activeTeam: RENAME, DELETE, SHOWDOWN AND THE TAB HIGHLIGHT ---');
  {
    const teams = [{ name: 'A', members: [1] }, { name: 'B', members: [2, 3] }, { name: 'C', members: [4] }];
    for (const [given, idx] of [[99, 2], [-5, 0], [1.5, 1], ['abc', 0]]) {
      const e = await boot({ hash: '#/team', seed: { 'atlasdex:teams': teams, 'atlasdex:activeTeam': given } });
      await waitFor(VIEWS(e)[2][1]);
      const on = e.d.querySelector('.teamtab.on');
      ok(`activeTeam ${JSON.stringify(given)}: tab ${idx} is highlighted`, !!on && on.dataset.teamsel === String(idx));
      eq(`  ...and it is the team on screen (${teams[idx].members.length} members)`, e.d.querySelectorAll('.team-slot:not(.empty):not(.failed)').length, teams[idx].members.length);
      e.click(e.d.querySelector('[data-showdown]')); await waitFor(() => !!e.copied);
      const wantNames = teams[idx].members.map(id => 'Mon' + id);
      ok(`  ...Showdown exports that team (${wantNames.join(', ')}), not "empty"`, wantNames.every(n => e.copied.includes(n)) && e.copied.split('\n\n').length === wantNames.length);
      e.promptValue = '  Renamed team  ';
      e.click(e.d.querySelector('[data-teamrename]')); await waitFor(() => e.stored('atlasdex:teams')[idx].name === 'Renamed team');
      eq('  ...rename changes that team only', e.stored('atlasdex:teams').map(t => t.name), teams.map((t, i) => i === idx ? 'Renamed team' : t.name));
      e.click(e.d.querySelector('[data-teamdel]')); await waitFor(() => e.stored('atlasdex:teams').length === 2);
      eq('  ...delete removes that team only', e.stored('atlasdex:teams').map(t => t.members.map(m => m.id)), teams.filter((t, i) => i !== idx).map(t => t.members));
      eq('  ...and activeTeam stays valid', e.stored('atlasdex:activeTeam'), Math.max(0, idx - 1));
      await waitFor(() => e.d.querySelectorAll('.teamtab.on').length === 1, 20000);
      ok('  ...and a team tab is highlighted', e.d.querySelectorAll('.teamtab.on').length === 1);
    }
    const e = await boot({ hash: '#/team', seed: { 'atlasdex:teams': [{ name: 'Only', members: [] }], 'atlasdex:activeTeam': 5 } });
    await waitFor(VIEWS(e)[2][1]);
    const on = e.d.querySelectorAll('.teamtab.on');
    ok('a single empty team with activeTeam 5 renders with tab 0 highlighted', on.length === 1 && on[0].dataset.teamsel === '0');
    eq('...and activeTeam was repaired in storage', e.stored('atlasdex:activeTeam'), 0);
  }

  console.log('\n--- 1.5  TEAM BUILDER LOADS EACH MEMBER ONCE AND SHOWS FAILURES ---');
  {
    const seed = { 'atlasdex:teams': [{ name: 'Squad', members: [1, 2, 4] }] };
    const e = await boot({ hash: '#/team', failIds: [4], seed });
    await waitFor(() => !!e.d.querySelector('.team-error'), 20000);
    await sleep(2000);
    eq('each member requested exactly once over ~2s (no request loop)', [1, 2, 4].map(id => e.pokeCalls(id)), [1, 1, 1]);
    eq('the whole session made list + 3 member requests only', e.calls.length, 4);
    eq('error message', e.d.querySelector('.team-error p').textContent.trim(), '1 team member could not be loaded. Check your connection.');
    eq('Retry button rendered', [e.d.querySelectorAll('[data-teamretry]').length, e.d.querySelector('[data-teamretry]').textContent.trim()], [1, 'Retry']);
    eq('one placeholder slot for the failed member, with its remove button', [e.d.querySelectorAll('.team-slot.failed').length, !!e.d.querySelector('.team-slot.failed [data-team="4"]')], [1, true]);
    ok('placeholder names the member and says it could not load', e.d.querySelector('.team-slot.failed strong').textContent === 'Mon4' && e.d.querySelector('.team-slot.failed').textContent.includes('Could not load'));
    eq('the other two render as normal slots with Edit buttons', [e.d.querySelectorAll('.team-slot:not(.failed):not(.empty)').length, e.d.querySelectorAll('[data-edit]').length], [2, 2]);
    eq('three empty slots remain', e.d.querySelectorAll('.team-slot.empty').length, 3);
    eq('heading counts the whole team', e.d.querySelector('.heading-count').textContent, '3/6');
    eq('analysis runs on the two loaded members (average base stat total)', e.d.querySelector('.verdict.v-mid .big').textContent, String(Math.round((bst(1) + bst(2)) / 2)));
    eq('heatmap and verdicts are rendered', [e.d.querySelectorAll('.heat-row').length, e.d.querySelectorAll('.verdict').length], [19, 4]);
    ok('error banner is announced (role=alert) and the team tabs are present once', e.d.querySelector('.team-error').getAttribute('role') === 'alert' && e.d.querySelectorAll('.teamtabs').length === 1);
    eq('no hostile or odd markup', audit(e), []);

    // Retry while the member still fails: exactly one new attempt, for that member only
    e.click(e.d.querySelector('[data-teamretry]'));
    await waitFor(() => e.pokeCalls(4) === 2 && !!e.d.querySelector('.team-error'), 20000);
    await sleep(800);
    eq('Retry makes exactly one new attempt, for the failed member only', [1, 2, 4].map(id => e.pokeCalls(id)), [1, 1, 2]);
    ok('still failing: banner and placeholder are back, still no loop', !!e.d.querySelector('.team-error') && e.d.querySelectorAll('.team-slot.failed').length === 1);

    // a slow retry that is interrupted by navigation away and back must not start a second request
    e.delayMs = 300;
    e.click(e.d.querySelector('[data-teamretry]'));
    e.w.location.hash = '#/progress'; e.w.location.hash = '#/team';
    await waitFor(() => e.pokeCalls(4) >= 3 && !!e.d.querySelector('.team-error'), 20000);
    await sleep(700);
    eq('re-rendering the team view while a retry is in flight does not start a second request', e.pokeCalls(4), 3);
    e.delayMs = 0;

    // the failure is remembered: switching teams and back does not refetch
    e.click(e.d.querySelector('[data-teamnew]')); await waitFor(() => e.d.querySelectorAll('[data-teamsel]').length === 2);
    e.click(e.d.querySelector('[data-teamsel="0"]')); await waitFor(() => !!e.d.querySelector('.team-error'));
    await sleep(300);
    eq('switching teams away and back does not retry', e.pokeCalls(4), 3);
    ok('...and the error UI is still shown for the failed member', e.d.querySelectorAll('.team-slot.failed').length === 1);

    // Retry that succeeds
    e.failIds.delete(4);
    e.click(e.d.querySelector('[data-teamretry]'));
    await waitFor(() => !e.d.querySelector('.team-error') && e.d.querySelectorAll('.team-slot:not(.failed):not(.empty)').length === 3, 20000);
    eq('one more attempt, which loads the member', e.pokeCalls(4), 4);
    eq('error UI and placeholder are gone', [e.d.querySelectorAll('.team-error').length, e.d.querySelectorAll('.team-slot.failed').length, e.d.querySelectorAll('[data-teamretry]').length], [0, 0, 0]);
    eq('analysis now covers all three members', e.d.querySelector('.verdict.v-mid .big').textContent, String(Math.round((bst(1) + bst(2) + bst(4)) / 3)));
  }
  {
    // removing a failed member does not trigger another request
    const e = await boot({ hash: '#/team', failIds: [2], seed: { 'atlasdex:teams': [{ name: 'S', members: [1, 2] }] } });
    await waitFor(() => !!e.d.querySelector('.team-error'), 20000);
    eq('placeholder remove button targets the failed member', e.d.querySelector('.team-slot.failed .slot-remove').dataset.team, '2');
    e.click(e.d.querySelector('.team-slot.failed .slot-remove'));
    await waitFor(() => !e.d.querySelector('.team-error') && e.$('teamCount').textContent === '1', 20000);
    await sleep(500);
    eq('failed member removed without a new request', [e.pokeCalls(2), e.$('teamCount').textContent, e.d.querySelectorAll('.team-slot.failed').length], [1, '1', 0]);
    eq('stored team no longer has it', e.stored('atlasdex:teams')[0].members.map(m => m.id), [1]);
  }
  {
    // every member fails, in network-error mode: still one request each, placeholders, plural message
    const e = await boot({ hash: '#/team', failIds: ['*'], failMode: 'throw', seed: { 'atlasdex:teams': [{ name: 'S', members: [1, 2, 3] }] } });
    await waitFor(() => !!e.d.querySelector('.team-error'), 20000);
    await sleep(1500);
    eq('offline: one request per member, no loop', [1, 2, 3].map(id => e.pokeCalls(id)), [1, 1, 1]);
    eq('plural error message', e.d.querySelector('.team-error p').textContent.trim(), '3 team members could not be loaded. Check your connection.');
    eq('three placeholders, a Retry button, tabs and slots, no analysis', [e.d.querySelectorAll('.team-slot.failed').length, e.d.querySelectorAll('[data-teamretry]').length, e.d.querySelectorAll('.verdict').length, e.d.querySelectorAll('.teamtab').length >= 1], [3, 1, 0, true]);
    e.click(e.d.querySelector('[data-teamretry]'));
    await waitFor(() => [1, 2, 3].every(id => e.pokeCalls(id) === 2), 20000);
    await sleep(500);
    eq('Retry: exactly one more attempt per member', [1, 2, 3].map(id => e.pokeCalls(id)), [2, 2, 2]);
  }
  {
    // an id PokéAPI does not have (404)
    const e = await boot({ hash: '#/team', seed: { 'atlasdex:teams': [{ name: 'S', members: [1, 99999] }] } });
    await waitFor(() => !!e.d.querySelector('.team-error'), 20000);
    await sleep(800);
    eq('404 id requested once', [e.pokeCalls(1), e.pokeCalls(99999)], [1, 1]);
    eq('message and placeholder for the unknown id', [e.d.querySelector('.team-error p').textContent.trim(), e.d.querySelector('.team-slot.failed strong').textContent], ['1 team member could not be loaded. Check your connection.', '#99999']);
    ok('the known member is analysed', e.d.querySelectorAll('.verdict').length === 4 && e.d.querySelector('.verdict.v-mid .big').textContent === String(bst(1)));
  }
  {
    // adding a member from the grid while its data fails, then opening the team view
    const e = await boot({ failIds: [5] });
    await waitFor(() => e.d.querySelectorAll('.poke-card').length > 0);
    e.click(e.d.querySelector('.compbtn[data-team="5"]'));
    await waitFor(() => e.$('teamCount').textContent === '1');
    await waitFor(() => e.pokeCalls(5) >= 2);   // the card's hydrate request plus the add's own
    await sleep(150);
    const beforeCalls = e.pokeCalls(5);
    await e.go('#/team', () => !!e.d.querySelector('.team-error'));
    await sleep(700);
    eq('opening the team view does not retry what the add already tried', e.pokeCalls(5), beforeCalls);
    ok('...and shows the failure with a Retry button', e.d.querySelectorAll('.team-slot.failed').length === 1 && e.d.querySelectorAll('[data-teamretry]').length === 1);
  }

  console.log('\n--- 1.3  ESCAPING: HOSTILE API VALUES AND art() ---');
  {
    const e = await boot({ hostile: true, hash: '#/pokemon/1' });
    await waitFor(() => !e.$('overlay').hidden && e.$('modalContent').innerHTML.includes('About'), 20000);
    await waitFor(() => e.$('modalContent').querySelector('.abilitycard'));
    ok('overview: the hostile ability name is shown as text', e.$('modalContent').querySelector('.abilitycard strong').textContent === H);
    eq('overview: nothing injected', [e.d.querySelectorAll('#modalContent img[src="x"]').length, audit(e)], [0, []]);
    fireInlineHandlers(e);
    ok('overview: no hostile value executed', e.w.__pwned === undefined);
    e.click(e.d.querySelector('[data-tab="breeding"]')); await waitFor(() => e.$('modalContent').innerHTML.includes('EGG GROUPS'));
    const facts = [...e.d.querySelectorAll('#modalContent .fact')].map(f => f.querySelector('strong').textContent);
    ok('breeding: egg group, habitat, shape and growth rate are shown as text', facts.filter(t => t === H).length === 4);
    eq('breeding: no element was injected', [e.d.querySelectorAll('#modalContent img[src="x"]').length, audit(e)], [0, []]);
    // loadout editor: ability label and value
    e.click(e.d.querySelector('[data-tab="overview"]')); await waitFor(() => !!e.$('modalContent').querySelector('[data-team]'));
    e.click(e.$('modalContent').querySelector('[data-team]')); await waitFor(() => e.$('teamCount').textContent === '1');
    e.click(e.$('closeModal'));
    await e.go('#/team', () => !!e.d.querySelector('[data-edit]'));
    e.click(e.d.querySelector('[data-edit]')); await waitFor(() => e.$('modalContent').innerHTML.includes('LOADOUT'), 20000);
    const opt = e.d.querySelector('select[data-ld="ability"] option');
    ok('loadout editor: ability option label is text and value round-trips', !!opt && opt.textContent === H && opt.value === H);
    eq('loadout editor: nothing injected', [e.d.querySelectorAll('#modalContent img[src="x"]').length, audit(e)], [0, []]);
    // move damage class + item category
    e.click(e.$('closeModal'));
    await e.go('#/moves', () => e.d.querySelectorAll('.dexrow[data-entity]').length > 0 && [...e.d.querySelectorAll('.dx-cls')].some(c => c.textContent.trim() !== ''));
    ok('moves dex: damage class label is text', [...e.d.querySelectorAll('.dx-cls')].some(c => c.textContent.trim() === H));
    eq('moves dex: nothing injected', [e.d.querySelectorAll('#panel img[src="x"]').length, audit(e)], [0, []]);
    await e.go('#/items', () => e.d.querySelectorAll('.dexrow.item[data-entity]').length > 0 && [...e.d.querySelectorAll('.dx-cat')].some(c => c.textContent.trim() !== ''));
    await waitFor(() => !!e.d.querySelector('#brFilter option[value]:not([value=""])'));
    const catOpt = [...e.d.querySelectorAll('#brFilter option')].find(o => o.value !== '');
    ok('items dex: category option label and value are text', !!catOpt && catOpt.textContent === H && catOpt.value === H);
    eq('items dex: nothing injected', [e.d.querySelectorAll('#panel img[src="x"]').length, audit(e)], [0, []]);
    fireInlineHandlers(e);
    ok('no hostile API value executed', e.w.__pwned === undefined);
  }
  {
    // art() and the coercion helpers, taken from the shipped source
    const fn = name => appjs.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n}\\n'))[0];
    const between = (from, to) => appjs.slice(appjs.indexOf(from), appjs.indexOf(to));
    const safe = between('const safe =', 'const title =');
    const coerce = between('const toId =', '/* Own-property lookup');
    const build = new Function('state', 'pokeName', `${safe}\n${coerce}\nconst sprite = (id, shiny) => 'S/' + (shiny ? 'shiny/' : '') + toId(id) + '.png';\n${fn('art')}\nreturn { art, toId, int0 };`);
    const { art, toId, int0 } = build({ shiny: false }, id => 'mon' + id);
    eq('toId: integers, numeric strings and truncation', [toId(25), toId('25'), toId(25.9), toId(' 7 ')], [25, 25, 25, 7]);
    eq('toId: everything else is 0', [toId(0), toId(-4), toId('x'), toId(P), toId(NaN), toId(Infinity), toId(null), toId(undefined), toId({}), toId('25"><img>')], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    eq('int0: numbers stay, junk is 0', [int0(5), int0('5'), int0(5.7), int0(-3), int0(P), int0(null), int0(NaN), int0(undefined)], [5, 5, 5, -3, 0, 0, 0, 0]);
    const a = art('25"><img src=x onerror=1>', 'c" onmouseover="1');
    ok('art(): a hostile id yields no markup from the id', !/<img src=x|onerror=1>/.test(a.replace(/onerror="this\.onerror=null;[^"]*"/, '')) && /\/0\.png/.test(a));
    ok('art(): the class is escaped (no attribute breakout)', a.includes('class="c&quot; onmouseover=&quot;1"') && !/onmouseover="1"/.test(a));
    ok('art(): a numeric string id is coerced and used in every URL', /src="S\/25\.png"/.test(art('25')) && /pokemon\/25\.png'/.test(art('25')));
    ok('art(): fractional and negative ids are coerced', /S\/25\.png/.test(art(25.9)) && /S\/0\.png/.test(art(-3)));
    ok('art(): the inline handler stays the exact expected shape', ART_HANDLER.test(a.match(/onerror="([^"]*)"/)[1]));
  }

  console.log('\n--- 1.2  OWN KEYS ONLY, AND HAND-EDITED LINKS ---');
  {
    const e = await boot();
    // something polluted Object.prototype: a document that merely lacks "app" must not inherit it
    e.w.Object.prototype.app = 'AtlasDex';
    e.w.Object.prototype.favorites = [7, 8];
    const before = e.snapshot();
    eq('inherited app/favorites are ignored: a document without own "app" is rejected', await importText(e, '{"version":5}'), 'That is not an AtlasDex backup');
    ok('...and nothing was stored', same(e.snapshot(), before));
    eq('inherited fields are not imported either', (await importText(e, '{"app":"AtlasDex"}'), e.stored('atlasdex:favorites')), undefined);
    delete e.w.Object.prototype.app; delete e.w.Object.prototype.favorites;
  }
  for (const hash of ['#/move/%E0%A4%A', '#/item/..%2F..%2Fx', '#/ability/<img src=x onerror=window.__pwned=1>', '#/move/UPPER', '#/pokemon/abc', '#/pokemon/-5', '#/pokemon/1.5', '#/pokemon/0']) {
    const before = allErrs.length;
    const e = await boot({ hash });
    await waitFor(() => e.d.querySelectorAll('.poke-card').length > 0, 20000);
    await sleep(200);
    ok(`hand-edited link ${hash}: no error, no modal, falls back to the home grid, no request for it`, allErrs.length === before && e.$('overlay').hidden && e.d.querySelectorAll('.poke-card').length > 0 && !e.calls.some(u => /\/(move|item|ability)\/[^?]*(%|\.\.|<|UPPER)|\/pokemon\/(-|0|1\.)/.test(u)));
  }
  {
    const e = await boot({ hash: '#/move/ember' });
    await waitFor(() => !e.$('overlay').hidden && e.$('modalContent').innerHTML.includes('Ember'), 20000);
    ok('a well-formed #/move/ember link still opens that move', !e.$('overlay').hidden && e.calls.some(u => u.endsWith('/move/ember')));
  }

  console.log('\n--- 1.2-1.5  FOLLOW-UPS FROM THE INDEPENDENT REVIEW ---');
  {
    // a non-iterable teams value in storage must not break boot (migrateTeams guards before iterating)
    for (const raw of ['{"a":1}', '42', '"teams"', 'true']) {
      const e = await boot({ seedRaw: { 'atlasdex:teams': raw } });
      eq(`boot survives atlasdex:teams = ${raw} and repairs it`,
        [e.$('totalStat').textContent, e.stored('atlasdex:teams')], [String(SPECIES), [{ name: 'Team 1', members: [] }]]);
    }

    // the pre-multi-team key is migrated, then removed
    {
      const e = await boot({ seed: { 'atlasdex:team': [25, H, { id: 6, item: H }] } });
      eq('legacy single-team key: members migrated into atlasdex:teams', e.stored('atlasdex:teams'), [{ name: 'Team 1', members: [member(25), member(6)] }]);
      eq('legacy single-team key is removed after migration', e.stored('atlasdex:team'), undefined);
    }

    // builds saved by older versions keep their values: fractions truncated, apostrophes kept
    {
      const old = { id: 25, level: 50.5, nature: 'adamant', item: "King's Rock", ivs: { ...blank(31), attack: 12.5 }, evs: { ...blank(0), attack: 10.5 }, moves: ['ember'] };
      const e = await boot({ seed: { 'atlasdex:teams': [{ name: 'Old', members: [old] }] } });
      eq('an older saved build survives boot', e.stored('atlasdex:teams'), [{ name: 'Old', members: [
        member(25, { level: 50, nature: 'adamant', item: "King's Rock", ivs: { ...blank(31), attack: 12 }, evs: { ...blank(0), attack: 10 }, moves: ['ember'] })] }]);
    }

    // caught ids beyond the species list are kept but never inflate progress
    {
      const e = await boot({ seed: { 'atlasdex:caught': [1, 2, 19999] } });
      eq('progress counts only listed species', [e.$('caughtCount').textContent, e.$('heroCaught').textContent, e.$('heroPct').textContent],
        ['2', '2', Math.round(2 / SPECIES * 100) + '%']);
      await e.go('#/progress', () => !!e.d.querySelector('.ring-inner'));
      eq('Living Dex shows 2 of 30 and 6.7%', [e.d.querySelector('.panel-title .heading-count').textContent.replace(/\s/g, ''), e.d.querySelector('.ring-inner strong').textContent],
        [`2/${SPECIES}`, (2 / SPECIES * 100).toFixed(1) + '%']);
      eq('the extra id stays stored (a newer API may list it)', e.stored('atlasdex:caught'), [1, 2, 19999]);
    }

    // an import clears remembered load failures, so a member that now loads is not stuck as a placeholder
    {
      const e = await boot({ hash: '#/team', failIds: [5], seed: { 'atlasdex:teams': [{ name: 'T', members: [5] }] } });
      await waitFor(() => !!e.d.querySelector('.team-slot.failed'), 20000);
      e.failIds.delete(5);
      eq('import accepted', await importObj(e, { app: 'AtlasDex', teams: [{ name: 'T', members: [5] }] }), 'Backup restored');
      await waitFor(() => !!e.d.querySelector('[data-edit="5"]'), 20000);
      ok('after an import the member loads without pressing Retry', !e.d.querySelector('.team-slot.failed') && !e.d.querySelector('.team-error'));
      eq('...with exactly one new request', e.pokeCalls(5), 2);
    }

    // adding a member and opening the Team Builder at once does not fetch it twice
    {
      const e = await boot();
      e.delayMs = 300;
      const b = e.d.createElement('button'); b.dataset.team = '10100'; e.$('grid').appendChild(b);
      e.click(b);
      e.w.location.hash = '#/team';
      await waitFor(() => !!e.d.querySelector('[data-edit="10100"]'), 20000);
      await sleep(400);
      eq('a member added just before opening the Team Builder is requested once', e.pokeCalls(10100), 1);
      e.delayMs = 0;
    }

    // the loadout editor ignores values its own controls never produce
    {
      const e = await boot({ hash: '#/team', seed: { 'atlasdex:teams': [{ name: 'T', members: [member(1)] }] } });
      await waitFor(() => !!e.d.querySelector('[data-edit="1"]'), 20000);
      e.click(e.d.querySelector('[data-edit="1"]')); await waitFor(() => e.$('modalContent').innerHTML.includes('LOADOUT'));
      const natureSel = e.d.querySelector('[data-ld="nature"]');
      natureSel.insertAdjacentHTML('beforeend', '<option value="constructor">x</option>');
      e.chg(natureSel, 'constructor');
      const iv = e.d.createElement('input'); iv.dataset.iv = 'constructor'; iv.value = '5';
      e.$('modalContent').appendChild(iv); iv.dispatchEvent(new e.w.Event('input', { bubbles: true }));
      const slot = e.d.querySelector('[data-moveslot="0"]');
      slot.insertAdjacentHTML('beforeend', '<option value="Bad Move!">x</option>');
      e.chg(slot, 'Bad Move!');
      await sleep(200);
      const m = e.stored('atlasdex:teams')[0].members[0];
      eq('editor ignores a nature, an IV key and a move that fail the rules', [m.nature, Object.keys(m.ivs).sort(), m.moves], ['hardy', Object.keys(blank(0)).sort(), []]);
      const itemBox = e.d.querySelector('[data-ld="item"]');
      itemBox.value = 'Life Orb<';
      itemBox.dispatchEvent(new e.w.Event('input', { bubbles: true }));
      await sleep(50);
      eq('typing a markup character strips just that character, and the box shows what is saved',
        [e.stored('atlasdex:teams')[0].members[0].item, itemBox.value], ['Life Orb', 'Life Orb']);
    }

    // openPokemon itself refuses ids that are not whole, listed species numbers
    {
      const e = await boot();
      for (const v of ['1.5', '-1', '0', String(SPECIES + 1)]) {
        const el = e.d.createElement('button'); el.dataset.open = v; e.$('grid').appendChild(el);
        e.click(el); await sleep(50);
        ok(`data-open="${v}" does not open the modal`, e.$('overlay').hidden);
      }
    }

    // a type or damage class named after an Object.prototype member never resolves to it
    {
      const e = await boot({ types: { 3: ['constructor', '__proto__'] }, dmgClass: 'constructor', hash: '#/team',
        seed: { 'atlasdex:teams': [{ name: 'T', members: [member(3, { moves: ['ember'] })] }] } });
      await waitFor(() => !!e.d.querySelector('[data-edit="3"]'), 20000);
      ok('slot colour falls back instead of an inherited value', e.d.querySelector('.team-slot:not(.empty)').getAttribute('style').includes('#a8ef61'));
      ok('type badges fall back to the neutral colour', [...e.d.querySelectorAll('.team-slot .type')].every(b => b.getAttribute('style').includes('#8a9ab1')));
      e.click(e.d.querySelector('[data-edit="3"]')); await waitFor(() => e.$('modalContent').innerHTML.includes('LOADOUT'));
      await waitFor(() => e.$('modalContent').innerHTML.includes(' pow'), 20000);
      ok('move meta shows no inherited text for a damage class named "constructor"', !/function|native code/.test(e.$('modalContent').textContent));
    }
  }

  console.log('\n--- 1.1  THE HARNESS CAN FAIL ---');
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlasdex-harness-'));
    try {
      const sub = path.join(tmp, 'tests');
      fs.mkdirSync(sub);
      fs.copyFileSync(path.join(__dirname, 'run.js'), path.join(sub, 'run.js'));
      const suites = {
        'a-pass.test.js': "console.log('  PASS  fine');",
        'b-fail-exit0.test.js': "console.log('  PASS  one');console.log('  FAIL  broken thing');",
        'c-exit1.test.js': "console.log('  PASS  one');process.exit(1);",
        'd-runtime.test.js': "console.log('  PASS  one');console.log('runtime errors: boom');",
        'e-nopass.test.js': "console.log('nothing here');",
        'f-crash.test.js': "console.log('  PASS  one');throw new Error('kaboom');"
      };
      for (const [n, body] of Object.entries(suites)) fs.writeFileSync(path.join(sub, n), body);
      const run = (...args) => spawnSync(process.execPath, [path.join(sub, 'run.js'), ...args], { encoding: 'utf8' });
      const all = run();
      ok('run.js exits non-zero when any suite is bad', all.status === 1);
      const lines = all.stdout.split('\n');
      const status = n => (lines.find(l => l.includes(n)) || '').trim()[0];
      eq('run.js marks the good suite passed and each bad one failed', ['a-pass', 'b-fail', 'c-exit1', 'd-runtime', 'e-nopass', 'f-crash'].map(status), ['✓', '✗', '✗', '✗', '✗', '✗']);
      ok('run.js prints the FAIL line of a suite that exited 0', all.stdout.includes('FAIL  broken thing'));
      ok('run.js prints the runtime error line', all.stdout.includes('runtime errors: boom'));
      ok('run.js names every failed suite', ['b-fail', 'c-exit1', 'd-runtime', 'e-nopass', 'f-crash'].every(n => all.stdout.split('FAILED:')[1]?.includes(n)));
      eq('run.js exits 0 when only good suites run', run('a-').status, 0);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

    // harness.js itself: an uncaught page error or a rejected promise must fail a suite that otherwise passed
    const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'atlasdex-runtime-'));
    try {
      fs.copyFileSync(path.join(__dirname, 'harness.js'), path.join(rt, 'harness.js'));
      const head = `const { JSDOM } = require(${JSON.stringify(require.resolve('jsdom'))});\nconst { trackErrors, finish } = require('./harness');\n` +
        `const w = new JSDOM('<p>', { runScripts: 'dangerously', url: 'https://x.test/' }).window;\nconst errs = trackErrors(w);\n` +
        `console.log('  PASS  an assertion that passed');\n`;
      const fixtures = {
        clean: head + 'setTimeout(() => finish(0, errs), 30);',
        pageError: head + "w.eval('setTimeout(() => { null.boom; }, 0)');\nsetTimeout(() => finish(0, errs), 60);",
        rejection: head + "Promise.reject(new Error('lost promise'));\nsetTimeout(() => finish(0, errs), 60);",
        failedAssertion: head + "console.log('  FAIL  a failed assertion');\nsetTimeout(() => finish(1, errs), 30);"
      };
      const out = {};
      for (const [name, body] of Object.entries(fixtures)) {
        fs.writeFileSync(path.join(rt, name + '.js'), body);
        out[name] = spawnSync(process.execPath, [path.join(rt, name + '.js')], { encoding: 'utf8', timeout: 60000 });
      }
      eq('harness: a clean suite exits 0 and reports no runtime errors', [out.clean.status, /runtime errors: none/.test(out.clean.stdout)], [0, true]);
      ok('harness: an uncaught page error fails the suite and is reported', out.pageError.status === 1 && /runtime errors: .*boom/.test(out.pageError.stdout) && /FAIL  no uncaught runtime errors/.test(out.pageError.stdout));
      ok('harness: a rejected promise fails the suite and is reported', out.rejection.status === 1 && /unhandled rejection: lost promise/.test(out.rejection.stdout) && /FAIL  no uncaught runtime errors/.test(out.rejection.stdout));
      ok('harness: a failed assertion makes finish() exit 1', out.failedAssertion.status === 1);
    } finally { fs.rmSync(rt, { recursive: true, force: true }); }

    // the real suites must exit non-zero when an assertion fails: break the app in a scratch copy
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'atlasdex-mutant-'));
    try {
      fs.mkdirSync(path.join(copy, 'tests'));
      for (const f of fs.readdirSync(__dirname)) if (f.endsWith('.js')) fs.copyFileSync(path.join(__dirname, f), path.join(copy, 'tests', f));
      fs.copyFileSync(dir + '/index.html', copy + '/index.html');
      fs.symlinkSync(dir + '/node_modules', copy + '/node_modules');
      const mutate = (from, to) => {
        const s = appjs;
        if (!s.includes(from)) throw new Error('mutation anchor not found: ' + from);
        fs.writeFileSync(copy + '/app.js', s.replace(from, to));
      };
      const runSuite = file => spawnSync(process.execPath, [path.join(copy, 'tests', file)], { encoding: 'utf8', timeout: 90000 });
      const wrong = (res) => res.status !== 0 && /^\s*FAIL\b/m.test(res.stdout);

      fs.writeFileSync(copy + '/app.js', appjs);
      eq('control: the unmodified app passes suite 05 and 06', [runSuite('05-typechart.test.js').status, runSuite('06-battlemath.test.js').status], [0, 0]);

      mutate('fire:     {fire:.5, water:.5, grass:2,', 'fire:     {fire:.5, water:.5, grass:1,');
      ok('suite 05 exits non-zero when a chart entry is wrong', wrong(runSuite('05-typechart.test.js')));
      mutate("  fire:     {fire:.5,", "  fire:     {fire:.75,");
      ok('suite 05 fails a multiplier outside 0 / 0.5 / 2 (the structural assertion is real)', /FAIL  bad multiplier/.test(runSuite('05-typechart.test.js').stdout));
      mutate("  steel:'#7094a6'", "  steel:'nope'");
      const colour = runSuite('05-typechart.test.js');
      ok('suite 05 fails a bad colour (the structural assertion is real)', colour.status !== 0 && /FAIL  bad colour for steel/.test(colour.stdout));
      mutate('return Math.floor((core + 5) * natureMod(nature, statName));', 'return Math.floor((core + 6) * natureMod(nature, statName));');
      ok('suite 06 exits non-zero when the stat formula is wrong', wrong(runSuite('06-battlemath.test.js')));
      mutate("$('caughtCount').textContent = caught;", "$('caughtCount').textContent = 0;");
      ok('suite 01 exits non-zero when an assertion fails', wrong(runSuite('01-core.test.js')));
    } finally { fs.rmSync(copy, { recursive: true, force: true }); }
  }

  finish(fail, allErrs);
})().catch(crash);
