/* Integration: behaviour that only breaks when two batches meet. Each section
   names the batches it joins. Every case boots the real index.html + app.js in a
   fresh jsdom with a mocked fetch; waits poll (harness.waitFor), nothing sleeps. */
const fs = require('fs'), path = require('path'), { JSDOM } = require('jsdom');
const { waitFor, trackErrors, finish, crash } = require('./harness');
const dir = path.resolve(__dirname, '..');
const html = fs.readFileSync(dir + '/index.html', 'utf8');
const appjs = fs.readFileSync(dir + '/app.js', 'utf8');

let fail = 0;
const ok = (l, c) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) fail++; };
const eq = (l, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(l + (g === w ? '' : `  [got ${g?.slice(0, 300)}  want ${w?.slice(0, 300)}]`), g === w);
};
const allErrs = [];

/* ---- mock PokéAPI --------------------------------------------------- */
const N = 30;
const TY = ['fire', 'water', 'grass', 'electric', 'flying', 'steel', 'ghost', 'dragon'];
const mkPoke = id => ({
  id, name: 'mon' + id, height: 10, weight: 100, base_experience: 60,
  species: { url: '/pokemon-species/' + id + '/' },
  types: [TY[id % 8], TY[(id + 3) % 8]].map(t => ({ type: { name: t } })),
  stats: [['hp', 60], ['attack', 80], ['defense', 70], ['special-attack', 90], ['special-defense', 75], ['speed', 100]]
    .map(([n, v]) => ({ base_stat: v, effort: 0, stat: { name: n } })),
  abilities: [{ ability: { name: 'blaze' }, is_hidden: false }],
  moves: ['ember', 'surf'].map(n => ({ move: { name: n }, version_group_details: [{ level_learned_at: 5, move_learn_method: { name: 'level-up' } }] })),
  sprites: { other: { 'official-artwork': { front_default: 'x.png', front_shiny: 's.png' } } }, cries: { latest: 'c.ogg' }
});
function makeFetch(env) {
  const res = (data, ok = true, status = 200) => ({ ok, status, json: async () => data });
  return async url => {
    env.calls.push(url);
    await new Promise(r => setTimeout(r, 1));
    let m;
    if (url.includes('pokemon-species?')) {
      if (env.failSpecies) throw new TypeError('Failed to fetch');
      return res({ results: Array.from({ length: N }, (_, i) => ({ name: 'mon' + (i + 1), url: '/pokemon-species/' + (i + 1) + '/' })) });
    }
    if ((m = url.match(/\/pokemon\/(\d+)$/))) return res(mkPoke(+m[1]));
    if ((m = url.match(/\/pokemon-species\/(\d+)$/))) {
      const sid = +m[1];
      return res({ name: 'mon' + sid, id: sid, gender_rate: 4, capture_rate: 45, hatch_counter: 20, base_happiness: 50,
        egg_groups: [{ name: 'monster' }], growth_rate: { name: 'medium-slow' }, habitat: { name: 'forest' }, shape: { name: 'upright' },
        varieties: [{ is_default: true, pokemon: { name: 'mon' + sid, url: '/pokemon/' + sid + '/' } }],
        is_legendary: false, is_mythical: false, is_baby: false,
        flavor_text_entries: [{ language: { name: 'en' }, flavor_text: 'A test mon.' }],
        genera: [{ language: { name: 'en' }, genus: 'Test' }], evolution_chain: { url: '/evolution-chain/1/' } });
    }
    if (url.includes('/evolution-chain/')) return res({ chain: { species: { name: 'mon1', url: '/pokemon-species/1/' }, evolves_to: [] } });
    if ((m = url.match(/\/move\/([^/]+)$/))) return res({ name: m[1], power: 90, accuracy: 100, pp: 15, priority: 0, type: { name: 'fire' },
      damage_class: { name: 'special' }, effect_entries: [{ language: { name: 'en' }, short_effect: 'x' }], learned_by_pokemon: [] });
    if ((m = url.match(/\/ability\/([^/]+)$/))) return res({ name: m[1], effect_entries: [{ language: { name: 'en' }, short_effect: 'x' }], pokemon: [] });
    if (url.includes('/encounters')) return res([]);
    return res({});
  };
}

