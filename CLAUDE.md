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
├── app.js                ~3,660 lines. Entire application, one IIFE
├── styles.css            All styling, appended in versioned blocks (v2…v5)
├── sw.js                 Service worker: network-first app shell + bounded artwork cache
├── manifest.webmanifest  PWA manifest (all paths relative)
├── assets/icon.svg       App icon
├── package.json          Test scripts + devDependencies only
├── .nojekyll             Stops GitHub Pages running Jekyll
├── README.md             User-facing feature documentation
├── CLAUDE.md             This file
└── tests/
    ├── run.js                         Runner — `npm test`; fails a suite on exit code, FAIL lines,
    │                                  runtime-error lines or no PASS lines
    ├── harness.js                     Shared helpers (not a suite): waitFor, trackErrors, finish, crash
    ├── 01-core.test.js                Grid, filters, modal tabs, favorites
    ├── 02-forms-offline-game.test.js  Alternate forms, IndexedDB cache, the game
    ├── 03-dexes-calculators.test.js   Moves/abilities/items dexes, calculators, palette
    ├── 04-loadouts.test.js            Member builds, exact coverage, Showdown, damage
    ├── 05-typechart.test.js           Type chart vs known matchups
    ├── 06-battlemath.test.js          Stat, damage (incl. Bulbapedia vector) and capture formulas
    ├── 07-backup-teams.test.js        Backup validation, boot sanitisers, escaping, activeTeam, Team Builder loading
    ├── 08-input-calc.test.js          Focus-keeping partial renders, calculator clamping, Stats picker, per-kind filters
    ├── 09-offline-sw-game.test.js     Offline download state, art CORS, sw.js in a simulated worker, resumable daily
    ├── 10-nav-a11y.test.js            Hash routing, "/" shortcut, aria, dialog focus, reduced motion, moves tab, legendary data
    └── 11-integration.test.js         Interactions between the batches (daily + import, focus + partial renders, ...)
```

`app.js` is organised into clearly commented sections, in this order:

| Section | What lives there |
|---|---|
| CONSTANTS | Type chart, colours, legendary IDs, stat labels |
| HELPERS | `$`, `safe`, `title`, `pad`, `idOf`, `genOf`, `toId`, `int0`, `typeColor`, shape checks (`hasOwn`, `isObj`, `own`, `inRange`, `asList`), `sprite`, `read`/`store`, `initialTheme` |
| OFFLINE STORE | IndexedDB layer and the cache-first `get()` |
| TYPE MATH | `effectiveness`, `defensiveProfile`, `multLabel` |
| STATE | The single `state` object, team proxy, `clampTeamIndex`/`activeIdx`, loadout model, **sanitisers** (`sanitizeMember`, `sanitizeTeams`, `sanitizeGame`, `sanitizeLoadedState`) |
| SHARED MARKUP | `art`, `typeBadge`, `typesOf`, variety helpers |
| LIST / GRID | Main Pokédex filtering and rendering |
| COLLECTIONS | favorites, caught, team, compare |
| DETAIL MODAL | Seven-tab Pokémon modal, forms, encounters, evolution; dialog focus helpers (`rememberFocus`, `restoreFocus`, `trapTab`, `showOverlay`) |
| VIEW: TEAM BUILDER | Coverage analysis and heatmap |
| VIEW: LIVING DEX | Completion ring and generation progress |
| TEAM MEMBER EDITOR | Loadout editing UI |
| VIEW: OFFLINE DEX | Bulk download, storage reporting, data export |
| VIEW: TYPE MATCHUPS | Standalone matchup calculator |
| VIEW: WHO'S THAT POKÉMON | Daily challenge game, local-date keys, resumable daily (`sanitizeDaily`, `loadDaily`) |
| DEXES | Moves, abilities and items browse engine (shell rendered once, `paintBrowseResults`), `dmgIcon`, entity modal |
| BATTLE MATH | Natures, `CALC_LIMITS`, stat, damage (`pokeRound`, `damageRange`) and capture formulas |
| VIEW: CALCULATORS | Six calculator tabs, Stats species picker, `refreshCalc` partial repaints |
| VIEW: COMPARE | Two-Pokémon comparison |
| COMMAND PALETTE | Ctrl/Cmd+K search |
| DATA EXPORT / IMPORT | JSON backup export, `sanitizeBackup` + `importData`, Showdown export |
| ROUTING | Hash router |
| INIT | Boot sequence (`init()`, safe to re-run from "Try again") |
| EVENTS | Delegated document listeners and the static header controls |

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

There are exactly four document-level listeners: `click`, `input`, `change` and `keydown`.
Besides those, listeners are attached once, at load, to static chrome that is never
re-rendered (search box, type/generation/sort selects, theme, shiny, random, palette and
modal close buttons, `matchMedia`, `hashchange`, `online`/`offline`). Anything rendered into
`#panel` or `#modalContent` goes through the delegated four. The `click` handler is a long chain of `hit('[data-x]')` checks that **return
early**. Order is significant — more specific attributes must be tested before general
ones. For example `[data-team]` is checked before `[data-open]`, because a team-remove
button sits inside a card that also has `data-open`.

