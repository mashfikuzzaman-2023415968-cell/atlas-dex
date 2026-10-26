# AtlasDex

A Pokémon field guide, team planner and living-dex tracker, built as a dependency-free
HTML/CSS/JavaScript progressive web app.

## Features

### Command palette
`Ctrl/Cmd+K` from anywhere. Searches species, moves, abilities and items in one list and
jumps to any tool. Arrow keys and Enter to navigate.

### Moves, Abilities and Items dexes
Three browsable reference tables with search, filtering and lazy row hydration. Typing in
the search box never loses focus, and each table remembers its own filter and sort.
Clicking any row opens a detail page: moves show type, category, power, accuracy, PP,
priority, effect text and every Pokémon that learns them; abilities show their effect and
every Pokémon that has them; items show category, cost, fling power, sprite and effect.
Pokémon names throughout are clickable and jump straight to that species.

### Calculators
Six tools in one view. Number fields are clamped to legal ranges; clearing a field keeps the
last valid value instead of writing 0.
- **Stats** — Gen 3+ formula converting base stats to real stats from level, nature, IVs and EVs.
  Has a Pokémon picker (type a name or choose from the list, or tap a team member), defaulting
  to the last Pokémon you opened, else your first team member. Also embedded in every
  Pokémon's Stats tab, prefilled with that Pokémon's bases.
- **Team Damage** — pick an attacker, its move and a defender from your team; stats, STAB
  and effectiveness are read from the real builds.
- **Damage (manual)** — the same formula with every input entered by hand. Both damage tools
  use the games' own rounding order (Gen 6+ formula, 1.5x critical hits, 16 random rolls).
- **Catch rate** — Gen 5+ capture formula including all four shake checks, across ball types,
  status conditions and remaining HP. Conditional balls state their conditions.
- **Breeding** — egg group compatibility, listing every species that can breed with a group.
- **Natures** — all 25 with their raised and lowered stats.

### Encounter locations
A seventh tab on every Pokémon showing where it appears in the wild, grouped by game
version, with level ranges and encounter rates.

### Team member loadouts
Every team member carries a full competitive build: level, nature, ability, held item,
four moves chosen from its legal learnset, and per-stat IVs and EVs. The editor shows
live calculated stats as you change anything, flags EV spreads over the 510 legal limit,
and ships quick presets for physical sweeper, special sweeper and bulky spreads.

Loadouts feed three other features:
- **Exact offensive coverage.** The Team Builder heatmap calculates coverage from the
  damaging moves actually assigned. It is exact when every member has at least one; members
  without moves fall back to their typing, and the page says which mode it is in.
- **Team damage calculator.** Pick an attacker, one of its real moves, and a defender.
  Real stats, STAB and type effectiveness are all derived rather than typed in.
- **Complete Showdown export.** Item, ability, level, EV line, nature, non-default IVs
  and real move list.

### Multiple saved teams
Up to eight named teams with tab switching, renaming and deletion. Each gets the full
coverage analysis. Teams export to Pokémon Showdown format via the clipboard, with full builds.

### Backup and restore
Favorites, living dex progress, saved teams (with full builds), compare slots, game stats
and settings (theme, shiny) export to a JSON file and import back. Everything otherwise lives
in one browser's localStorage.

Imports are validated before anything is touched. A file that is not an AtlasDex backup, is
not valid JSON, is over 2 MB, was made by a different version, or is structurally damaged is
refused with a clear message, and your existing data is never partially overwritten. Accepted
backups are rebuilt field by field (bad ids, moves, natures and numbers are dropped or reset
to defaults), and you confirm before anything is replaced. Restoring game stats also discards
a half-played daily so it cannot contradict them. Data already in the browser is re-checked
the same way on every load.

### Alternate forms and regional variants
Every species' `varieties` are loaded and selectable from a form bar in the detail modal.
Alolan, Galarian, Hisuian, Paldean, Mega, Therian and other forms carry their own types,
stats, abilities and movesets, and **every downstream feature re-runs against the selected
form** — matchups, stat bars, breeding data and the move table. Forms can be added to your
team individually, so a team containing Alolan Raichu is analyzed as Electric/Psychic
rather than pure Electric.

### Offline Dex
Every PokéAPI response is persisted to IndexedDB and served cache-first, so anything you
have viewed once works with no connection. The Offline Dex view adds a resumable bulk
download of the entire National Dex with live progress (counting only records actually
saved), pause/resume, storage reporting via `navigator.storage.estimate()`, and a cache
reset. Starting a download twice is ignored, going offline stops it cleanly, and the toast
only says "ready" when every record succeeded. The service worker separately caches
official artwork from GitHub's raw host (successful responses only, capped at 2,500 images),
so images survive offline too.

### Who's That Pokémon?
A silhouette guessing game. The daily challenge is five Pokémon seeded from your local
calendar date with a `mulberry32` PRNG, so everyone on the same date gets an identical
puzzle. It resets at midnight your time and drives a streak counter with a personal best.
Leave mid-game and the daily resumes where you stopped, so answers you have already seen
cannot be replayed. Results share as an emoji grid copied to the clipboard. Endless
practice mode adds a per-generation difficulty filter.