/* opts: hash, seed (JSON-encoded into localStorage), seedRaw (verbatim), failSpecies, noWait */
async function boot(opts = {}) {
  const env = { calls: [], failSpecies: !!opts.failSpecies, blob: null };
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/' + (opts.hash || ''), pretendToBeVisual: true });
  const w = dom.window;
  env.w = w; env.d = w.document; env.$ = id => w.document.getElementById(id);
  w.fetch = makeFetch(env);
  w.Audio = function () { return { play: async () => {} }; };
  w.confirm = () => true;
  w.scrollTo = () => {};
  w.CSS = { escape: s => String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&') };
  w.URL.createObjectURL = blob => { env.blob = blob; return 'blob:x'; };
  w.URL.revokeObjectURL = () => {};
  const origCreate = w.document.createElement.bind(w.document);
  w.document.createElement = tag => { const el = origCreate(tag); if (tag === 'a') el.click = () => {}; return el; };
  w.localStorage.clear();
  for (const [k, v] of Object.entries(opts.seed || {})) w.localStorage.setItem(k, JSON.stringify(v));
  for (const [k, v] of Object.entries(opts.seedRaw || {})) w.localStorage.setItem(k, v);
  trackErrors(w, allErrs);
  w.eval(appjs);
  env.click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  env.chg = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  env.key = (key, target) => {
    const ev = new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    (target || env.d.activeElement || env.d.body).dispatchEvent(ev);
    return ev;
  };
  env.raw = k => w.localStorage.getItem(k);
  env.stored = k => { const r = w.localStorage.getItem(k); return r === null ? undefined : JSON.parse(r); };
  env.go = async (hash, cond) => { w.location.hash = hash; await waitFor(cond); };
  if (!opts.noWait) await waitFor(() => env.$('totalStat').textContent === String(N));
  return env;
}
/* The app's own local-calendar key, computed the same way inside the window. */
const localKey = w => { const d = new w.Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dailyBtn = e => e.$('panel').querySelector('[data-game="daily"]');
const menuText = e => dailyBtn(e)?.textContent.replace(/\s+/g, ' ').trim() || '';
async function importText(env, text) {
  const { w, $ } = env;
  const file = new w.File([text], 'backup.json', { type: 'application/json' });
  const input = $('importFile');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  $('toast').textContent = '';
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  await waitFor(() => $('toast').textContent !== '');
  return $('toast').textContent;
}
/* Play the five daily questions, always picking the first option. */
async function playDaily(e) {
  e.click(dailyBtn(e));
  for (let i = 0; i < 5; i++) {
    await waitFor(() => e.d.querySelector('[data-guess]:not([disabled])'));
    e.click(e.d.querySelector('[data-guess]'));
    await waitFor(() => e.d.querySelector('[data-gamenext]'));
    e.click(e.d.querySelector('[data-gamenext]'));
  }
  await waitFor(() => e.d.querySelector('[data-share]'));
}

(async () => {
  /* ============================================================== */
  console.log('\n--- batch 1 sanitisers x batch 3 resumable daily (atlasdex:daily) ---');
  {
    const probe = await boot({ noWait: true });
    const today = localKey(probe.w);
    const cases = {
      'extra keys and an own __proto__': [`{"date":"${today}","results":[true],"q":0,"picked":5,"evil":"<img src=x onerror=1>","__proto__":{"polluted":1}}`, true],
      'a string pick': [`{"date":"${today}","results":[true],"q":0,"picked":"5"}`, false],
      'a huge pick': [`{"date":"${today}","results":[true],"q":0,"picked":1e30}`, false],
      'a non-boolean result': [`{"date":"${today}","results":[1],"q":0,"picked":5}`, false],
      'a bad date shape': [`{"date":"yesterday","results":[],"q":0,"picked":null}`, false],
      'an array': ['[1,2,3]', false],
      'not JSON': ['not json{', false]
    };
    for (const [name, [raw, valid]] of Object.entries(cases)) {
      const x = await boot({ seedRaw: { 'atlasdex:daily': raw } });
      if (valid) {
        eq(`boot rewrites ${name} to the four known fields`, x.stored('atlasdex:daily'), { date: today, results: [true], q: 0, picked: 5 });
        eq('  and nothing was polluted', ({}).polluted, undefined);
      } else {
        eq(`boot removes ${name}`, x.raw('atlasdex:daily'), null);
      }
    }
    const r = await boot({ seedRaw: { 'atlasdex:daily': `{"date":"${today}","results":[true,false],"q":2,"picked":null}` } });
    await r.go('#/game', () => dailyBtn(r));
    ok('a clean in-progress daily survives boot and the menu offers to resume', /Resume/.test(menuText(r)) && /2\/5 answered/.test(menuText(r)));
  }

  console.log('\n--- local-date keys x game sanitiser x export/import (batch 1 x batch 3) ---');
  {
    const e = await boot();
    const today = localKey(e.w);
    await e.go('#/game', () => dailyBtn(e));
    await playDaily(e);
    const st = e.stored('atlasdex:game');
    eq('finishing the daily stores the local calendar date', st.lastDaily, today);
    ok('finishing the daily clears the in-progress key', e.raw('atlasdex:daily') === null);

    /* Reload with the same storage: the boot sanitiser must not discard a local-date key. */
    const dump = {};
    for (let i = 0; i < e.w.localStorage.length; i++) { const k = e.w.localStorage.key(i); dump[k] = e.w.localStorage.getItem(k); }
    const r = await boot({ seedRaw: dump });
    eq('a reload keeps the stored game stats exactly', r.stored('atlasdex:game'), st);
    await r.go('#/game', () => dailyBtn(r));
    ok('the menu still says replay after a reload', /Replay today/.test(menuText(r)));

    /* The export carries the same stats and importing it back is lossless. */
    await r.go('#/offline', () => r.d.querySelector('[data-export]'));
    r.click(r.d.querySelector('[data-export]'));
    const payload = JSON.parse(await new Promise(res => { const fr = new r.w.FileReader(); fr.onload = () => res(fr.result); fr.readAsText(r.blob); }));
    eq('the export payload has the same game stats', payload.game, st);
    ok('the export has no in-progress daily (it is not part of a backup)', !('daily' in payload));
    const fresh = await boot();
    const toast = await importText(fresh, JSON.stringify(payload));
    ok('the import accepts it', /restored/i.test(toast));
    eq('the import stores the same game stats', fresh.stored('atlasdex:game'), st);
  }

  console.log('\n--- import clears a contradicting half-played daily (batch 1 x batch 3) ---');
  {
    const e = await boot();
    const today = localKey(e.w);
    await e.go('#/game', () => dailyBtn(e));
    e.click(dailyBtn(e));
    await waitFor(() => e.d.querySelector('[data-guess]'));
    e.click(e.d.querySelector('[data-guess]'));
    ok('answering stores an in-progress daily', !!e.stored('atlasdex:daily'));
    const toast = await importText(e, JSON.stringify({ app: 'AtlasDex', version: 5,
      game: { streak: 3, best: 3, lastDaily: today, lastScore: 4, lastGrid: '🟩🟩🟩🟩🟥' } }));
    ok('the backup is restored', /restored/i.test(toast));
    eq('the stale in-progress daily is gone', e.raw('atlasdex:daily'), null);
    await e.go('#/game', () => { e.w.dispatchEvent(new e.w.Event('hashchange')); return dailyBtn(e); });
    e.click(e.d.querySelector('[data-gamemenu]') || e.d.body);
    await waitFor(() => dailyBtn(e));
    ok('the restored lastDaily wins: the menu says replay, not resume', /Replay today/.test(menuText(e)) && !/Resume/.test(menuText(e)));

    const other = await boot();
    await other.go('#/game', () => dailyBtn(other));
    other.click(dailyBtn(other));
    await waitFor(() => other.d.querySelector('[data-guess]'));
    other.click(other.d.querySelector('[data-guess]'));
    await importText(other, JSON.stringify({ app: 'AtlasDex', version: 5, favorites: [1] }));
    ok('a backup without game stats leaves the in-progress daily alone', !!other.stored('atlasdex:daily'));
  }

  /* ============================================================== */
  console.log('\n--- batch 1 slug check x batch 4 malformed-hash fallback ---');
  {
    for (const hash of ['#/move/%E0%A4%A', '#/ability/<img src=x onerror=window.__pwned=1>', '#/item/..%2F..%2Fx', '#/move/Upper', '#/move/' + 'a'.repeat(80)]) {
      const e = await boot({ hash });
      await waitFor(() => !e.$('listSection').hidden);
      ok(`${hash.slice(0, 40)} lands on the home view`, !e.$('listSection').hidden && e.$('overlay').hidden);
      eq('  the hash is rewritten to home', e.w.location.hash, '#/');
      ok('  no API request carries the junk', !e.calls.some(u => /\/(move|ability|item)\/[^/]*(%|<|\.\.|Upper|aaaa)/.test(u)));
      eq('  window.__pwned is unset', e.w.__pwned, undefined);
    }
    const good = await boot({ hash: '#/move/flamethrower' });
    ok('a valid slug still opens the move', await waitFor(() => !good.$('overlay').hidden));
  }

  /* ============================================================== */
  console.log('\n--- batch 1 art() coercion x batch 3 crossorigin and silhouette ---');
  {
    const between = (from, to) => appjs.slice(appjs.indexOf(from), appjs.indexOf(to));
    const safe = between('const safe =', 'const title =');
    const coerce = between('const toId =', '/* Own-property lookup');
    const myst = between('const MYSTERY_IMG', '/* crossorigin="anonymous"');
    const artFn = appjs.match(/function art\([\s\S]*?\n}\n/)[0];
    const { art } = new Function('state', 'pokeName', `${safe}\n${coerce}\nconst sprite = (id, shiny) => 'S/' + (shiny ? 'shiny/' : '') + toId(id) + '.png';\n${myst}\n${artFn}\nreturn { art };`)({ shiny: false }, id => 'mon' + id);
    const hostile = '25"><img src=x onerror=1>';
    for (const [label, markup] of [['art()', art(hostile, 'c" x="1')], ['art(mystery)', art(hostile, 'c" x="1', true)]]) {
      ok(`${label}: crossorigin is present`, /crossorigin="anonymous"/.test(markup));
      ok(`${label}: a hostile id never reaches the markup`, !/<img src=x/.test(markup.replace(/^<img/, '')) && /S\/0\.png/.test(markup));
      ok(`${label}: the class cannot break out`, markup.includes('class="c&quot; x=&quot;1"'));
    }
    const m = art(25, '', true);
    ok('mystery: alt text is neutral', /alt="Mystery Pokémon silhouette"/.test(m) && !/mon25/.test(m));
    ok('mystery: failure falls back to the plain sprite, then a name-free placeholder',
      /pokemon\/25\.png'/.test(m) && /data:image\/svg\+xml,/.test(m) && !/mon25/.test(m.match(/onerror="([^"]*)"/)[1]));
    ok('sw.js uses the v2 art cache', /atlasdex-art-v2/.test(fs.readFileSync(dir + '/sw.js', 'utf8')));

    /* In the real game the unrevealed silhouette is the mystery variant. */
    const e = await boot();
    await e.go('#/game', () => e.$('panel').querySelector('[data-game="endless"]'));
    e.click(e.$('panel').querySelector('[data-game="endless"]'));
    await waitFor(() => e.d.querySelector('.silhouette'));
    const img = e.d.querySelector('.silhouette img');
    ok('the live silhouette has crossorigin and a neutral alt', !!img && img.getAttribute('crossorigin') === 'anonymous' && /Mystery/.test(img.alt));
    ok('every <img> rendered by the app has crossorigin', [...e.d.querySelectorAll('img')].filter(i => !i.hasAttribute('crossorigin')).length === 0);
  }

  /* ============================================================== */
  console.log('\n--- batch 1 init sanitisers x batch 4 idempotent init and delegated retry ---');
  {
    /* An old save (plain numbers), a hostile favourites value and a saved theme, booted while PokéAPI is down. */
    const e = await boot({ failSpecies: true, noWait: true,
      seed: { 'atlasdex:team': [1, 2], 'atlasdex:favorites': [3, 'x', -1, 3, 1e30], 'atlasdex:theme': 'light' } });
    ok('the failed boot shows the retry button', await waitFor(() => e.d.querySelector('[data-retryinit]')));
    const counts = () => [e.d.querySelectorAll('#typeFilter option').length, e.d.querySelectorAll('#genFilter option').length, e.d.querySelectorAll('#sideGens .genitem').length];
    const before = counts();
    eq('migrateTeams ran before the sanitisers: the old save became member objects', e.stored('atlasdex:teams')[0].members.map(m => m.id), [1, 2]);
    eq('the favourites were cleaned once, at boot', e.stored('atlasdex:favorites'), [3]);
    const snap = () => JSON.stringify({ t: e.stored('atlasdex:teams'), f: e.stored('atlasdex:favorites'), th: e.stored('atlasdex:theme') });
    const snap0 = snap();

    e.click(e.d.querySelector('[data-retryinit]'));
    ok('a second failed attempt shows exactly one retry button', await waitFor(() => e.d.querySelectorAll('[data-retryinit]').length === 1 && e.$('status').textContent === 'Unable to load Pokémon data'));
    eq('a retry does not duplicate the type/generation controls', counts(), before);
    eq('a retry does not rewrite the data destructively', snap(), snap0);

    e.failSpecies = false;
    e.click(e.d.querySelector('[data-retryinit]'));
    ok('the retry recovers', await waitFor(() => e.d.querySelectorAll('.poke-card').length === N));
    eq('the controls are still built exactly once', counts(), before);
    eq('the team survived the repeated init', e.stored('atlasdex:teams')[0].members.map(m => m.id), [1, 2]);
    ok('the saved light theme is still applied', e.d.body.classList.contains('light') && e.$('themeButton').getAttribute('aria-pressed') === 'true');
    eq('an unsaved theme is never written by boot', (await boot()).raw('atlasdex:theme'), null);
  }

  /* ============================================================== */
  console.log('\n--- batch 1 renderTeam x batch 4 refresh-on-close x batch 2 select handling ---');
  {
    const e = await boot();
    const { d } = e;
    e.click(d.querySelector('.poke-card[data-open="1"] [data-team]'));
    await e.go('#/team', () => d.querySelector('[data-edit="1"]'));
    ok('the Team Builder shows the member with 0/4 moves', /0\/4 moves/.test(d.querySelector('.team-slot').textContent));
    const opener = d.querySelector('[data-edit="1"]');
    opener.focus();
    e.click(opener);
    ok('the editor opens', await waitFor(() => d.querySelector('[data-moveslot="0"]')));

    const slot0 = d.querySelector('[data-moveslot="0"]');
    slot0.focus();
    e.chg(slot0, 'ember');
    ok('the move is saved', await waitFor(() => e.stored('atlasdex:teams')[0].members[0].moves.includes('ember')));
    ok('the editor re-rendered with the move chosen', await waitFor(() => d.querySelector('[data-moveslot="0"]')?.value === 'ember'));
    const act = d.activeElement;
    ok('focus returns to the same select, not to <body> or the dialog', !!act && act.tagName === 'SELECT' && act.dataset.moveslot === '0');

    const nat = d.querySelector('[data-ld="nature"]');
    nat.focus();
    e.chg(nat, 'adamant');
    eq('a nature change is saved as a clean slug', e.stored('atlasdex:teams')[0].members[0].nature, 'adamant');
    ok('a nature change does not rebuild the editor (the select keeps focus)', d.activeElement === nat);

    ok('the Team Builder behind is stale until the editor closes', /0\/4 moves/.test(d.querySelector('.team-slot').textContent));
    e.key('Escape');
    ok('Escape closes the editor', e.$('overlay').hidden);
    ok('closing it refreshed the Team Builder (move count and nature)',
      /1\/4 moves/.test(d.querySelector('.team-slot').textContent) && /Adamant/.test(d.querySelector('.team-slot').textContent));
    ok("focus went back to the member's Edit button", !!d.activeElement && d.activeElement.dataset.edit === '1');
    eq('exactly one Team Builder slot for the member', d.querySelectorAll('.team-slot:not(.empty)').length, 1);

    e.click(d.querySelector('[data-edit="1"]'));
    await waitFor(() => d.querySelector('[data-ldclose]'));
    const lvl = d.querySelector('[data-ld="level"]');
    lvl.value = '55'; lvl.dispatchEvent(new e.w.Event('input', { bubbles: true }));
    e.click(d.querySelector('[data-ldclose]'));
    ok('Done refreshes the Team Builder too', /Lv 55/.test(d.querySelector('.team-slot').textContent));
  }

  /* ============================================================== */
  console.log('\n--- batch 2 focus preservation x batch 4 dialog trap and keyboard handlers ---');
  {
    const e = await boot();
    const { d } = e;
    const card1 = d.querySelector('.poke-card[data-open="1"]');
    card1.focus();
    e.click(card1);
    await waitFor(() => !e.$('overlay').hidden && e.$('modalContent').textContent.includes('About'));
    e.click(d.querySelector('[data-tab="stats"]'));
    await waitFor(() => e.$('actualStats'));
    const lvl = e.$('modalContent').querySelector('input[data-calc]');
    ok('the modal Stats tab has a number input', !!lvl);
    lvl.focus();
    lvl.value = '5'; lvl.dispatchEvent(new e.w.Event('input', { bubbles: true }));
    ok('typing keeps focus on the same input (partial render)', d.activeElement === lvl && lvl.isConnected);
    const slash = e.key('/', lvl);
    ok('"/" typed in a field is not hijacked', !slash.defaultPrevented && d.activeElement === lvl);
    e.key('ArrowLeft', lvl);
    ok('arrow keys in a field do not flip the Pokémon', /001/.test(e.$('modalContent').querySelector('.detail-number')?.textContent || ''));
    const items = [...e.$('detailModal').querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')];
    items[items.length - 1].focus();
    const tab = e.key('Tab', items[items.length - 1]);
    ok('Tab from the last control wraps to the first, inside the dialog', tab.defaultPrevented && e.$('detailModal').contains(d.activeElement));
    const tabBtn = d.querySelector('[data-tab="matchups"]');
    tabBtn.focus(); e.click(tabBtn);
    ok('switching tabs leaves focus inside the dialog', e.$('detailModal').contains(d.activeElement));
    e.key('Escape');
    ok('Escape closes', e.$('overlay').hidden);
    ok('focus returned to the card that opened it', !!d.activeElement && d.activeElement.closest('.poke-card')?.dataset.open === '1');
  }

  console.log('\n--- chain order of the data-* actions ---');
  {
    const e = await boot();
    const { d } = e;
    for (const sel of ['[data-fav]', '[data-catch]', '[data-team]']) {
      e.click(d.querySelector('.poke-card[data-open="5"] ' + sel));
      ok(`${sel} inside a card does not also open the modal`, e.$('overlay').hidden);
    }
    /* Every attribute the click chain tests for, and every action the app renders, must match up. */
    const handled = new Set([...appjs.matchAll(/hit\('\[data-([a-z0-9-]+)\]'\)/g)].map(m => m[1]));
    const rendered = new Set([...appjs.matchAll(/\bdata-([a-z0-9-]+)=/g)].map(m => m[1]));
    const notActions = new Set(['val', 'picker', 'cats', 'calc', 'ld', 'iv', 'ev', 'moveslot', 'form', 'pal', 'move', 'ability']);
    const unhandled = [...rendered].filter(k => !handled.has(k) && !notActions.has(k));
    eq('every rendered data-* action has a branch in the click chain', unhandled, []);
    const order = [...appjs.matchAll(/hit\('\[data-([a-z0-9-]+)\]'\)/g)].map(m => m[1]);
    const idx = k => order.indexOf(k);
    ok('[data-team] is tested before [data-open]', idx('team') < idx('open'));
    ok('[data-entity] is tested before [data-open]', idx('entity') < idx('open'));
    ok('[data-retryinit] and [data-teamretry] are separate attributes from [data-retry]', idx('retryinit') >= 0 && idx('teamretry') >= 0 && idx('retry') >= 0);
  }

  finish(fail, allErrs.flat(), 'All integration tests passed');
})().catch(crash);