When adding an interactive element, give it a `data-*` attribute and add a branch to the
chain in the right position. Do not attach inline `onclick` or per-element listeners.

Selects and checkboxes fire both `input` and `change`, so they are handled on `change`
only (the `input` handler returns early for them); number and text fields are handled on
`input` as the user types, and normalised on `change`. Elements with `role="button"` that
are not real buttons need Enter/Space handled in the `keydown` listener.

### 3.3 Cache-first networking

`get(url)` checks IndexedDB first, falls back to the network, and falls back again to a
stale cached copy if the network fails. PokéAPI payloads are immutable, so this is safe
and is what makes offline mode work.

**Always call `get()`, never `fetch()` directly** for PokéAPI data (the service worker's own
`fetch` is separate, see section 6). Bulk work must go
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
`migrateTeams()` runs first thing in `init()`, followed by `sanitizeLoadedState()` (3.8).
**Never remove the migration** — real users have old data.

Loadouts drive three features: exact offensive coverage, the team damage calculator and
the Showdown export. All three degrade gracefully when moves are unassigned.

### 3.7 Focus preservation

Re-rendering an element the user is typing in steals focus and moves the caret. So controls
are rendered once and only the regions that depend on their value are repainted:

- Moves/Abilities/Items dexes: `renderBrowse()` builds the search box and filters once;
  search, filter, sort and row hydration repaint only `#brResults` via `paintBrowseResults()`.
- Calculators: `refreshCalc()` repaints `#calcResult` (or `#actualStats` for the modal's
  Stats tab) and never the input in use. Tabs without a result region repaint their body and
  re-focus the same `data-calc` control. Number fields are clamped by `CALC_LIMITS` via
  `clampCalc()`; empty or invalid text returns `null` and leaves state alone, and `change`
  writes the clamped value back to the display (`normaliseCalcInputs`).
- Loadout editor: `refreshLoadoutStats()` updates only the computed numbers.
- Re-rendering buttons inside the modal: `modalFocusKey()` / `keepModalFocus()` put focus back
  on the equivalent button. Inputs are deliberately not refocused.

If you add live-updating inputs anywhere, follow the same pattern.

### 3.8 Stored and imported data is untrusted

Backups are files from strangers, and localStorage can hold whatever an earlier version let
in. Everything is rebuilt into fresh objects by the sanitisers, which copy only known keys
through `own()`/`hasOwn()` (so prototype-pollution keys are never read) and fall back to
defaults for anything invalid:

- `sanitizeMember`, `sanitizeTeams`, `sanitizeGame`, `sanitizeDaily` (the in-progress daily),
  `cleanIds`, `cleanItem`, `clampInt`, `slugOrNull`.
- `sanitizeBackup(d)` turns parsed JSON into `{ clean }` or `{ error }` (wrong app marker,
  unsupported version, wrong field shapes). `importData()` checks the size
  (`IMPORT_MAX_BYTES`), parses, sanitises, asks for confirmation, and only then writes, so
  a refused file changes nothing. Importing game stats also clears a stale saved daily.
- `sanitizeLoadedState()` re-validates the localStorage-backed state at boot and writes the
  cleaned values back (only for keys that were stored). It also removes the pre-multi-team
  `atlasdex:team` key.

**Where they run:** `sanitizeLoadedState()` is called from `init()` straight after
`migrateTeams()`. It must never move into the `state` literal: the sanitisers use `NATURES`,
a `const` declared much further down, and calling them during the literal throws a temporal
dead zone error that breaks boot. The literal only does raw reads wrapped in `asList()`.
`asList`, `isObj`, `own`, `hasOwn` and `inRange` are therefore declared near the top
(HELPERS) as consts.

Related rules:

- `clampTeamIndex(n, len)` and `activeIdx()` are the only way to read the selected team.
  Never index `state.teams[state.activeTeam]` directly: storage and imports can hand over an
  out-of-range or non-integer value. `saveTeams()` writes the clamped index back.
- Ids and counters that reach markup, `data-*` attributes or URLs go through `toId()`
  (positive integer or 0) or `int0()`. `typeColor()` and `dmgIcon()` look up by own key, so a
  value like `"constructor"` never resolves to something inherited. Keep using them, and keep
  everything else going through `safe()`.

### 3.9 Team Builder loading

