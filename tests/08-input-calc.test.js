/* Batch 2: typing never loses focus, calculator number sanitising, the live Stats
   calculator picker, selects firing once, dex filters per kind, ball labels and the
   breeding catch chance. Each assertion is tagged with its spec item. */
const fs = require('fs'), path = require('path'), { JSDOM } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const { waitFor, trackErrors, finish, crash } = require('./harness');
const dir = path.resolve(__dirname, '..');
const html = fs.readFileSync(dir + '/index.html', 'utf8');
const appjs = fs.readFileSync(dir + '/app.js', 'utf8');

let fail = 0;
const ok = (label, cond) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) fail++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const errs = [];
/* harness.js feeds rejected promises and page errors into errs; a dummy window
   registers the shared array once. */
trackErrors({ addEventListener() {} }, errs);
process.on('uncaughtException', e => errs.push('uncaughtException: ' + (e && e.message || e)));

/* ---- mock PokéAPI ---------------------------------------------------- */
const TY = ['fire', 'water', 'grass', 'electric', 'flying', 'steel', 'ghost', 'dragon'];
const MOVEDB = {
  ember: ['fire', 40, 'special'], flamethrower: ['fire', 90, 'special'], surf: ['water', 90, 'special'],
  thunderbolt: ['electric', 90, 'special'], tackle: ['normal', 40, 'physical'], 'nasty-plot': ['dark', null, 'status']
};
const ITEMDB = { potion: 'healing', 'oran-berry': 'berries', 'fire-stone': 'evolution', leftovers: 'held-items' };
const mkPoke = (id, name, types) => ({
  id, name, height: 10, weight: 100, base_experience: 60,
  species: { url: '/pokemon-species/' + (id > 10000 ? 26 : id) + '/' },
  types: types.map(t => ({ type: { name: t } })),
  /* Every form shares HP 60 / Atk 108 except the Alolan form, so a switch is visible. */
  stats: [['hp', 60, 1], ['attack', id === 10100 ? 150 : 108, 2], ['defense', 70, 0], ['special-attack', 90, 0],
    ['special-defense', 75, 0], ['speed', 100, 0]].map(([n, v, e]) => ({ base_stat: v, effort: e, stat: { name: n } })),
  abilities: [{ ability: { name: 'blaze' }, is_hidden: false }],
  moves: ['ember', 'tackle', 'surf'].map(n => ({ move: { name: n },
    version_group_details: [{ level_learned_at: 7, move_learn_method: { name: 'level-up' } }] })),
  sprites: { other: { 'official-artwork': { front_default: 'x.png', front_shiny: 's.png' } } }, cries: { latest: 'c.ogg' }
});