### Browse
- National Pokédex species list, fetched dynamically from PokéAPI
- Search by name or National Dex ID
- Filter by generation, elemental type, caught status, or Legendary/Mythical
- Sort by Pokédex number, name, or base stat total
- Shiny artwork toggle across the whole app
- Dark/light theme (follows your OS setting until you choose), keyboard shortcuts,
  installable PWA shell

### Keyboard and accessibility
Everything is operable from the keyboard: `Ctrl/Cmd+K` palette, `/` to search (it takes you
home first from other views), arrow keys between Pokémon in the detail modal, and Enter or
Space on cards and team slots. Dialogs move focus in, keep Tab inside, and return focus to
what opened them. Icon-only buttons name the Pokémon they act on, focus rings are visible
in both themes, toggles expose `aria-pressed`, and animations are turned off under
`prefers-reduced-motion`.

### Pokémon detail (seven tabs)
- **Overview** — dex entry, physical facts, ability descriptions pulled from the ability endpoint
- **Stats** — base stat bars, stat total, and a live real-stat calculator
- **Matchups** — full defensive type profile: 4×/2× weaknesses, resistances and immunities
- **Evolution** — evolution family with trigger conditions
- **Breeding** — egg groups, gender ratio, hatch steps, habitat, shape, baby form
- **Moves** — sortable table with type, power, accuracy, PP and level, filterable by learn
  method (a move appears under every method that teaches it)
- **Encounters** — wild locations per game version, with levels and rates

### Team Builder
Pick up to six Pokémon and AtlasDex analyzes the team:
- **Shared weaknesses** — types that hit half your team or more
- **Offensive blind spots** — types nobody on the team can hit super-effectively
- **Solid against** — types widely resisted with no team member vulnerable
- **Power level** — average base stat total with an interpretation
- **Coverage heatmap** — all 18 types, defense and offense side by side
- A floating team dock follows you while browsing
- If a member's data cannot load, it shows as a removable placeholder with a Retry button
  rather than blocking the page

### Living Dex
- Mark any Pokémon caught with the ◉ button
- Completion ring, per-generation progress bars, "next to catch" shortlist
- Progress saved in the browser. Only species in the loaded list count, so restoring a
  backup with unknown ids can never push completion past 100%

### Type Matchup Calculator
Standalone tool: pick an attacking type and up to two defending types for the exact
multiplier, plus the full chart against that defensive typing.

### Compare
Two Pokémon side by side with base stats, typing and defensive weaknesses.

## Implementation notes

PokéAPI traffic is cache-first through IndexedDB (`get()` wraps `netGet()`), falling
back to a stale cached copy if the network fails. If IndexedDB is unavailable the layer
degrades silently to plain network calls.

The type chart is Gen 6+ and stored locally in `app.js` as `CHART`, so all matchup,
team-analysis and weakness features work instantly with no network calls. Legendary and
Mythical status is likewise a local ID set (`LEGENDARY`) rather than ~1000 species lookups.

All network calls go through `pool()`, which caps concurrency so PokéAPI is never flooded.
Responses are memoized in `state` (details, species, chains, moves, abilities).

## Run

Service workers do not work on `file://`, so serve the folder:

```sh
python3 -m http.server 8080
```

Then open http://localhost:8080.

## Deploy

Upload the *contents* of this directory to any static host (Cloudflare Pages, Netlify,
GitHub Pages, Vercel). No build step. HTTPS enables PWA installation.

The service worker fetches the app shell network-first (falling back to the cache after 4
seconds or when offline), so a new deploy reaches returning visitors on their next load
without any cache-busting.

## Tests

```sh
npm install     # first time only (jsdom, fake-indexeddb)
npm test        # all 11 suites
npm test 07     # one suite, by number prefix
npm run check   # node --check app.js sw.js
```

The suites boot the real `index.html` and `app.js` in jsdom with a mocked PokéAPI and a fake
IndexedDB. They cover the type chart against known matchups, the stat, damage and capture
formulas against canonical values (including a Bulbapedia damage vector), forms, the offline
cache and service worker, loadouts and exact coverage, validated backups and stored-data
sanitising, calculator input handling, the resumable daily game, keyboard and dialog
behaviour, and interactions between these areas. Any failed assertion, uncaught runtime
error or silent suite makes `npm test` exit non-zero.

## Data and limitations

Live data from https://pokeapi.co/api/v2; artwork from PokéAPI's sprite repository.
Requires connectivity for uncached data. The service worker caches the app shell
(network-first) and artwork; PokéAPI data is cached in IndexedDB.

Known gaps:
- Damage uses the Gen 6+ formula but does not model weather, terrain, screens, abilities or
  item multipliers.
- Move legality is taken from PokéAPI's combined learnset rather than per-generation rules.
- Offensive coverage ignores the defender's abilities (Levitate and similar), and
  defensive matchups apply none either.
- Stat rules assume Gen 3+; Gen 1-2 mechanics (DVs, a single Special stat) are not modelled.
- The Living Dex tracks species, not individual forms.
- The Items dex category filter lists only categories of items already fetched, so it fills
  in as you browse.
- English only.

No accounts, backend, analytics, ads or payments. Unofficial fan application, not
affiliated with Nintendo, Game Freak or The Pokémon Company. Publishing under Pokémon
trademarks or monetizing artwork should receive appropriate IP/legal review.
