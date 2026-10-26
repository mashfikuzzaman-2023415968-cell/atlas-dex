# AtlasDex

A Pokémon field guide, team planner and living-dex tracker, built as a dependency-free
HTML/CSS/JavaScript progressive web app.

## Features

### Command palette
`Ctrl/Cmd+K` from anywhere. Searches species, moves, abilities and items in one list and
jumps to any tool. Arrow keys and Enter to navigate.

### Moves, Abilities and Items dexes
Three browsable reference tables with search, filtering and lazy row hydration.
Clicking any row opens a detail page: moves show type, category, power, accuracy, PP,
priority, effect text and every Pokémon that learns them; abilities show their effect and
every Pokémon that has them; items show category, cost, fling power, sprite and effect.
Pokémon names throughout are clickable and jump straight to that species.

### Calculators
Five tools in one view:
- **Stats** — Gen 3+ formula converting base stats to real stats from level, nature, IVs and EVs.
  Also embedded in every Pokémon's Stats tab, prefilled with that Pokémon's bases.
- **Team Damage** — pick an attacker, its move and a defender from your team; stats, STAB
  and effectiveness are read from the real builds.
- **Damage (manual)** — the same Gen 5+ formula with every input entered by hand.
- **Catch rate** — Gen 5+ capture formula including all four shake checks, across ball types,
  status conditions and remaining HP.
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
- **Exact offensive coverage.** The Team Builder heatmap switches from approximating
  coverage via typing to calculating it from the damaging moves actually assigned, and
  says which mode it is in.
- **Team damage calculator.** Pick an attacker, one of its real moves, and a defender.
  Real stats, STAB and type effectiveness are all derived rather than typed in.
- **Complete Showdown export.** Item, ability, level, EV line, nature, non-default IVs
  and real move list.

### Multiple saved teams
Up to eight named teams with tab switching, renaming and deletion. Each gets the full
coverage analysis. Teams export to Pokémon Showdown format via the clipboard, with full builds.

### Backup and restore
Favorites, living dex progress, saved teams, compare slots, game streak and settings
export to a JSON file and import back. Everything otherwise lives in one browser's
localStorage.

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
download of the entire National Dex with live progress, pause/resume, storage reporting
via `navigator.storage.estimate()`, and a cache reset. The service worker separately
caches official artwork from GitHub's raw host, so images survive offline too.

### Who's That Pokémon?
A silhouette guessing game. The daily challenge is five Pokémon seeded from the date with
a `mulberry32` PRNG, so every player worldwide gets an identical puzzle, and it drives a
streak counter with a personal best. Results share as an emoji grid copied to the
clipboard. Endless practice mode adds a per-generation difficulty filter.

### Browse
- National Pokédex species list, fetched dynamically from PokéAPI
- Search by name or National Dex ID
- Filter by generation, elemental type, caught status, or Legendary/Mythical
- Sort by Pokédex number, name, or base stat total
- Shiny artwork toggle across the whole app
- Dark/light theme, keyboard shortcuts, installable PWA shell

### Pokémon detail (seven tabs)
- **Overview** — dex entry, physical facts, ability descriptions pulled from the ability endpoint
- **Stats** — base stat bars, stat total, and a live real-stat calculator
- **Matchups** — full defensive type profile: 4×/2× weaknesses, resistances and immunities
- **Evolution** — evolution family with trigger conditions
- **Breeding** — egg groups, gender ratio, hatch steps, habitat, shape, baby form
- **Moves** — sortable table with type, power, accuracy, PP and level, filterable by learn method
- **Encounters** — wild locations per game version, with levels and rates

### Team Builder
Pick up to six Pokémon and AtlasDex analyzes the team:
- **Shared weaknesses** — types that hit half your team or more
- **Offensive blind spots** — types nobody on the team can hit super-effectively
- **Solid against** — types widely resisted with no team member vulnerable
- **Power level** — average base stat total with an interpretation
- **Coverage heatmap** — all 18 types, defense and offense side by side
- A floating team dock follows you while browsing

### Living Dex
- Mark any Pokémon caught with the ◉ button
- Completion ring, per-generation progress bars, "next to catch" shortlist
- Progress saved in the browser

### Type Matchup Calculator
Standalone tool: pick an attacking type and up to two defending types for the exact
multiplier, plus the full chart against that defensive typing.

### Compare
Two Pokémon side by side with base stats, typing and defensive weaknesses.

## Implementation notes

All network traffic is cache-first through IndexedDB (`get()` wraps `netGet()`), falling
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

## Tests

```sh
node --check app.js && node --check sw.js
```

The repository was additionally verified with a headless jsdom smoke test covering all
views, plus a unit test of the type chart against known matchups (Charizard's 4× Rock
weakness, Sableye's Fighting immunity, Scizor's 4× Fire weakness, and so on).

A fourth suite covers loadouts end to end: calculated stats against hand-checked values
(base 130 Attack reaching 150 neutral, 165 Adamant, 200 with 252 EVs), EV limit warnings,
move assignment, the approximate-to-exact coverage switch, the full Showdown export and
the team damage calculator.

A third suite covers the battle formulas against canonical values (Garchomp's 346 Attack at
level 100 with an Adamant nature and 31/252, Shedinja's fixed 1 HP, STAB and burn modifiers,
Master Ball certainty), plus the three new dexes, all five calculators, multi-team
management, Showdown and JSON export, and the command palette.

A second suite covers form switching (verifying matchups recompute when a form changes
typing), the IndexedDB cache (verifying repeat reads issue no network calls), and the
game (verifying the daily challenge is deterministic across replays).

## Data and limitations

Live data from https://pokeapi.co/api/v2; artwork from PokéAPI's sprite repository.
Requires connectivity for uncached data; the service worker caches only the app shell.

Known gaps: damage does not model weather, terrain, screens, abilities or item multipliers,
and move legality is taken from PokéAPI's combined learnset rather than per-generation
rules. Offensive coverage in the Team Builder is approximated from each member's own typing (STAB), not from their actual movesets.
Ability effects such as Levitate are not applied to defensive matchups.

No accounts, backend, analytics, ads or payments. Unofficial fan application, not
affiliated with Nintendo, Game Freak or The Pokémon Company. Publishing under Pokémon
trademarks or monetizing artwork should receive appropriate IP/legal review.