function boot() {
  const reqs = [];
  const fetchMock = async url => {
    reqs.push(url);
    let data = {};
    const m = s => url.includes(s);
    if (m('pokemon-species?')) data = { results: Array.from({ length: 60 }, (_, i) => ({ name: 'mon' + (i + 1), url: '/pokemon-species/' + (i + 1) + '/' })) };
    else if (m('/move?limit')) data = { results: Object.keys(MOVEDB).map((n, i) => ({ name: n, url: '/move/' + (i + 1) + '/' })) };
    else if (m('/ability?limit')) data = { results: ['blaze', 'torrent'].map((n, i) => ({ name: n, url: '/ability/' + (i + 1) + '/' })) };
    else if (m('/item?limit')) data = { results: Object.keys(ITEMDB).map((n, i) => ({ name: n, url: '/item/' + (i + 1) + '/' })) };
    else if (m('/egg-group/')) data = { pokemon_species: [{ name: 'mon1' }] };
    else if (m('/encounters')) data = [];
    else if (m('/move/')) {
      const n = url.split('/move/')[1].replace(/\/$/, ''); const [type, power, cls] = MOVEDB[n] || MOVEDB.tackle;
      data = { name: n, power, accuracy: 100, pp: 15, priority: 0, type: { name: type }, damage_class: { name: cls },
        effect_entries: [{ language: { name: 'en' }, short_effect: 'Deals damage.' }], learned_by_pokemon: [] };
    } else if (m('/ability/')) {
      const n = url.split('/ability/')[1].replace(/\/$/, '');
      data = { name: n, generation: { name: 'generation-iii' }, effect_entries: [{ language: { name: 'en' }, short_effect: 'Powers up.' }], pokemon: [] };
    } else if (m('/item/')) {
      const n = url.split('/item/')[1].replace(/\/$/, '');
      data = { name: n, cost: 200, category: { name: ITEMDB[n] || 'healing' }, sprites: { default: 'i.png' },
        effect_entries: [{ language: { name: 'en' }, short_effect: 'Restores HP.' }], held_by_pokemon: [] };
    } else if (m('/pokemon-species/')) {
      const sid = +url.match(/pokemon-species\/(\d+)/)[1];
      const varieties = sid === 26
        ? [{ is_default: true, pokemon: { name: 'raichu', url: '/pokemon/26/' } }, { is_default: false, pokemon: { name: 'raichu-alola', url: '/pokemon/10100/' } }]
        : [{ is_default: true, pokemon: { name: 'mon' + sid, url: '/pokemon/' + sid + '/' } }];
      data = { name: sid === 26 ? 'raichu' : 'mon' + sid, id: sid, gender_rate: 4, capture_rate: 45, hatch_counter: 20, base_happiness: 50,
        egg_groups: [{ name: 'monster' }], growth_rate: { name: 'medium-slow' }, habitat: { name: 'forest' }, shape: { name: 'upright' },
        varieties, is_legendary: false, is_mythical: false, is_baby: false,
        flavor_text_entries: [{ language: { name: 'en' }, flavor_text: 'A test mon.' }],
        genera: [{ language: { name: 'en' }, genus: 'Test' }], evolution_chain: { url: '/evolution-chain/1/' } };
    } else if (m('/evolution-chain/')) data = { chain: { species: { name: 'mon1', url: '/pokemon-species/1/' }, evolves_to: [] } };
    else if (url.match(/\/pokemon\/(\d+)\/?$/)) {
      const id = +url.match(/\/pokemon\/(\d+)/)[1];
      data = id === 10100 ? mkPoke(10100, 'raichu-alola', ['electric', 'psychic']) : mkPoke(id, id === 26 ? 'raichu' : 'mon' + id, [TY[id % TY.length], TY[(id + 3) % TY.length]]);
    }
    return { ok: true, json: async () => data };
  };

  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://x.test/', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = fetchMock; w.indexedDB = new IDBFactory(); w.IDBKeyRange = IDBKeyRange;
  w.Audio = function () { return { play: async () => {} }; };
  w.confirm = () => true; w.prompt = () => 'T';
  w.CSS = { escape: s => String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&') };
  w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
  Object.defineProperty(w.navigator, 'onLine', { value: true, configurable: true });
  w.navigator.storage = { estimate: async () => ({ usage: 5e7, quota: 2e9 }), persist: async () => true };
  w.navigator.clipboard = { writeText: async () => {} };
  w.localStorage.clear();
  trackErrors(w, errs);
  w.eval(appjs);
  const d = w.document, $ = id => d.getElementById(id);
  const ev = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
  return {
    w, d, $, reqs, ev,
    click: el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })),
    typeIn: (el, v) => { el.value = v; ev(el, 'input'); },
    chg: (el, v) => { el.value = v; ev(el, 'change'); },
    q: s => d.querySelector(s), qa: s => [...d.querySelectorAll(s)],
    go: async hash => { w.location.hash = hash; await wait(30); }
  };
}

/* Types each prefix of `text` into `el`, checking focus and identity after every key. */
async function typeCharByChar(c, el, text, label, check) {
  el.focus();
  for (let i = 1; i <= text.length; i++) {
    const partial = text.slice(0, i);
    c.typeIn(el, partial);
    ok(`${label}: "${partial}" keeps the very same element focused`, c.d.activeElement === el && el.isConnected);
    if (check) await check(partial);
  }
}
const rowsOf = c => c.qa('#calcResult .statrow b, #actualStats .statrow b').map(b => b.textContent);
const resultText = c => c.q('#calcResult .result-card strong').textContent;

/* A section that throws (for example because an element a fix introduces is missing)
   is reported as a failure and the run carries on, so one broken item cannot hide
   the others. */
async function section(name, fn) {
  console.log(`\n--- ${name} ---`);
  try { await fn(); } catch (e) { ok(`section threw: ${e && e.message}`, false); }
}
let c, obs, fullHp;
const hpAt = { 1: '12', 10: '35', 100: '261' }, atkAt = { 1: '7', 10: '31', 100: '277' };

