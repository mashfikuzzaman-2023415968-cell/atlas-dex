/* Batch 4: navigation, accessibility, stale UI, moves tab, legendary data.
   Every case boots the real index.html + app.js in a fresh jsdom with a mocked
   fetch. Assertions are exact; waits poll for a condition instead of sleeping. */
const fs = require('fs'), { JSDOM } = require('jsdom');
const path = require('path');
const { waitFor, trackErrors, finish, crash } = require('./harness');
const allErrs = [];
const dir = path.resolve(__dirname, '..');
const html = fs.readFileSync(dir + '/index.html', 'utf8');
const appjs = fs.readFileSync(dir + '/app.js', 'utf8');
const css = fs.readFileSync(dir + '/styles.css', 'utf8');

/* ---- mock PokéAPI ------------------------------------------------- */
const N = 1025;
/* Hyphenated species and a species that is a prefix of another. */
const NAMES = { 122: 'mr-mime', 137: 'porygon', 474: 'porygon-z', 784: 'kommo-o', 785: 'tapu-koko' };
const specName = id => NAMES[id] || 'mon' + id;
/* variety id -> [name, species id] */
const VARIETY = { 10168: ['mr-mime-galar', 122], 10128: ['kommo-o-totem', 784] };
const EXTRA_VARIETIES = { 122: [10168], 784: [10128] };

const TY = ['fire', 'water', 'grass', 'electric', 'flying', 'steel', 'ghost', 'dragon'];
const vg = (n, method, level) => ({ level_learned_at: level, move_learn_method: { name: method },
  version_group: { name: 'vg' + n, url: 'https://pokeapi.co/api/v2/version-group/' + n + '/' } });
const MOVES_OF_1 = [
  /* level-up in two games (the newer one wins) and TM in another */
  { move: { name: 'ember' }, version_group_details: [vg(1, 'level-up', 5), vg(2, 'machine', 0), vg(3, 'level-up', 12)] },
  /* listed oldest-last on purpose: the higher version-group id is the newer game */
  { move: { name: 'tackle' }, version_group_details: [vg(7, 'level-up', 30), vg(4, 'level-up', 9)] },
  { move: { name: 'surf' }, version_group_details: [vg(5, 'tutor', 0)] }
];
const mkPoke = (id, name, sid, types) => ({
  id, name, height: 10, weight: 100, base_experience: 60, species: { url: '/pokemon-species/' + sid + '/' },
  types: types.map(t => ({ type: { name: t } })),
  stats: [['hp', 60], ['attack', 80], ['defense', 70], ['special-attack', 90], ['special-defense', 75], ['speed', 100]]
    .map(([n, v]) => ({ base_stat: v, effort: 0, stat: { name: n } })),
  abilities: [{ ability: { name: 'blaze' }, is_hidden: false }],
  moves: id === 1 ? MOVES_OF_1
    : [{ move: { name: 'ember' }, version_group_details: [vg(1, 'level-up', 7)] }],
  sprites: { other: { 'official-artwork': { front_default: 'x.png', front_shiny: 's.png' } } },
  cries: { latest: 'c.ogg' }
});

