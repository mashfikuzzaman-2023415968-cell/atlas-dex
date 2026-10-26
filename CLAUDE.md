# CLAUDE.md — AtlasDex

Context and working instructions for Claude Code. Read this fully before changing anything.

---

## 1. What this is

AtlasDex is a Pokémon field guide, team planner and living-dex tracker, built as a
**dependency-free progressive web app**. Three source files, no framework, no build step,
no bundler, no transpiler. You edit `app.js`, `styles.css` and `index.html` directly and
reload the browser.

All Pokémon data comes from the public [PokéAPI](https://pokeapi.co/api/v2) at runtime.
Artwork comes from PokéAPI's sprite repository on `raw.githubusercontent.com`.
There is no backend, no database, no accounts, no analytics. All user data lives in the
visitor's own browser.

**Do not introduce a build step, a framework, or an npm runtime dependency.** The zero-
dependency constraint is deliberate: it keeps the app deployable to any static host,
instantly auditable, and immune to supply-chain churn. `package.json` exists only for the
test harness and its `devDependencies`.

---

## 2. File map

```
atlas-dex/
├── index.html            Full markup: sidebar nav, hero, panel container, modals
├── app.js                ~2,400 lines. Entire application, one IIFE
├── styles.css            All styling, appended in versioned blocks (v2…v5)
├── sw.js                 Service worker: app shell + artwork caching
├── manifest.webmanifest  PWA manifest (all paths relative)
├── assets/icon.svg       App icon
├── package.json          Test scripts + devDependencies only
├── .nojekyll             Stops GitHub Pages running Jekyll
├── README.md             User-facing feature documentation
├── CLAUDE.md             This file
└── tests/
    ├── run.js                         Runner — `npm test`
    ├── 01-core.test.js                Grid, filters, modal tabs, favorites
    ├── 02-forms-offline-game.test.js  Alternate forms, IndexedDB cache, the game
    ├── 03-dexes-calculators.test.js   Moves/abilities/items dexes, calculators, palette
    ├── 04-loadouts.test.js            Member builds, exact coverage, Showdown, damage
    ├── 05-typechart.test.js           Type chart vs known matchups
    └── 06-battlemath.test.js          Stat, damage and capture formulas
```

`app.js` is organised into clearly commented sections, in this order:

| Section | What lives there |
|---|---|
| CONSTANTS | Type chart, colours, legendary IDs, stat labels |
| HELPERS | `$`, `safe`, `title`, `pad`, `idOf`, `genOf`, `sprite` |
| OFFLINE STORE | IndexedDB layer and the cache-first `get()` |
| TYPE MATH | `effectiveness`, `defensiveProfile`, `multLabel` |
| STATE | The single `state` object, loadout model, team proxy |
| SHARED MARKUP | `art`, `typeBadge`, `typesOf`, variety helpers |
| LIST / GRID | Main Pokédex filtering and rendering |
| COLLECTIONS | favorites, caught, team, compare |
| DETAIL MODAL | Seven-tab Pokémon modal, forms, encounters, evolution |
| VIEW: TEAM BUILDER | Coverage analysis and heatmap |
| VIEW: LIVING DEX | Completion ring and generation progress |
| TEAM MEMBER EDITOR | Loadout editing UI |
| VIEW: OFFLINE DEX | Bulk download, storage reporting, data export |
| VIEW: TYPE MATCHUPS | Standalone matchup calculator |
| VIEW: WHO'S THAT POKÉMON | Daily challenge game |
| DEXES | Moves, abilities and items browse engine + entity modal |
| BATTLE MATH | Natures, stat, damage and capture formulas |
| VIEW: CALCULATORS | Six calculator tabs |
| VIEW: COMPARE | Two-Pokémon comparison |
| COMMAND PALETTE | Ctrl/Cmd+K search |
| DATA EXPORT / IMPORT | JSON backup, Showdown export |
| ROUTING | Hash router |
| INIT | Boot sequence |
| EVENTS | All delegated listeners |

---

## 3. Architecture you must understand before editing

### 3.1 One state object, re-render on change

There is a single module-level `state` object. Views are plain functions that write
`innerHTML` into `#panel` (for full-page views) or `#modalContent` (for the modal), then
attach nothing — **all events are delegated** from `document`. This is why views can be
re-rendered freely without leaking listeners.

If you add a view, follow the pattern: write a `renderX()` that calls `showList(false)`,
sets `#crumb`, toggles the active nav item, and assigns `$('panel').innerHTML`.

### 3.2 Event delegation, and why order matters

There are exactly three document-level listeners: `click`, `input` and `change`, plus
`keydown`. The `click` handler is a long chain of `hit('[data-x]')` checks that **return
early**. Order is significant — more specific attributes must be tested before general
ones. For example `[data-team]` is checked before `[data-open]`, because a team-remove
button sits inside a card that also has `data-open`.

When adding an interactive element, give it a `data-*` attribute and add a branch to the
chain in the right position. Do not attach inline `onclick` or per-element listeners.

### 3.3 Cache-first networking

`get(url)` checks IndexedDB first, falls back to the network, and falls back again to a
stale cached copy if the network fails. PokéAPI payloads are immutable, so this is safe
and is what makes offline mode work.

**Always call `get()`, never `fetch()` directly** for PokéAPI data. Bulk work must go
through `pool(items, limit, worker)` which caps concurrency — PokéAPI is a free service
and asks consumers to cache rather than hammer it.

If IndexedDB is unavailable the layer degrades silently to plain network calls. Suite 01
runs without an IndexedDB shim specifically to prove this still works.

### 3.4 Species IDs vs variety IDs — the most common source of bugs

PokéAPI separates **species** (`/pokemon-species/{id}`) from **varieties**
(`/pokemon/{id}`). Alolan Raichu is species 26 but variety 10100.

Rules in this codebase:

- `state.list` is indexed by **species**. `state.list[id-1]` is only valid for species IDs.
- Favorites and living-dex progress are keyed by **species ID** — catching a Raichu
  shouldn't depend on which form you viewed.
- Team members, the detail modal's active form, and compare are keyed by **variety ID**.
- Use `pokeName(pokeId)` and `speciesIdOf(pokeId)` rather than indexing `state.list`.
  There are no remaining raw `state.list[id-1]` lookups; don't reintroduce any.

`state.modalId` is the species; `state.formId` is the variety currently displayed. Every
detail tab reads from `state.details.get(fid)` so switching form recomputes everything.

### 3.5 The team proxy

`state.team` is **not a stored property**. It is a `defineProperty` getter/setter that
reads and writes `state.teams[state.activeTeam].members`. This lets multi-team support
exist without rewriting every call site.

Two consequences:

1. The proxy is defined **immediately after** the `state` literal. It cannot be moved
   above it — doing so throws a temporal dead zone error that breaks the whole app on
   boot. (This happened once; suite 04 catches it.)
2. Mutating in place (`state.team.push(...)`) does **not** trigger the setter, so you must
   call `saveTeams()` manually after in-place mutation.

### 3.6 Member loadouts

Each team member is an object:

```js
{ id, level, nature, ability, item, ivs: {...6}, evs: {...6}, moves: [names] }
```

Old saves stored plain numbers. `normalizeMember()` and `migrateTeams()` handle that, and
`migrateTeams()` runs first thing in `init()`. **Never remove the migration** — real users
have old data.

Loadouts drive three features: exact offensive coverage, the team damage calculator and
the Showdown export. All three degrade gracefully when moves are unassigned.

### 3.7 Focus preservation

`refreshLoadoutStats()` updates only the computed numbers in the loadout editor rather
than re-rendering it. This exists because re-rendering steals focus mid-keystroke while
someone is typing an EV value. If you add live-updating inputs anywhere, do the same.

---

## 4. Conventions

- **Formatting**: 2-space indent, semicolons, single quotes, `const` by default.
- **Escaping**: every interpolated user- or API-supplied string goes through `safe()`.
  There is no exception to this. XSS via a Pokémon name is unlikely but free to prevent.
- **Naming**: `renderX()` for full views, `xPanel()` for HTML-returning fragments,
  `loadX()` for async fetch-and-fill.
- **CSS**: appended in versioned blocks with a header comment. Add a new block rather than
  editing old ones — it keeps diffs readable. Every new component needs a matching
  `.light` override and a `@media(max-width:700px)` rule.
- **Theming**: colours come from CSS custom properties on `:root` and `.light`. Never
  hard-code a colour that appears in both themes. The accent is lime in dark mode and a
  darker green in light mode, because lime text on white fails contrast.
- **Comments**: explain *why*, not *what*. The existing comments mark non-obvious
  decisions; match that standard.

---

## 5. Testing — run this before and after every change

```sh
npm install     # first time only (jsdom, fake-indexeddb)
npm test        # all 6 suites, ~199 assertions
npm test 04     # just the loadouts suite
npm run check   # syntax check only, fast
```

The suites run the real `app.js` inside jsdom with a mocked `fetch` and a fake IndexedDB.
They are fast and they have caught every regression so far, including:

- a temporal dead zone crash that broke boot entirely
- a calculator re-rendering the page *behind* an open modal instead of the modal
- select values arriving as strings so `id === state.x` never matched

**Expectations:**

- Run `npm test` before you start, so you know the baseline is green.
- Any new feature gets assertions in the relevant suite, or a new `NN-name.test.js`.
- Test real behaviour, not that something rendered. Prefer `attack stat is 165` over
  `the panel contains text`. Where a formula is involved, assert against hand-verified
  values, as suite 06 does with Garchomp's canonical stats.
- If a test fails, work out whether the code or the test is wrong. Twice the test was
  wrong — both times it was worth fixing the test properly rather than loosening it.

---

## 6. Deployment (GitHub Pages)

The app is static with entirely relative paths, so it works from a repo subpath such as
`username.github.io/atlas-dex/`. Routing is hash-based, so no SPA fallback is needed.
HTTPS from Pages satisfies the service worker and PWA install requirements.

### First deploy

```sh
cd atlas-dex
git init
git add -A
git commit -m "AtlasDex v5"
git branch -M main
git remote add origin https://github.com/USERNAME/atlas-dex.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save.**
Live in a minute or two.

### Subsequent deploys

```sh
npm test && git add -A && git commit -m "..." && git push
```

### Deployment checklist — do this every time

1. `npm test` passes.
2. **Bump the cache name in `sw.js`** (`atlasdex-shell-v5` → `v6`, and `atlasdex-art-v1`
   only if artwork handling changed). If you forget, returning visitors keep serving the
   old cached build and your changes appear not to have deployed. This is the single most
   likely deployment mistake.
3. Confirm `index.html` is at the repo **root**, not nested in a folder.
4. `.nojekyll` is present.
5. After deploying, hard-reload and verify in both light and dark mode, and at a narrow
   viewport.

`node_modules/` is gitignored. Do not commit it.

---

## 7. Feature inventory

**Browse** — species list, search, filters (generation, type, caught, uncaught,
legendary), sort by number/name/base-stat-total, shiny toggle, dark-light theme.

**Pokémon detail, seven tabs** — Overview (dex entry, facts, ability effects), Stats (base
bars plus live real-stat calculator), Matchups (full defensive profile), Evolution,
Breeding (egg groups, gender, hatch, EV yield, catch rate), Moves (filterable table),
Encounters (wild locations per game). Alternate forms switch via a form bar and every tab
recomputes.

**Team Builder** — up to 8 named teams of 6. Shared weaknesses, offensive blind spots,
defensive strengths, average power, and an 18-type coverage heatmap. Coverage is exact
when every member has damaging moves assigned, approximate from typing otherwise.

**Member loadouts** — level, nature, ability, held item, 4 moves from the legal learnset,
per-stat IVs and EVs with live stats, legal-limit warning and spread presets.

**Living Dex** — caught tracking, completion ring, per-generation progress, next-to-catch.

**Who's That Pokémon?** — silhouette guessing. Daily challenge seeded from the date with
`mulberry32` so every player gets the same puzzle; streak counter; emoji-grid share;
endless mode with a generation filter.

**Reference dexes** — Moves, Abilities and Items, each browsable, searchable and
cross-linked to species.

**Calculators** — Stats, Team Damage (reads real builds), Damage (manual), Catch Rate,
Breeding compatibility, Natures.

**Offline Dex** — cache-first IndexedDB, resumable full-dex bulk download with progress,
storage reporting, cache reset, JSON backup export and import.

**Command palette** — `Ctrl/Cmd+K`, searches species, moves, abilities, items, and jumps
to any tool.

---

## 8. Known gaps and good next steps

Honest list of what is incomplete, roughly in order of value:

- **Damage model is basic.** No weather, terrain, screens, ability multipliers or item
  boosts (Life Orb, Choice Band). The base formula is correct; the modifiers are missing.
- **Move legality is cross-generation.** PokéAPI's combined learnset is used, so a move
  legal only in one game appears available in all. Proper handling means filtering by
  version group.
- **No per-generation stat rules.** Gen 1–2 used different mechanics (DVs, Special as one
  stat). Everything assumes Gen 3+.
- **Living dex is per species, not per form.** Arguably correct, but a completionist may
  want to track forms separately.
- **Offensive coverage ignores ability effects** such as Levitate on the defending side.
- **No multi-language support** despite PokéAPI providing flavour text in many languages.
- **Items dex loads category filters only from already-cached items**, so the dropdown
  fills in as you browse.

---

## 9. Constraints — do not break these

1. **No runtime dependencies, no build step, no framework.**
2. **No backend.** Everything client-side. If a feature needs a server, say so rather than
   quietly adding one.
3. **No API keys or secrets.** The repo is public and PokéAPI needs no auth.
4. **Respect PokéAPI.** Cache-first, concurrency-capped, never a tight fetch loop.
5. **Never remove `migrateTeams()`** or any other migration. Users have stored data.
6. **Keep it unofficial.** The footer disclaimer and README notice stay. Do not add
   Pokémon logos or official game art to branding, and do not monetise. Nintendo is
   notably protective of this IP.
7. **Accessibility**: keep `aria-label`s on icon-only buttons, keep focus-visible outlines,
   keep keyboard navigation working in the palette and modal.

---

## 10. How to approach a task here

1. Run `npm test` to confirm a green baseline.
2. Read the relevant section of `app.js` — it is long but clearly delimited.
3. Make the change, following the delegation and rendering patterns above.
4. Add or update assertions.
5. `npm test`, then `npm run serve` and check it by hand in both themes and at a narrow
   width.
6. Bump the `sw.js` cache name if deploying.
7. Commit with a message that says what changed and why.

If a request would break a section 9 constraint, or if the right fix is larger than the
request implies, say so rather than working around it quietly.