`renderTeam()` fetches missing members' `/pokemon` data once per render. `state.teamLoading`
holds ids with a request in flight (also set by `addToTeam`, so opening the Team Builder at
the same moment does not fetch twice); `state.teamFailed` holds ids that failed. Failed members
render as removable placeholders with a Retry action (`data-teamretry` clears `teamFailed` and
re-renders, `data-retry` reopens that Pokémon). There must be no code path that re-fetches a
failed id automatically; importing a backup clears `teamFailed`.

### 3.10 Dialogs and keyboard

The detail modal (`#detailModal`, `tabindex="-1"`) and the command palette are dialogs:
`showOverlay()` records the opener (`rememberFocus()`) and moves focus in, the `keydown`
listener traps Tab (`trapTab`), and `closeModal()`/`closePalette()` restore focus
(`restoreFocus()` falls back to a selector, since the opener is often re-rendered meanwhile).
Every modal flavour (Pokémon, entity, loadout editor, compare) must open through
`showOverlay()`. Closing the loadout editor by any route refreshes the Team Builder.

### 3.11 Dex filters are per kind

`state.browse.filters` and `state.browse.sorts` are keyed by dex kind (`move`, `ability`,
`item`), so a type picked on Moves cannot leak onto Items. Read them with the current
`state.browse.kind`. Item categories exist only on fetched records, so `itemCategories()`
always includes the active selection to keep the control and the filter in agreement.

### 3.12 Daily game dates