function makeFetch(opts) {
  return async url => {
    let data;
    if (url.includes('pokemon-species?')) {
      if (opts.failSpecies) throw Error('offline');
      data = { results: Array.from({ length: N }, (_, i) =>
        ({ name: specName(i + 1), url: '/pokemon-species/' + (i + 1) + '/' })) };
    } else if (url.includes('/pokemon-species/')) {
      const sid = +url.match(/pokemon-species\/(\d+)/)[1];
      const varieties = [{ is_default: true, pokemon: { name: specName(sid), url: '/pokemon/' + sid + '/' } }]
        .concat((EXTRA_VARIETIES[sid] || []).map(v => ({ is_default: false,
          pokemon: { name: VARIETY[v][0], url: '/pokemon/' + v + '/' } })));
      data = { name: specName(sid), id: sid, gender_rate: 4, capture_rate: 45, hatch_counter: 20, base_happiness: 50,
        egg_groups: [{ name: 'monster' }], growth_rate: { name: 'medium-slow' }, habitat: { name: 'forest' },
        shape: { name: 'upright' }, varieties, is_legendary: false, is_mythical: false, is_baby: false,
        flavor_text_entries: [{ language: { name: 'en' }, flavor_text: 'A test mon.' }],
        genera: [{ language: { name: 'en' }, genus: 'Test Pokémon' }], evolution_chain: { url: '/evolution-chain/1/' } };
    } else if (url.includes('/evolution-chain/')) {
      data = { chain: { species: { name: 'mon1', url: '/pokemon-species/1/' }, evolves_to: [] } };
    } else if (url.includes('/move/')) {
      data = { name: 'ember', power: 40, accuracy: 100, pp: 25, priority: 0, type: { name: 'fire' },
        damage_class: { name: 'special' }, effect_entries: [{ language: { name: 'en' }, short_effect: 'Burns.' }],
        learned_by_pokemon: [] };
    } else if (url.includes('/ability/')) {
      data = { effect_entries: [{ language: { name: 'en' }, short_effect: 'Powers up Fire moves.' }] };
    } else if (url.match(/\/pokemon\/(\d+)/)) {
      const id = +url.match(/\/pokemon\/(\d+)/)[1];
      const [name, sid] = VARIETY[id] || [specName(id), id];
      data = mkPoke(id, name, sid, [TY[id % TY.length], TY[(id + 3) % TY.length]]);
    } else data = {};
    return { ok: true, json: async () => data };
  };
}