(async () => {
  /* ================================================================ */
  await section('2.1a  dex search box keeps focus', async () => {
  c = boot();
  /* The app routes once more when its species list arrives; wait for that so the
     test's own navigation is not repeated underneath it. */
  await waitFor(() => c.qa('.poke-card').length > 0);
  await c.go('#/moves');
  ok('moves dex shell renders', await waitFor(() => c.$('brSearch') && c.qa('.dexrow[data-entity]').length === 6));
  const search = c.$('brSearch');
  ok('[2.1a] rows hydrate (power shown)', await waitFor(() => /\b90\b/.test(c.$('brResults').innerHTML)));
  ok('[2.1a] hydration did not replace the search box', c.$('brSearch') === search);
  ok('[2.1a] result count shown in the heading', c.$('brCount').textContent === '6');
  await typeCharByChar(c, search, 'nasty', '[2.1a] search', async partial => {
    await wait(260);   // past the 180 ms debounce
    ok(`[2.1a] "${partial}" repaints the results`, c.$('brSearch') === search
      && c.qa('.dexrow[data-entity]').length === (partial === 'n' ? 2 : 1));
  });
  ok('[2.1a] only matching row remains', c.qa('.dexrow[data-entity]').length === 1 && c.$('brCount').textContent === '1');
  c.typeIn(search, ''); await wait(260);
  ok('[2.1a] clearing the search restores all rows', c.qa('.dexrow[data-entity]').length === 6 && c.d.activeElement === search);
  c.chg(c.$('brFilter'), 'fire');
  ok('[2.1a] a filter change leaves the search box in place', c.$('brSearch') === search && c.d.activeElement === search);
  ok('[2.1a] filter applies to the table', c.qa('.dexrow[data-entity]').length === 2 && c.$('brCount').textContent === '2');
  c.chg(c.$('brSort'), 'power');
  ok('[2.1a] sort leaves the search box in place and orders by power',
    c.$('brSearch') === search && c.qa('.dexrow[data-entity] .dx-name')[0].textContent === 'Flamethrower');
  });

  await section('2.8  dex filters stay with their own page', async () => {
  await c.go('#/items');
  ok('items dex renders', await waitFor(() => c.qa('.dexrow.item[data-entity]').length === 4));
  ok('[2.8] Items dropdown starts at "All categories"', c.$('brFilter').value === '');
  ok('[2.8] the Moves filter did not leak onto Items (all 4 rows, no "Nothing matches")',
    c.qa('.dexrow.item[data-entity]').length === 4 && !c.$('panel').innerHTML.includes('Nothing matches'));
  ok('[2.8] item categories fill the dropdown as rows hydrate', await waitFor(() => c.qa('#brFilter option').length === 5));
  const itemSearch = c.$('brSearch');
  c.chg(c.$('brFilter'), 'berries');
  ok('[2.8] item filter applies', c.qa('.dexrow.item[data-entity]').length === 1 && c.$('brFilter').value === 'berries');
  ok('[2.8] item filter leaves the search box alone', c.$('brSearch') === itemSearch);
  await c.go('#/abilities');
  ok('abilities dex renders', await waitFor(() => c.qa('.dexrow.ability[data-entity]').length === 2));
  ok('[2.8] abilities are not filtered by the Items choice', !c.$('panel').innerHTML.includes('Nothing matches'));
  await c.go('#/moves');
  ok('[2.8] returning to Moves restores its own filter in the dropdown', await waitFor(() => c.$('brFilter') && c.$('brFilter').value === 'fire'));
  ok('[2.8] ...and its sort', c.$('brSort').value === 'power');
  ok('[2.8] ...and the rows match what the dropdown says', c.qa('.dexrow[data-entity]').length === 2);
  ok('[2.8] search restarts on every visit', c.$('brSearch').value === '');
  await c.go('#/items');
  ok('[2.8] returning to Items restores its own filter', await waitFor(() => c.$('brFilter') && c.$('brFilter').value === 'berries'));
  ok('[2.8] ...with matching rows', c.qa('.dexrow.item[data-entity]').length === 1);
  c.chg(c.$('brFilter'), '');
  ok('[2.8] clearing the filter lists everything again', c.qa('.dexrow.item[data-entity]').length === 4);
  });

  await section('2.3  the Stats calculator picks a Pokémon', async () => {
  await c.go('#/calc');
  ok('calculators render', await waitFor(() => c.$('calcBody')));
  ok('[2.3] the dead hint is gone', !c.$('panel').innerHTML.includes('team button'));
  ok('[2.3] picker input present', !!c.$('calcMonInput'));
  ok('[2.3] picker datalist lists every species', c.qa('#calcMonList option').length === 60);
  ok('[2.3] nothing chosen, no team, no modal: empty state invites a pick', c.$('calcResult').innerHTML.includes('No Pokémon chosen yet'));
  ok('[2.3] no team chips without a team', c.qa('[data-calcmon]').length === 0);

  /* Default: the Pokémon last shown in the detail modal. */
  await c.go('#/pokemon/3');
  ok('modal opens', await waitFor(() => c.$('modalContent').innerHTML.includes('About')));
  await c.go('#/');
  await c.go('#/calc');
  ok('[2.3] default is the Pokémon last shown in the modal (HP 135, Atk 140 at Lv50 Adamant)',
    await waitFor(() => rowsOf(c).length === 6) && rowsOf(c)[0] === '135' && rowsOf(c)[1] === '140');
  ok('[2.3] picker shows the default Pokémon', c.$('calcMonInput').value === 'Mon3');

  /* Team chips, including an alternate form. */
  await c.go('#/pokemon/26');
  await waitFor(() => c.$('modalContent').innerHTML.includes('About'));
  c.click(c.q('[data-form="10100"]'));
  await waitFor(() => c.q('[data-team="10100"]'));
  c.click(c.q('[data-team="10100"]'));
  await c.go('#/pokemon/3');
  await waitFor(() => c.$('modalContent').innerHTML.includes('About'));
  await c.go('#/'); await c.go('#/calc');
  await waitFor(() => rowsOf(c).length === 6);
  ok('[2.3] a team chip is offered for the alternate form', c.qa('[data-calcmon="10100"]').length === 1
    && /Raichu Alola/.test(c.q('[data-calcmon="10100"]').textContent));
  c.click(c.q('[data-calcmon="10100"]'));
  ok('[2.3] choosing a team form loads its own base stats (Atk 187)',
    await waitFor(() => rowsOf(c)[1] === '187'));
  ok('[2.3] the chip is marked as selected', c.q('[data-calcmon="10100"]').classList.contains('on'));
  ok('[2.3] the result names the form', c.$('calcResult').innerHTML.includes('Raichu Alola at level 50'));

  /* Typing in the picker. */
  const picker = c.$('calcMonInput');
  /* Mon5 is already cached from the grid; Mon50 is not, so it must be fetched exactly once. */
  const before50 = c.reqs.filter(u => /\/pokemon\/50$/.test(u)).length;
  await typeCharByChar(c, picker, 'Mon50', '[2.3] picker');
  ok('[2.3] choosing from the datalist loads that Pokémon through get()',
    await waitFor(() => rowsOf(c)[1] === '140') && c.reqs.filter(u => /\/pokemon\/50$/.test(u)).length === before50 + 1);
  ok('[2.3] typing in the picker does not replace it', c.$('calcMonInput') === picker && c.d.activeElement === picker);
  ok('[2.3] picking a species clears the team chip highlight', c.qa('[data-calcmon].on').length === 0);
  c.typeIn(picker, 'zzz'); c.chg(picker, 'zzz');
  ok('[2.3] leaving the picker on a non-species restores the chosen Pokémon', picker.value === 'Mon50');
  ok('[2.3] an unknown name does not change the result', rowsOf(c)[1] === '140');
  });

  await section('2.1b/2.2  Stats calculator: typing, focus and sanitising', async () => {
  const lv = c.q('[data-calc="level"]');
  await typeCharByChar(c, lv, '100', '[2.1b] level', async partial => {
    const n = Number(partial);
    ok(`[2.1b] level ${partial}: HP ${hpAt[n]} and Atk ${atkAt[n]} update`, rowsOf(c)[0] === hpAt[n] && rowsOf(c)[1] === atkAt[n]);
  });
  ok('[2.1b] the panel itself was never replaced', c.q('[data-calc="level"]') === lv);
  c.typeIn(lv, '');
  ok('[2.2] clearing level while typing keeps the last valid value (still HP 261)', rowsOf(c)[0] === '261' && c.d.activeElement === lv);
  ok('[2.2] the heading still says level 100, not 0', c.$('calcResult').innerHTML.includes('at level 100'));
  c.ev(lv, 'change');
  ok('[2.2] on change the empty field shows the last valid value again', lv.value === '100');
  c.typeIn(lv, '999');
  ok('[2.2] an out-of-range level is clamped to 100', rowsOf(c)[0] === '261');
  c.ev(lv, 'change');
  ok('[2.2] on change the displayed level is normalised to 100', lv.value === '100');
  c.typeIn(lv, '0'); c.ev(lv, 'change');
  ok('[2.2] level 0 becomes 1 (HP 12)', rowsOf(c)[0] === '12' && lv.value === '1');
  c.typeIn(lv, '-7'); c.ev(lv, 'change');
  ok('[2.2] a negative level becomes 1', lv.value === '1');
  c.chg(lv, '50');
  ok('level back to 50', rowsOf(c)[0] === '135' && rowsOf(c)[1] === '140');

  const iv = c.q('[data-calc="iv"]'), evi = c.q('[data-calc="ev"]');
  c.typeIn(evi, '500'); c.ev(evi, 'change');
  ok('[2.2] EV above 252 is clamped, displayed as 252 and used (HP 167, Atk 176)',
    evi.value === '252' && rowsOf(c)[0] === '167' && rowsOf(c)[1] === '176');
  c.typeIn(evi, ''); c.ev(evi, 'change');
  ok('[2.2] clearing EV does not write 0: it keeps 252', evi.value === '252' && rowsOf(c)[0] === '167');
  c.typeIn(evi, '0'); c.ev(evi, 'change');
  ok('[2.2] an explicit 0 EV is a real value', evi.value === '0' && rowsOf(c)[0] === '135');
  c.typeIn(iv, '99'); c.ev(iv, 'change');
  ok('[2.2] IV above 31 is clamped to 31', iv.value === '31' && rowsOf(c)[0] === '135');
  c.typeIn(iv, '-3'); c.ev(iv, 'change');
  ok('[2.2] a negative IV becomes 0 (HP 120, Atk 124)', iv.value === '0' && rowsOf(c)[0] === '120' && rowsOf(c)[1] === '124');
  c.typeIn(iv, 'abc'); c.ev(iv, 'change');
  ok('[2.2] non-numeric IV keeps the last valid value', iv.value === '0' && rowsOf(c)[0] === '120');
  c.chg(iv, '31');
  ok('IV back to 31', rowsOf(c)[0] === '135');

  /* Selects: change only. */
  obs = new c.w.MutationObserver(() => {});
  obs.observe(c.$('calcBody'), { childList: true, subtree: true });
  const nature = c.q('[data-calc="nature"]');
  nature.value = 'jolly'; c.ev(nature, 'input');
  ok('[2.4] an input event on a select does nothing (no repaint, state untouched, Atk still 140)',
    obs.takeRecords().length === 0 && rowsOf(c)[1] === '140');
  c.ev(nature, 'change');
  /* Jolly is neutral on Attack: floor((216+31)*50/100)+5 = 128 */
  ok('[2.4] change repaints once and applies the nature (Atk 128)', obs.takeRecords().length === 1 && rowsOf(c)[1] === '128');
  c.ev(nature, 'input'); c.ev(nature, 'change');
  ok('[2.4] a real browser fires input then change: still a single repaint', obs.takeRecords().length === 1);
  obs.disconnect();
  c.chg(nature, 'adamant');
  });

  await section('2.1b/2.2/2.5  manual damage calculator', async () => {
  c.click(c.q('[data-calctab="damage"]'));
  ok('damage tab renders', await waitFor(() => c.q('[data-calc="dPower"]')));
  ok('[2.5] label names the Gen 6+ formula', /Gen 6\+ damage formula/.test(c.$('calcBody').textContent) && !/Gen 5\+ damage/.test(c.$('calcBody').textContent));
  const pw = c.q('[data-calc="dPower"]');
  /* L50, Atk 120, Def 100, STAB, no crit:
     power 1:   base floor(floor(22*1*120/100)/50)+2 = 2;   min floor(2*.85)=1 -> STAB 1;  max 2 -> STAB 3   => 1 - 3
     power 16:  base floor(422/50)+2 = 10;  min 8 -> 12;  max 10 -> 15                                      => 12 - 15
     power 160: base floor(4224/50)+2 = 86; min 73 -> pokeRound(109.5)=109; max 86 -> 129                    => 109 - 129 */
  const dmgAt = { 1: '1 – 3', 16: '12 – 15', 160: '109 – 129' };
  await typeCharByChar(c, pw, '160', '[2.1b] move power', async partial => {
    ok(`[2.1b] power ${partial}: damage ${dmgAt[partial]}`, resultText(c) === dmgAt[partial]);
  });
  ok('[2.1b] damage panel was not replaced', c.q('[data-calc="dPower"]') === pw);
  ok('[2.5] all 16 rolls are listed', (c.q('#calcResult .rolls').textContent.split(':')[1].match(/\d+/g) || []).length === 16);
  c.typeIn(pw, '');
  ok('[2.2] clearing move power keeps 160 (109 - 129)', resultText(c) === '109 – 129');
  c.typeIn(pw, '999'); c.ev(pw, 'change');
  /* power 250: base floor(6600/50)+2 = 134; min floor(134*.85)=113 -> STAB 169.5 rounds half down to 169; max 134 -> 201 */
  ok('[2.2] power above 250 clamps to 250, shown as 250', pw.value === '250' && resultText(c) === '169 – 201');
  c.typeIn(pw, '-1'); c.ev(pw, 'change');
  ok('[2.2] move power can be 0 (status): 0 – 0', pw.value === '0' && resultText(c) === '0 – 0');
  c.chg(pw, '160');
  const dl = c.q('[data-calc="dLevel"]'), da = c.q('[data-calc="dAtk"]'), dd = c.q('[data-calc="dDef"]'), dh = c.q('[data-calc="dHp"]');
  c.typeIn(dl, '0'); c.ev(dl, 'change');
  ok('[2.2] attacker level 0 becomes 1', dl.value === '1');
  c.typeIn(dl, '500'); c.ev(dl, 'change');
  ok('[2.2] attacker level above 100 becomes 100', dl.value === '100');
  c.chg(dl, '50');
  c.typeIn(da, '5000'); c.ev(da, 'change');
  ok('[2.2] attack above 999 becomes 999', da.value === '999');
  c.typeIn(dd, '0'); c.ev(dd, 'change');
  ok('[2.2] defence 0 becomes 1 (no division by zero)', dd.value === '1' && /^\d+ – \d+$/.test(resultText(c)));
  c.typeIn(dh, ''); c.ev(dh, 'change');
  ok('[2.2] clearing defender HP keeps the last valid value', dh.value === '200');
  c.chg(da, '120'); c.chg(dd, '100');
  ok('values restored', resultText(c) === '109 – 129');

  /* Selects and checkboxes. */
  const dtype = c.q('[data-calc="dType"]');
  obs = new c.w.MutationObserver(() => {}); obs.observe(c.$('calcBody'), { childList: true, subtree: true });
  dtype.value = '4'; c.ev(dtype, 'input');
  ok('[2.4] input on the type select does nothing', obs.takeRecords().length === 0 && resultText(c) === '109 – 129');
  c.ev(dtype, 'change');
  /* 4x with STAB: min 73 -> 109 -> 436 ; max 86 -> 129 -> 516 */
  ok('[2.4] change applies 4x once', obs.takeRecords().length === 1 && resultText(c) === '436 – 516');
  const crit = c.q('[data-calc="dCrit"]');
  crit.checked = true; c.ev(crit, 'input');
  ok('[2.4] a checkbox input event alone does nothing', obs.takeRecords().length === 0 && resultText(c) === '436 – 516');
  c.ev(crit, 'change');
  ok('[2.4] the checkbox change repaints once', obs.takeRecords().length === 1 && resultText(c) !== '436 – 516');
  obs.disconnect();
  c.chg(dtype, '1'); crit.checked = false; c.ev(crit, 'change');
  });

  await section('2.2/2.6/2.7  catch calculator', async () => {
  c.click(c.q('[data-calctab="catch"]'));
  ok('catch tab renders', await waitFor(() => c.q('[data-calc="cRate"]')));
  const opt = v => c.q(`[data-calc="cBall"] option[value="${v}"]`);
  ok('[2.7] Quick Ball label states its condition', /first turn only/.test(opt('Quick Ball').textContent) && /5x/.test(opt('Quick Ball').textContent));
  ok('[2.7] Dusk Ball label states its condition', /night or in caves/.test(opt('Dusk Ball').textContent));
  ok('[2.7] Net Ball label states its condition', /Water or Bug/.test(opt('Net Ball').textContent));
  ok('[2.7] Timer Ball label states its condition', /10\+ turns/.test(opt('Timer Ball').textContent));
  ok('[2.7] unconditional balls keep plain labels', opt('Poké Ball').textContent === 'Poké Ball' && opt('Ultra Ball').textContent === 'Ultra Ball');
  ok('[2.7] stored values unchanged and Poké Ball is the default', c.q('[data-calc="cBall"]').value === 'Poké Ball' && !!opt('Master Ball'));
  /* Rate 45 at full HP, Poké Ball: a = 15, b = 65536/(255/15)^(3/16) = 38517, p = (b/65536)^4 = 11.9% */
  ok('[2.6] calculator default (rate 45, full HP, Poké Ball) is 11.9%', resultText(c) === '11.9%');
  c.chg(c.q('[data-calc="cBall"]'), 'Quick Ball');
  ok('[2.7] a conditional ball says the result assumes its condition', /Assumes the ball's condition is met/.test(c.$('calcResult').textContent));
  c.chg(c.q('[data-calc="cBall"]'), 'Poké Ball');
  ok('[2.7] an unconditional ball has no such note', !/Assumes/.test(c.$('calcResult').textContent));
  const cr = c.q('[data-calc="cRate"]'), cm = c.q('[data-calc="cMaxHp"]'), ch = c.q('[data-calc="cHp"]');
  c.typeIn(cr, '1'); c.ev(cr, 'change');
  ok('[2.2] capture rate below 3 becomes 3', cr.value === '3');
  c.typeIn(cr, '9999'); c.ev(cr, 'change');
  /* rate 255 at full HP: a = 85, b = 65536/3^(3/16) = 53345, p = (b/65536)^4 = 43.9% */
  ok('[2.2] capture rate above 255 becomes 255 and is used (43.9%)', cr.value === '255' && resultText(c) === '43.9%');
  c.typeIn(cr, ''); c.ev(cr, 'change');
  ok('[2.2] clearing capture rate keeps 255', cr.value === '255');
  c.chg(cr, '45');
  ok('rate back to 45', resultText(c) === '11.9%');
  fullHp = resultText(c);
  c.typeIn(ch, '5000'); c.ev(ch, 'change');
  ok('[2.2] current HP is clamped to max HP (100)', ch.value === '100' && resultText(c) === fullHp);
  ch.focus(); c.typeIn(ch, '1');
  ok('[2.1b] catch panel keeps focus while typing', c.d.activeElement === ch && c.q('[data-calc="cHp"]') === ch);
  ok('[2.1b] low HP raises the chance as you type', parseFloat(resultText(c)) > 11.9);
  c.chg(ch, '100');
  c.typeIn(cm, '50'); c.ev(cm, 'change');
  ok('[2.2] lowering max HP drags current HP down with it', ch.value === '50' && cm.value === '50');
  ok('[2.2] ...and the max attribute of current HP follows the new max', ch.getAttribute('max') === '50');
  c.typeIn(ch, '70'); c.ev(ch, 'change');
  ok('[2.2] current HP above the new max is clamped to 50', ch.value === '50');
  c.chg(cm, '100'); c.chg(ch, '100');
  });

  await section('2.1c  modal Stats tab keeps focus', async () => {
  await c.go('#/pokemon/3');
  await waitFor(() => c.$('modalContent').innerHTML.includes('About'));
  c.click(c.q('[data-tab="stats"]'));
  ok('modal stats tab renders', await waitFor(() => c.$('actualStats')));
  ok('[2.1c] modal shows current calculator values (HP 135)', rowsOf(c)[0] === '135');
  const mlv = c.q('#modalContent [data-calc="level"]');
  const area = c.$('actualStats');
  await typeCharByChar(c, mlv, '100', '[2.1c] modal level', async partial => {
    const n = Number(partial);
    ok(`[2.1c] modal level ${partial}: HP ${hpAt[n]}`, rowsOf(c)[0] === hpAt[n]);
  });
  ok('[2.1c] the modal itself was not replaced', c.q('#modalContent [data-calc="level"]') === mlv && c.$('actualStats') === area);
  c.typeIn(mlv, '');
  ok('[2.2] clearing level in the modal keeps 261', rowsOf(c)[0] === '261' && c.d.activeElement === mlv);
  c.ev(mlv, 'change');
  ok('[2.2] modal level is normalised on change', mlv.value === '100');
  c.typeIn(mlv, '250'); c.ev(mlv, 'change');
  ok('[2.2] modal level above 100 is clamped', mlv.value === '100');
  const mev = c.q('#modalContent [data-calc="ev"]');
  c.typeIn(mev, '999'); c.ev(mev, 'change');
  ok('[2.2] modal EV above 252 is clamped', mev.value === '252');
  c.chg(mev, '0');
  const mnat = c.q('#modalContent [data-calc="nature"]');
  obs = new c.w.MutationObserver(() => {}); obs.observe(c.$('modalContent'), { childList: true, subtree: true });
  mnat.value = 'hardy'; c.ev(mnat, 'input');
  ok('[2.4] input on the modal nature select does nothing', obs.takeRecords().length === 0 && rowsOf(c)[1] === '277');
  c.ev(mnat, 'change');
  ok('[2.4] change repaints the stat rows only, once (Hardy Atk 252)', obs.takeRecords().length === 1 && rowsOf(c)[1] === '252' && c.$('actualStats') === area);
  obs.disconnect();
  c.chg(mnat, 'adamant'); c.chg(mlv, '50');
  });

  await section('2.6  breeding tab agrees with the calculator', async () => {
  c.click(c.q('[data-tab="breeding"]'));
  ok('breeding tab renders', await waitFor(() => c.$('modalContent').innerHTML.includes('CATCH CHANCE')));
  const facts = c.qa('#modalContent .fact').map(f => [f.querySelector('small').textContent, f.querySelector('strong').textContent]);
  const chance = facts.find(f => f[0] === 'CATCH CHANCE')[1];
  ok('[2.6] catch chance at rate 45 is 11.9%, not 17.6%', chance === '11.9% at full HP');
  ok('[2.6] ...and equals the Catch Rate calculator for the same case', chance.startsWith(fullHp));
  ok('[2.6] the "at full HP" wording is kept', /at full HP$/.test(chance));
  c.$('closeModal').dispatchEvent(new c.w.MouseEvent('click', { bubbles: true }));
  });

  await section('2.3  default is the first team member', async () => {
  const c2 = boot();
  await waitFor(() => c2.qa('[data-team]').length > 0);
  c2.click(c2.qa('[data-team]')[0]);
  await c2.go('#/calc');
  ok('[2.3] with no modal history the first team member is the default (HP 135, Atk 140)',
    await waitFor(() => rowsOf(c2).length === 6) && rowsOf(c2)[0] === '135' && rowsOf(c2)[1] === '140');
  ok('[2.3] its chip is highlighted and the picker names it',
    c2.q('[data-calcmon].on') !== null && c2.$('calcMonInput').value === 'Mon1');
  });

  await section('2.4  loadout selects run once', async () => {
  const c3 = boot();
  await waitFor(() => c3.qa('[data-team]').length > 1);
  c3.click(c3.qa('[data-team]')[0]);
  await c3.go('#/team');
  await waitFor(() => c3.q('[data-edit]'));
  c3.click(c3.q('[data-edit]'));
  ok('loadout editor opens', await waitFor(() => c3.qa('[data-moveslot]').length === 4));
  const slot0 = c3.q('[data-moveslot="0"]');
  const tackleFetches = () => c3.reqs.filter(u => /\/move\/tackle\/?$/.test(u)).length;
  const t0 = tackleFetches();
  slot0.value = 'tackle'; c3.ev(slot0, 'input');
  await wait(150);
  ok('[2.4] an input event on a move select does nothing (no request, no assignment)',
    tackleFetches() === t0 && !c3.w.localStorage.getItem('atlasdex:teams')?.includes('tackle'));
  c3.ev(slot0, 'change');
  ok('[2.4] change assigns the move', await waitFor(() => c3.w.localStorage.getItem('atlasdex:teams')?.includes('tackle')));
  await waitFor(() => tackleFetches() > t0);
  await wait(200);   // long enough for a duplicate request to show up
  ok('[2.4] ...fetching its data exactly once', tackleFetches() === t0 + 1);
  const slot1 = c3.q('[data-moveslot="1"]');
  const surf0 = c3.reqs.filter(u => /\/move\/surf\/?$/.test(u)).length;
  slot1.value = 'surf'; c3.ev(slot1, 'input'); c3.ev(slot1, 'change');
  await wait(300);
  ok('[2.4] a browser-style input+change pair fetches the move once',
    c3.reqs.filter(u => /\/move\/surf\/?$/.test(u)).length === surf0 + 1);
  });

  /* ================================================================ */
  console.log('\n--- CSS for the new picker ---');
  const css = fs.readFileSync(dir + '/styles.css', 'utf8');
  const v6 = css.slice(css.indexOf('/* ===== v6 · calculator picker and damage rolls ===== */'));
  ok('[2.3] the picker has a versioned v6 CSS block', v6.length > 0 && css.includes('/* ===== v6 · calculator picker and damage rolls ===== */'));
  ok('[2.3] the picker has a .light override', /\.light \.monpicker/.test(v6));
  ok('[2.3] the picker has a max-width:700px rule', /@media\(max-width:700px\)\{[^]*\.monpicker/.test(v6));

  finish(fail, errs, 'All input/calculator tests passed');
})().catch(crash);