The daily puzzle, streak and share text use the player's local calendar date (`todayKey()`,
`yesterdayKey()`; the latter uses `setDate`, not millisecond subtraction, to survive DST).
The in-progress daily lives in `atlasdex:daily` and is restored by `loadDaily()` only if it is
valid and dated today; replays after finishing never persist or count towards the streak.

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
npm test        # all 11 suites, 1,017 assertions, about 2 minutes
npm test 04     # just the loadouts suite (any suite, by number prefix)
npm run check   # syntax check only, fast
```

The suites run the real `app.js` (and, in suite 09, the real `sw.js` in a simulated worker
global) inside jsdom with a mocked `fetch` and a fake IndexedDB. Current totals: 01 30,
02 40, 03 60, 04 47, 05 22, 06 44, 07 274, 08 154, 09 118, 10 135, 11 93. They have caught
every regression so far, including:

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

**Rules for suites** (they exist because suites once passed while checking nothing):

- A suite must exit non-zero on any failure. Use `tests/harness.js`: `trackErrors(window)`
  collects uncaught page errors and unhandled rejections, `finish(fail, errs)` prints the
  `runtime errors:` line and exits 1 if there were failures **or any runtime error**, and
  `crash(err)` reports a throwing suite body as a failure.
- `tests/run.js` additionally fails a suite on a non-zero exit, any `FAIL` line, a non-empty
  `runtime errors:` line, or no `PASS` lines at all. Print assertions as `  PASS  label` /
  `  FAIL  label`.
- Never gate an assertion on a fixed sleep. Use `await waitFor(() => condition)` from the
  harness: it returns as soon as the condition holds and waits up to 10 s on a slow machine.
  It resolves to a boolean rather than throwing, so the assertion after it reports the failure.
- Mutation-check every new test: revert the fix (in a scratch copy; suite 09 honours
  `ATLAS_DIR` to point at another checkout) and confirm the test fails. A test that passes
  without its fix proves nothing.

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
2. **Bump `SHELL_CACHE` in `sw.js`** (`atlasdex-shell-v5` → `v6`) on each deploy, and
   `ART_CACHE` (currently `atlasdex-art-v2`) only if artwork handling changed. This is still
   recommended because `activate` deletes caches whose names are not in `KEEP`, which purges
   stale shell entries (such as a removed file). It is no longer the only thing between a
   deploy and returning visitors: see "How the service worker serves things" below.
3. Confirm `index.html` is at the repo **root**, not nested in a folder.
4. `.nojekyll` is present.
5. After deploying, hard-reload and verify in both light and dark mode, and at a narrow
   viewport.

`node_modules/` is gitignored. Do not commit it.

### How the service worker serves things

- **App shell (same-origin GETs): network-first.** `shellResponse()` fetches from the network
  and stores ok responses in `SHELL_CACHE`; if the network fails or takes longer than
  `NET_TIMEOUT` (4 s) it serves the cached copy, with navigations falling back to the cached
  `./` or `./index.html`. A slow fetch still completes in the background to refresh the cache.
  So a deploy reaches returning visitors on their next load even without a cache bump.
  `install` precaches `SHELL`; `skipWaiting()` and `clients.claim()` stay.
- **Artwork (`raw.githubusercontent.com`): cache-first** in `ART_CACHE`, which now holds only
  `res.ok` responses that are not opaque (an opaque 404 would be replayed forever and is billed
  as several MB of quota). That is why every artwork `<img>` has `crossorigin="anonymous"`:
  it makes the request CORS so the response is readable. Any new image from that host needs the
  attribute too. The cache is trimmed to `ART_MAX` (2,500, oldest first) on the first insert
  and every `ART_TRIM_EVERY` (50) inserts. On network failure the worker returns
  `Response.error()`.
- PokéAPI data is not handled by the worker; it is cached by `get()` in IndexedDB (3.3).

---

## 7. Feature inventory

**Browse** — species list, search, filters (generation, type, caught, uncaught,
legendary), sort by number/name/base-stat-total, shiny toggle, dark-light theme (follows
`prefers-color-scheme` until the user chooses; the theme button shows sun or moon and sets
`aria-pressed`).

**Pokémon detail, seven tabs** — Overview (dex entry, facts, ability effects), Stats (base
bars plus live real-stat calculator), Matchups (full defensive profile), Evolution,
Breeding (egg groups, gender, hatch, EV yield, catch rate), Moves (filterable table; a move is
listed under every learn method, level-up uses the newest version group),
Encounters (wild locations per game). Alternate forms switch via a form bar and every tab
recomputes.

**Team Builder** — up to 8 named teams of 6. Shared weaknesses, offensive blind spots,
defensive strengths, average power, and an 18-type coverage heatmap. Offensive coverage uses
each member's damaging moves where assigned and its typing otherwise; it is labelled exact
only when every member has damaging moves. Members whose data failed to load show a Retry
placeholder (3.9).

**Member loadouts** — level, nature, ability, held item, 4 moves from the legal learnset,
per-stat IVs and EVs with live stats, legal-limit warning and spread presets.

**Living Dex** — caught tracking, completion ring, per-generation progress, next-to-catch.
Only species present in `state.list` count towards totals (`caughtTotal()`), so progress
cannot exceed 100%.

**Who's That Pokémon?** — silhouette guessing. Daily challenge seeded from the date with
`mulberry32` and the player's local date, so everyone on a date gets the same puzzle and it
resets at local midnight; the in-progress daily resumes; streak counter; emoji-grid share;
endless mode with a generation filter.

**Reference dexes** — Moves, Abilities and Items, each browsable, searchable and
cross-linked to species.

**Calculators** — Stats (with a species picker and team chips), Team Damage (reads real
builds), Damage (manual), Catch Rate (conditional balls state their conditions), Breeding
compatibility, Natures. Damage follows the Gen 6+ formula in the games' rounding order.

**Offline Dex** — cache-first IndexedDB, resumable full-dex bulk download with progress
(single run at a time, failures counted, pauses when offline), storage reporting, cache
reset, JSON backup export and validated import (3.8).

**Command palette** — `Ctrl/Cmd+K`, searches species, moves, abilities, items, and jumps
to any tool.

---

## 8. Known gaps and good next steps

Honest list of what is incomplete, roughly in order of value:

- **Damage model has no field or item modifiers.** The Gen 6+ formula and the games'
  rounding are implemented, but there is no weather, terrain, screens, ability multipliers or
  item boosts (Life Orb, Choice Band). `damageRange` has an `other` modifier hook, unused by
  the UI. Non-power-of-two effectiveness (only possible with future chart changes) is best
  effort.
- **Move legality is cross-generation.** PokéAPI's combined learnset is used, so a move
  legal only in one game appears available in all. Proper handling means filtering by
  version group.
- **No per-generation stat rules.** Gen 1–2 used different mechanics (DVs, Special as one
  stat). Everything assumes Gen 3+.
- **Living dex is per species, not per form.** Arguably correct, but a completionist may
  want to track forms separately.
- **Coverage and matchups ignore ability effects** such as Levitate on the defending side.
- **No multi-language support** despite PokéAPI providing flavour text in many languages.
- **Items dex loads category filters only from already-cached items**, so the dropdown
  fills in as you browse (the active choice is always kept listed).

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
7. **Accessibility**: keep `aria-label`s on icon-only buttons (naming the Pokémon where one
   is involved), keep focus-visible outlines (including the light variant for
   `role="button"`), keep keyboard navigation and dialog focus management working in the
   palette and modal, and keep the `prefers-reduced-motion` block.

---

## 10. How to approach a task here

1. Run `npm test` to confirm a green baseline.
2. Read the relevant section of `app.js` — it is long but clearly delimited.
3. Make the change, following the delegation and rendering patterns above.
4. Add or update assertions, and mutation-check them (section 5).
5. `npm test`, then `npm run serve` and check it by hand in both themes and at a narrow
   width.
6. Bump `SHELL_CACHE` in `sw.js` if deploying (section 6).
7. Commit with a message that says what changed and why.

If a request would break a section 9 constraint, or if the right fix is larger than the
request implies, say so rather than working around it quietly.