/* ---- boot a fresh app --------------------------------------------- */
async function boot(opts = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://x.test/' + (opts.hash || ''), pretendToBeVisual: true });
  const w = dom.window;
  ['AbortController', 'setTimeout', 'clearTimeout'].forEach(k => { if (!w[k]) w[k] = global[k]; });
  w.fetch = makeFetch(opts);
  w.Audio = function () { return { play: async () => {} }; };
  w.confirm = () => true;
  w.CSS = { escape: s => String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&') };
  w.scrollTo = () => {};
  w.localStorage.clear();
  if (opts.theme) w.localStorage.setItem('atlasdex:theme', JSON.stringify(opts.theme));
  if (opts.matchLight !== undefined) {
    w.matchMedia = q => ({ matches: opts.matchLight, media: q, addEventListener() {}, removeEventListener() {} });
  }
  const errs = trackErrors(w);
  allErrs.push(errs);
  w.eval(appjs);
  const d = w.document;
  const app = { w, d, errs, $: id => d.getElementById(id) };
  app.key = (key, target, extra = {}) => {
    const ev = new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
    (target || d.activeElement || d.body).dispatchEvent(ev);
    return ev;
  };
  app.click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  app.focusClick = el => { el.focus(); app.click(el); };
  if (!opts.noWait) await waitFor(() => d.querySelectorAll('.poke-card').length > 0 || d.getElementById('retryInit'), 3000);
  return app;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

let fail = 0;
const ok = (label, cond) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) fail++; };
const eq = (label, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log((pass ? '  PASS  ' : '  FAIL  ') + label + (pass ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`));
  if (!pass) fail++;
};
/* Identity check, for DOM nodes (JSON.stringify would call every node "{}"). */
const is = (label, got, want) => {
  const pass = got === want && got != null;
  console.log((pass ? '  PASS  ' : '  FAIL  ') + label);
  if (!pass) fail++;
};

/* A section that throws is reported as a failure and the run continues, so one
   broken feature cannot hide the verdict on the others. */
async function sec(title, fn) {
  console.log('\n' + title);
  try { await fn(); } catch (e) { console.log('  FAIL  section threw: ' + (e && e.message || e)); fail++; }
}

/* Escape closes whatever is open, between cases. */
const closeAll = a => { if (!a.$('overlay').hidden) a.key('Escape', a.d.body); };
const modalTitle = a => a.d.querySelector('#modalContent h2')?.textContent.replace(/\s+/g, ' ').trim();

(async () => {
  /* ================= 4.2 init() is re-runnable ================= */
  await sec('4.2 init() is safe to re-run', async () => {
    const opts = { failSpecies: true };
    const a = await boot(opts);
    const { d } = a;
    const retryBtn = () => d.getElementById('retryInit');
    ok('boot failure shows a Try again button', !!retryBtn());
    ok('the button is a delegated data-* action, not a per-element listener', retryBtn()?.hasAttribute('data-retryinit') === true);
    eq('type filter populated once (All + 18 types)', d.querySelectorAll('#typeFilter option').length, 19);
    eq('generation filter populated once (All + 9)', d.querySelectorAll('#genFilter option').length, 10);
    eq('sidebar generation buttons built once', d.querySelectorAll('#sideGens .genitem').length, 9);

    /* A second failed attempt, then a successful one. */
    a.click(retryBtn());
    await waitFor(() => d.getElementById('status').textContent === 'Unable to load Pokémon data' && retryBtn());
    eq('type options after a failed retry', d.querySelectorAll('#typeFilter option').length, 19);
    opts.failSpecies = false;
    a.click(retryBtn());
    ok('retry recovers and renders cards', await waitFor(() => d.querySelectorAll('.poke-card').length === 36));
    eq('type options after a successful retry', d.querySelectorAll('#typeFilter option').length, 19);
    eq('generation options after a successful retry', d.querySelectorAll('#genFilter option').length, 10);
    eq('sidebar generation buttons after a successful retry', d.querySelectorAll('#sideGens .genitem').length, 9);
    eq('species total shown after retry', a.$('totalStat').textContent, '1,025');
    eq('no uncaught errors', a.errs, []);
  });

  /* ================= 4.3 hyphenated name chips ================= */
  await sec('4.3 name chips resolve hyphenated species and varieties', async () => {
    const a = await boot();
    const { d } = a;
    const chip = name => {
      const s = d.createElement('span');
      s.className = 'pill'; s.dataset.openname = name; d.body.appendChild(s); a.click(s); s.remove();
    };
    const toastText = () => a.$('toast').textContent;

    chip('mr-mime-galar');
    ok('mr-mime-galar opens Mr Mime on the Galar form',
      await waitFor(() => modalTitle(a) === 'Mr Mime · Galar'));
    eq('the Galar form chip is the selected one',
      d.querySelector('.formchip.on')?.textContent.trim(), 'Galar');
    closeAll(a);

    chip('kommo-o-totem');
    ok('kommo-o-totem opens Kommo O on the Totem form',
      await waitFor(() => modalTitle(a) === 'Kommo O · Totem'));
    closeAll(a);

    chip('tapu-koko');
    ok('tapu-koko (a hyphenated species) opens as itself',
      await waitFor(() => modalTitle(a) === 'Tapu Koko'));
    eq('no not-found toast for tapu-koko', toastText().includes('not in the species list'), false);
    closeAll(a);

    /* 'porygon' and 'porygon-z' are both species: the longest match must win. */
    chip('porygon-z');
    ok('porygon-z opens species 474, not porygon', await waitFor(() => modalTitle(a) === 'Porygon Z'));
    eq('porygon-z modal is species 474', d.querySelector('.detail-number')?.textContent.startsWith('#0474'), true);
    closeAll(a);

    chip('mr-mime-bogus');
    ok('an unknown form still opens the species', await waitFor(() => modalTitle(a) === 'Mr Mime'));
    closeAll(a);

    chip('definitely-not-a-pokemon');
    await sleep(30);
    ok('a name with no species toasts and opens nothing',
      toastText().includes('not in the species list') && a.$('overlay').hidden);
    eq('no uncaught errors', a.errs, []);
  });

  /* ================= 4.4 malformed hash ================= */
  await sec('4.4 malformed #/move/<name> hash', async () => {
    const a = await boot();
    const { w, d } = a;
    w.location.hash = '#/team';
    await waitFor(() => !a.$('panel').hidden);
    w.location.hash = '#/move/%E0%A4%A';
    ok('falls back to the home view', await waitFor(() => !a.$('listSection').hidden && a.$('panel').hidden));
    eq('hash is reset to #/', w.location.hash, '#/');
    eq('no URIError escaped', a.errs, []);
    eq('no modal opened', a.$('overlay').hidden, true);

    /* A well-formed escape still works. */
    w.location.hash = '#/move/em%62er';
    ok('a valid encoded entity hash still opens the move', await waitFor(() => !a.$('overlay').hidden));
    eq('decoded to ember', modalTitle(a), 'Ember');
  });

  /* ================= 4.5 the "/" shortcut ================= */
  await sec('4.5 "/" shortcut', async () => {
    const a = await boot();
    const { w, d } = a;
    w.location.hash = '#/team';
    await waitFor(() => a.$('listSection').hidden);
    d.body.focus();
    const ev = a.key('/', d.body);
    ok('"/" from another view returns to the Pokédex and focuses search',
      await waitFor(() => d.activeElement === a.$('searchInput') && !a.$('listSection').hidden));
    eq('hash is #/', w.location.hash, '#/');
    eq('shortcut is consumed', ev.defaultPrevented, true);

    /* From the home view it just focuses. */
    a.$('searchInput').blur();
    a.key('/', d.body);
    eq('"/" on the list focuses search', d.activeElement === a.$('searchInput'), true);

    /* Typing "/" into a field must not be hijacked. */
    for (const id of ['typeFilter', 'sortFilter', 'searchInput']) {
      const el = a.$(id); el.focus();
      const e2 = a.key('/', el);
      eq(`"/" while focus is in #${id} is left alone`, d.activeElement === el && !e2.defaultPrevented, true);
    }
    a.$('typeFilter').focus();
    w.location.hash = '#/offline';
    await waitFor(() => a.$('listSection').hidden);
    a.$('typeFilter').focus();
    a.key('/', a.$('typeFilter'));
    await sleep(40);
    eq('"/" in a SELECT on another view does not navigate', w.location.hash, '#/offline');
    eq('no uncaught errors', a.errs, []);
  });

  /* ================= 4.6a accessible names ================= */
  await sec('4.6a icon-only buttons have accessible names', async () => {
    const a = await boot();
    const { d } = a;
    const named = b => (b.getAttribute('aria-label') || '').trim().length > 0 || /[A-Za-z]{2,}/.test(b.textContent);
    const unnamed = scope => [...d.querySelectorAll(scope + ' button')].filter(b => !named(b)).map(b => b.className);

    const card1 = d.querySelector('.poke-card[data-open="1"]');
    eq('catch button names the Pokémon', card1.querySelector('.catchbtn').getAttribute('aria-label'), 'Mark Mon1 as caught');
    eq('heart names the Pokémon', card1.querySelector('.heart').getAttribute('aria-label'), 'Add Mon1 to favorites');
    eq('team button names the Pokémon', card1.querySelector('[data-team]').getAttribute('aria-label'), 'Add Mon1 to team');
    eq('compare button names the Pokémon', card1.querySelector('[data-compare]').getAttribute('aria-label'), 'Compare Mon1');
    eq('no unnamed buttons in the grid', unnamed('#grid'), []);

    a.click(card1.querySelector('.heart'));
    eq('heart label follows its state', d.querySelector('.poke-card[data-open="1"] .heart').getAttribute('aria-label'), 'Remove Mon1 from favorites');

    /* The favorite click re-rendered the grid, so look the card up again. */
    a.click(d.querySelector('.poke-card[data-open="1"] [data-team]'));
    await waitFor(() => !a.$('teamDock').hidden);
    eq('team button label follows its state',
      d.querySelector('.poke-card[data-open="1"] [data-team]').getAttribute('aria-label'), 'Remove Mon1 from team');
    eq('dock slot is named', d.querySelector('.dock-slot').getAttribute('aria-label'), 'Open Mon1');
    eq('no unnamed buttons in the dock', unnamed('#dockSlots'), []);

    a.w.location.hash = '#/team';
    await waitFor(() => d.querySelector('.slot-remove'));
    eq('slot remove names the Pokémon', d.querySelector('.slot-remove').getAttribute('aria-label'), 'Remove Mon1 from team');
    eq('team slot open target is named', d.querySelector('.team-slot [role="button"]').getAttribute('aria-label'), 'View Mon1 details');
    eq('no unnamed buttons in the team builder', unnamed('#panel'), []);

    a.click(a.$('paletteButton'));
    eq('no unnamed buttons in the palette', unnamed('#paletteResults'), []);
    eq('palette rows read as their visible text',
      d.querySelector('.pal-row').getAttribute('aria-label'), 'Go Pokédex #/');
    a.key('Escape', d.activeElement);
    eq('modal close button is named', a.$('closeModal').getAttribute('aria-label'), 'Close details');
    eq('no uncaught errors', a.errs, []);
  });

  /* ================= 4.6b / 4.6e CSS ================= */
  await sec('4.6b focus ring and 4.6e reduced motion (stylesheet)', async () => {
    const ruleFor = sel => {
      const i = css.indexOf(sel + '{');
      return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
    };
    const ring = css.match(/\.poke-card:focus-visible,\s*\[role="button"\]\[tabindex\]:focus-visible\{([^}]*)\}/);
    ok('.poke-card and [role=button][tabindex] get a :focus-visible rule', !!ring);
    ok('the ring is an accent-coloured outline', !!ring && /outline:\s*3px solid var\(--accent\)/.test(ring[1]));
    ok('light mode has its own ring colour',
      /\.light \.poke-card:focus-visible,\s*\.light \[role="button"\]\[tabindex\]:focus-visible\{[^}]*outline-color:#[0-9a-f]{6}/.test(css));
    ok('narrow screens adjust the ring', /@media\(max-width:700px\)\{[^@]*\.poke-card:focus-visible/.test(css));
    const rm = css.match(/@media \(prefers-reduced-motion: reduce\)\{([\s\S]*?)\n\}/);
    ok('a prefers-reduced-motion block exists', !!rm);
    ok('it disables animations', !!rm && /animation:none!important/.test(rm[1]));
    ok('it disables transitions', !!rm && /transition:none!important/.test(rm[1]));
    ok('it applies to every element', !!rm && /\*,\*::before,\*::after\{/.test(rm[1]));
  });

  /* ================= 4.6c keyboard activation ================= */
  await sec('4.6c Enter and Space open any role=button with data-open', async () => {
    const a = await boot();
    const { d } = a;
    a.click(d.querySelector('.poke-card[data-open="2"] [data-team]'));
    a.w.location.hash = '#/team';
    await waitFor(() => d.querySelector('.team-slot [role="button"]'));
    const slot = d.querySelector('.team-slot [role="button"][data-open]');
    slot.focus();
    const e1 = a.key('Enter', slot);
    ok('Enter on a Team Builder slot opens the Pokémon', await waitFor(() => !a.$('overlay').hidden));
    eq('Enter was consumed', e1.defaultPrevented, true);
    ok('it is the right Pokémon', await waitFor(() => modalTitle(a) === 'Mon2'));
    closeAll(a);

    slot.focus();
    const e2 = a.key(' ', slot);
    ok('Space on a Team Builder slot opens the Pokémon', await waitFor(() => !a.$('overlay').hidden));
    eq('Space was consumed (no page scroll)', e2.defaultPrevented, true);
    closeAll(a);

    a.w.location.hash = '#/';
    await waitFor(() => !a.$('listSection').hidden);
    const card = d.querySelector('.poke-card[data-open="3"]');
    card.focus();
    a.key('Enter', card);
    ok('Enter on a card still opens it', await waitFor(() => modalTitle(a) === 'Mon3'));
    closeAll(a);

    /* A nested real button handles itself: the card must not also open. */
    const catchBtn = d.querySelector('.poke-card[data-open="4"] .catchbtn');
    catchBtn.focus();
    a.key('Enter', catchBtn);
    await sleep(40);
    eq('Enter on a button inside a card does not open the card', a.$('overlay').hidden, true);
    eq('no uncaught errors', a.errs, []);
  });

  /* ================= 4.6d dialog focus ================= */
  await sec('4.6d dialog focus: in, trapped, restored', async () => {
    const a = await boot();
    const { d } = a;
    const card = d.querySelector('.poke-card[data-open="5"]');
    card.focus();
    a.click(card);
    await waitFor(() => modalTitle(a) === 'Mon5');
    is('opening the modal moves focus to its close button', d.activeElement, a.$('closeModal'));

    const focusables = () => [...a.$('detailModal').querySelectorAll('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')];
    const last = focusables().pop();
    last.focus();
    const t1 = a.key('Tab', last);
    is('Tab on the last control wraps to the first', d.activeElement, focusables()[0]);
    eq('the wrap is a handled event', t1.defaultPrevented, true);
    const t2 = a.key('Tab', d.activeElement, { shiftKey: true });
    is('Shift+Tab on the first control wraps to the last', d.activeElement, last);
    eq('the reverse wrap is handled', t2.defaultPrevented, true);
    focusables()[2].focus();
    const t3 = a.key('Tab', d.activeElement);
    eq('Tab in the middle is left to the browser', t3.defaultPrevented, false);

    /* Focus that escaped (e.g. onto <body>) is pulled back in. */
    d.body.focus();
    a.key('Tab', d.body);
    eq('Tab with focus outside the dialog enters it', a.$('detailModal').contains(d.activeElement), true);

    /* Re-rendering a tab keeps focus inside the modal, on the same control. */
    const statsTab = d.querySelector('[data-tab="stats"]');
    a.focusClick(statsTab);
    ok('switching tab keeps focus on the equivalent tab button',
      d.activeElement.matches('[data-tab="stats"]') && a.$('detailModal').contains(d.activeElement));

    /* Existing behaviour: arrows page through Pokémon, Escape closes. */
    d.querySelector('#closeModal').focus();
    a.key('ArrowRight', d.activeElement);
    ok('ArrowRight still opens the next Pokémon', await waitFor(() => modalTitle(a) === 'Mon6'));
    a.key('Escape', d.activeElement);
    eq('Escape closes the modal', a.$('overlay').hidden, true);
    is('focus returns to the card that opened it', d.activeElement, card);

    /* Command palette */
    const pb = a.$('paletteButton');
    pb.focus();
    a.click(pb);
    is('opening the palette focuses its input', d.activeElement, a.$('paletteInput'));
    const rows = () => [...d.querySelectorAll('#paletteResults .pal-row')];
    const lastRow = rows().pop();
    lastRow.focus();
    const p1 = a.key('Tab', lastRow);
    is('Tab on the last palette row wraps to the input', d.activeElement, a.$('paletteInput'));
    eq('palette wrap is handled', p1.defaultPrevented, true);
    a.key('Tab', a.$('paletteInput'), { shiftKey: true });
    is('Shift+Tab on the input wraps to the last row', d.activeElement, lastRow);
    a.$('paletteInput').focus();
    a.key('ArrowDown', a.$('paletteInput'));
    eq('ArrowDown still moves the palette selection', d.querySelectorAll('#paletteResults .pal-row')[1].classList.contains('on'), true);
    a.key('Escape', a.$('paletteInput'));
    eq('Escape closes the palette', a.$('palette').hidden, true);
    is('focus returns to the palette button', d.activeElement, pb);

    /* Picking a palette result opens the modal; closing it hands focus back to the original opener. */
    pb.focus();
    a.click(pb);
    a.$('paletteInput').value = 'mon9'; a.$('paletteInput').dispatchEvent(new a.w.Event('input', { bubbles: true }));
    a.key('Enter', a.$('paletteInput'));
    await waitFor(() => modalTitle(a) === 'Mon9');
    a.key('Escape', d.activeElement);
    is('closing a modal opened from the palette restores focus to the palette opener', d.activeElement, pb);
    eq('no uncaught errors', a.errs, []);
  });

  /* ================= 4.6f theme button ================= */
  await sec('4.6f theme button shows the theme and follows the OS', async () => {
    const light = await boot({ matchLight: true });
    eq('no saved theme + OS light: body is light', light.d.body.classList.contains('light'), true);
    eq('button shows the sun in light mode', light.$('themeButton').textContent, '☀');
    eq('aria-pressed is true in light mode', light.$('themeButton').getAttribute('aria-pressed'), 'true');
    light.click(light.$('themeButton'));
    eq('toggle to dark: button shows the moon', light.$('themeButton').textContent, '☾');
    eq('toggle to dark: aria-pressed false', light.$('themeButton').getAttribute('aria-pressed'), 'false');
    eq('toggle stores the choice', light.w.localStorage.getItem('atlasdex:theme'), '"dark"');
    light.click(light.$('themeButton'));
    eq('toggle back to light: sun', light.$('themeButton').textContent, '☀');

    const dark = await boot({ matchLight: false });
    eq('no saved theme + OS dark: body is dark', dark.d.body.classList.contains('light'), false);
    eq('button shows the moon in dark mode', dark.$('themeButton').textContent, '☾');
    eq('aria-pressed is false in dark mode', dark.$('themeButton').getAttribute('aria-pressed'), 'false');

    const saved = await boot({ matchLight: true, theme: 'dark' });
    eq('a saved theme beats the OS preference', saved.d.body.classList.contains('light'), false);
    eq('saved dark shows the moon', saved.$('themeButton').textContent, '☾');

    const none = await boot();
    eq('without matchMedia the default is dark', none.d.body.classList.contains('light'), false);
    none.d.body.classList.add('light');            // what a backup import does
    ok('a theme change from elsewhere (import) re-syncs the button',
      await waitFor(() => none.$('themeButton').textContent === '☀' && none.$('themeButton').getAttribute('aria-pressed') === 'true'));
  });

  /* ================= 4.7a loadout editor refresh ================= */
  await sec('4.7a closing the loadout editor refreshes the Team Builder', async () => {
    const a = await boot();
    const { d, w } = a;
    a.click(d.querySelector('.poke-card[data-open="1"] [data-team]'));
    w.location.hash = '#/team';
    await waitFor(() => d.querySelector('.slot-edit'));
    const buildText = () => d.querySelector('.slot-build small.missing, .slot-build small.good, .slot-build small:last-child')?.textContent.replace(/\s+/g, ' ').trim();
    const lastSmall = () => [...d.querySelectorAll('.slot-build small')].pop().textContent.replace(/\s+/g, ' ').trim();
    eq('baseline slot summary', lastSmall(), '0/4 moves');

    const edit = async (ev, closer, expected, label) => {
      a.focusClick(d.querySelector('.slot-edit'));
      await waitFor(() => d.querySelector('[data-ev="attack"]'));
      const inp = d.querySelector('[data-ev="attack"]');
      inp.value = String(ev);
      inp.dispatchEvent(new w.Event('input', { bubbles: true }));
      if (label === 'Escape') {            // also give it a move, to check the move count
        const sel = d.querySelector('[data-moveslot="0"]');
        sel.value = 'ember';
        sel.dispatchEvent(new w.Event('change', { bubbles: true }));
        await waitFor(() => d.querySelector('[data-moveslot="0"]').value === 'ember');
      }
      closer();
      await waitFor(() => a.$('overlay').hidden);
      eq(`${label}: Team Builder shows the new build`, lastSmall(), expected);
      eq(`${label}: focus returns to the Edit build button`, d.activeElement?.matches?.('.slot-edit'), true);
    };
    await edit(100, () => a.key('Escape', d.activeElement), '1/4 moves · 100 EVs', 'Escape');
    await edit(200, () => a.click(a.$('overlay')), '1/4 moves · 200 EVs', 'backdrop click');
    await edit(252, () => a.click(a.$('closeModal')), '1/4 moves · 252 EVs', 'close button');
    await edit(76, () => a.click(d.querySelector('[data-ldclose]')), '1/4 moves · 76 EVs', 'Done');
    eq('no uncaught errors', a.errs, []);
  });

  /* ================= 4.7b favorite from the modal ================= */
  await sec('4.7b favoriting from the modal updates the card behind it', async () => {
    const a = await boot();
    const { d } = a;
    const card = d.querySelector('.poke-card[data-open="1"]');
    a.click(card);
    await waitFor(() => modalTitle(a) === 'Mon1');
    a.click(d.querySelector('#modalContent [data-fav="1"]'));
    const heart = () => d.querySelector('.poke-card[data-open="1"] .heart');
    eq('heart is filled', heart().textContent, '♥');
    eq('heart has the liked class', heart().classList.contains('liked'), true);
    eq('heart reports pressed', heart().getAttribute('aria-pressed'), 'true');
    eq('heart label names the action', heart().getAttribute('aria-label'), 'Remove Mon1 from favorites');
    is('the card was updated in place, not re-rendered', d.querySelector('.poke-card[data-open="1"]'), card);
    eq('favorites counter in the sidebar', a.$('favCount').textContent, '1');
    a.click(d.querySelector('#modalContent [data-fav="1"]'));
    eq('un-favoriting empties the heart again', heart().textContent, '♡');
    eq('and clears aria-pressed', heart().getAttribute('aria-pressed'), 'false');

    /* In the Favorites view an un-favorited card has to leave the grid. */
    a.click(d.querySelector('#modalContent [data-fav="1"]'));
    closeAll(a);
    a.w.location.hash = '#/favorites';
    await waitFor(() => d.querySelectorAll('.poke-card').length === 1);
    a.click(d.querySelector('.poke-card[data-open="1"]'));
    await waitFor(() => modalTitle(a) === 'Mon1');
    a.click(d.querySelector('#modalContent [data-fav="1"]'));
    eq('un-favoriting in the Favorites view removes the card', d.querySelectorAll('.poke-card[data-open="1"]').length, 0);
    eq('no uncaught errors', a.errs, []);
  });

  /* ================= 4.8 moves tab grouping ================= */
  await sec('4.8 moves are listed under every learn method', async () => {
    const a = await boot();
    const { d } = a;
    a.click(d.querySelector('.poke-card[data-open="1"]'));
    await waitFor(() => modalTitle(a) === 'Mon1');
    a.click(d.querySelector('[data-tab="moves"]'));
    const chips = () => [...d.querySelectorAll('.chip[data-method]')].map(c => c.textContent.trim());
    const rows = () => [...d.querySelectorAll('.moverow[data-move]')]
      .map(r => [r.dataset.move, r.querySelector('.mv-lv').textContent]);
    eq('method chips cover every method of every move', chips(), ['Level Up', 'Machine', 'Tutor']);
    eq('level-up lists each move that is learnable by level-up, newest game wins',
      rows().sort(), [['ember', '12'], ['tackle', '30']]);
    a.click(d.querySelector('[data-method="machine"]'));
    eq('ember also appears under Machine', rows(), [['ember', '—']]);
    a.click(d.querySelector('[data-method="tutor"]'));
    eq('tutor-only move appears under Tutor', rows(), [['surf', '—']]);
    ok('the summary line counts moves per method',
      d.querySelector('#modalContent .dex-desc:last-of-type').textContent.replace(/\s+/g, ' ').includes('Showing 1 of 1 Tutor moves'));
    a.click(d.querySelector('[data-method="level-up"]'));
    ok('Level Up summary counts two moves',
      d.querySelector('#modalContent .dex-desc:last-of-type').textContent.replace(/\s+/g, ' ').includes('Showing 2 of 2 Level Up moves'));
    eq('no uncaught errors', a.errs, []);
  });

  /* ================= 4.9 legendary data ================= */
  await sec('4.9 the legendary set mirrors PokéAPI', async () => {
    const EXPECTED = [144, 145, 146, 150, 151, 243, 244, 245, 249, 250, 251,
      377, 378, 379, 380, 381, 382, 383, 384, 385, 386,
      480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493, 494,
      638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649,
      716, 717, 718, 719, 720, 721,
      772, 773, 785, 786, 787, 788, 789, 790, 791, 792, 800, 801, 802, 807, 808, 809,
      888, 889, 890, 891, 892, 893, 894, 895, 896, 897, 898, 905,
      1001, 1002, 1003, 1004, 1007, 1008, 1014, 1015, 1016, 1017, 1024, 1025];
    eq('the expected list itself has 94 distinct ids', new Set(EXPECTED).size, 94);

    const a = await boot();
    const { d } = a;
    a.click(d.querySelector('[data-chip="legendary"]'));
    eq('the legendary chip counts exactly 94 species', a.$('resultCount').textContent, '94');
    let guard = 0;
    while (!a.$('loadMore').hidden && guard++ < 10) a.click(a.$('loadMore'));
    const ids = [...d.querySelectorAll('.poke-card')].map(c => Number(c.dataset.open));
    eq('exactly the 94 PokéAPI legendary/mythical ids', ids, EXPECTED);
    eq('Paradox species PokéAPI does not flag are excluded',
      [1009, 1010, 1020, 1021, 1022, 1023].filter(id => ids.includes(id)), []);
    eq('no uncaught errors', a.errs, []);
  });

  finish(fail, allErrs.flat(), 'all assertions ok');
})().catch(crash);
