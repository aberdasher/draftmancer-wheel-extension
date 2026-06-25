# Maindeck-Aware Deck Stats — Design

**Date:** 2026-06-24
**Status:** Approved design, pre-implementation
**Stacked on:** `2026-feat/draft-history` → `feat/auto-capture-live-follow` → `master`

## Purpose

Add a stats strip to the replay viewer's deck section that summarizes your
**maindeck** (not your whole pool). Requires capturing the deck/sideboard split
from Draftmancer (all socket-based), then computing stats over the maindeck.

## Part A — Capture deck/sideboard membership

Draftmancer emits deck/sideboard moves over the socket (we forward them like
`pickCard`, via the MAIN-world injector):

- `moveCard <uniqueID> "main"|"side"` — a single card moved.
- `moveAllToSideboard` — all picked cards → sideboard.
- `swapDeckAndSideboard` — swap deck ↔ sideboard.
- On rejoin, `data.state` is unchanged, but `rejoinDraft`'s payload carries
  `pickedCards.main` / `pickedCards.side` (already used for the capture's pick
  reconstruction context) — the authoritative split on reconnect.

The capture tracks a **`sideboardIds` set** (uniqueIDs currently in the
sideboard). Picked cards default to **main** (absent from the set):

- `moveCard(id, "side")` → add `id`; `moveCard(id, "main")` → remove `id`.
- `moveAllToSideboard` → set = all picked uniqueIDs.
- `swapDeckAndSideboard` → set = (all picked uniqueIDs) minus current set (complement).
- On a new draft (`0/0`) the set resets.
- On rejoin with `pickedCards.side`, seed the set from those uniqueIDs.

`getDraft()` includes **`sideboard: number[]`** (the set as an array). Stored
draft entries (`dmwDrafts`) therefore carry `sideboard`. Because moves flow
through the same persist + live-follow path, the viewer's stats update **as you
cut cards during deckbuilding**.

Forwarding the new events: `inject.js`'s forward set gains `moveCard`,
`moveAllToSideboard`, `swapDeckAndSideboard`. `content.js` feeds them into the
capture and persists (inside the existing try/catch, gated by `sawCleanStart`).

## Part B — Maindeck filtering + stats panel

### Maindeck filtering
The viewer derives **maindeck** = the step's `deckSoFar` cards whose `uniqueID`
is **not** in the draft's `sideboard` array. The deck columns and the stats both
use the maindeck; a **"Sideboard: N"** note shows how many drafted cards were
cut. (Before deckbuilding, `sideboard` is empty, so maindeck = pool — identical
to today.)

### Stats (over the maindeck), shown in a strip at the top of the deck section
- **Counts:** total · creatures / spells / lands. Classify each card: Land →
  land; else Creature → creature; else spell.
- **Sources needed (40-card):** for each color present, the **maximum** colored
  sources any maindeck card requires (Karsten's 40-card table), plus the **top 3
  most-demanding cards** (name + their required sources, highest first). Gold
  cards count toward **both** colors (each computed treating the other color's
  pips as generic toward CMC); lands excluded.
- **Color pips:** W/U/B/R/G colored-symbol counts across maindeck `manaCost`s
  (hybrid `{W/U}` counts toward both).
- **Type breakdown:** counts per primary type — Creature / Instant / Sorcery /
  Artifact / Enchantment / Planeswalker / Land (precedence
  Creature > Land > Planeswalker > Instant > Sorcery > Enchantment > Artifact).

### Karsten 40-card source table (keyed by colored pips × total mana value)

| pips \ CMC | =pips | +1 | +2 | +3 | +4 | +5 |
|---|---|---|---|---|---|---|
| 1 | 9 | 9 | 8 | 7 | 6 | 6 |
| 2 | 14 | 12 | 11 | 10 | 9 | 8 |
| 3 | 16 | 14 | 13 | 11 | 10 | (10) |
| 4 | 17 | 15 | (15) | (15) | (15) | (15) |

Clamping: pips capped at 4; for a (pips, CMC) beyond the listed range, use the
last value in that pip-row (higher CMC with the same pips never needs *more*
sources). `(…)` entries above are the clamped fallbacks.

## Code shape

- `src/inject.js`: add `moveCard`, `moveAllToSideboard`, `swapDeckAndSideboard`
  to the forwarded-events set.
- `src/capture.js`: track `sideboardIds`; handlers `onMoveCard(id, zone)`,
  `onMoveAllToSideboard()`, `onSwapDeckAndSideboard()`, reset on new draft, seed
  from rejoin; `getDraft()` adds `sideboard`.
- `src/content.js`: in the message handler, route the new events to the capture
  and persist (try/catch, `sawCleanStart` gate).
- **New `src/viewer/deck-stats.js`** (pure, unit-tested): `computeStats(cards) =>
  { total, creatures, spells, lands, sources, pips, types }` where `sources` is
  `{ W: { max, top: [{ name, sources }] }, … }` (top capped at 3). Helpers
  `isLand`, `primaryType`, `countPips`, `sourcesForCard(pips, cmc)` with the
  embedded table. Operates on enriched cards `{ name, cmc, colors, typeLine, manaCost, uniqueID }`.
- `src/viewer/scryfall.js`: `toCardData` adds `manaCost` (`card.mana_cost` or the
  first face's) — + test.
- `src/viewer/viewer.js`: track the open draft's `sideboard` array; compute
  maindeck (filter `deckSoFar` by it) for the deck columns and stats; carry
  `manaCost` in `enrichDeck`; `renderStats(maindeck)`; show the "Sideboard: N"
  note.
- `viewer.html` / `viewer.css`: `#dmw-stats` strip (+ sideboard note) in the deck
  section; styling. All `dmw-` prefixed.

## Testing

- `src/viewer/deck-stats.js`: TDD — counts and land/creature/spell split; Karsten
  lookup incl. clamping; per-color max + top-3 (sorted, capped); gold-card counts
  toward both colors; pip counting incl. hybrid; type precedence; empty maindeck.
- `src/capture.js`: TDD — `sideboardIds` via move/moveAll/swap, default-main,
  reset on new draft, rejoin seeding; `getDraft().sideboard`.
- `src/viewer/scryfall.js`: TDD — `manaCost` from `mana_cost` and from a face.
- Viewer + capture: manual + Puppeteer e2e — draft, sideboard some cards, confirm
  the deck columns and stats reflect the maindeck and the "Sideboard: N" count,
  updating live as cards are moved.

## Out of scope (YAGNI)

- Rendering the sideboard's individual cards (count only).
- Mana-symbol icons (text labels only).
- Non-40-card Karsten columns.
- Tracking basics/lands added during deckbuilding beyond captured picks.
- Changing the live "didn't wheel" sidebar.
