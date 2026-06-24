# Replay Deck Area: Stacked Columns + Sort/Split Controls — Design

**Date:** 2026-06-24
**Status:** Approved design, pre-implementation

## Purpose

Replace the replay viewer's flat mana-curve deck grid with a Draftmancer-style
**stacked-column** deck view, plus controls to choose how the deck is sorted and
to optionally split it into creatures vs non-creatures. Only the **deck-so-far**
area changes; the booster and "didn't wheel" panels remain flat image grids.

## Layout

Within a column, cards **overlap vertically** so only each card's title strip is
visible; hovering a card raises it to full art (reusing the existing hover-scale).
Each column has a small header showing its label and card count.

## Controls (in the deck section header)

- **Sort** — two buttons, **CMC** and **Color**; default **CMC**; the active one
  is visually marked.
  - *CMC* → columns `0, 1, 2, 3, 4, 5, 6+`.
  - *Color* → columns `W, U, B, R, G, Multi, Colorless` (WUBRG order, then
    multicolor, then colorless/lands).
- **Split creatures / non-creatures** — a checkbox; default **off**. When on, the
  deck shows **two stacked rows**: top **Creatures**, bottom **Non-creatures**,
  each row independently laid out into the active sort's columns. Off → one row.

"Creature" = a card whose Scryfall `type_line` contains "Creature" (case
insensitive; covers Artifact/Enchantment Creatures). Everything else (including
cards with unknown type data) is non-creature.

## Column rules

- Fixed column sets per mode (empty columns are still shown with a count of 0, so
  curve/color gaps are visible).
- Cards within a column are sorted by CMC ascending, then by name.
- Cards with unknown CMC (Scryfall data missing) sort as CMC 0 for ordering and
  land in the `0` column under CMC mode; under Color mode they fall into their
  color bucket (or Colorless if no colors).

## Code shape

### New pure module `src/viewer/deck-layout.js` (UMD, unit-tested)

Operates on enriched card objects `{ name, cmc, colors, typeLine }` (plain data,
so it is testable without the DOM or Scryfall):

- `isCreature(card) => boolean` — `/creature/i.test(card.typeLine || "")`.
- `splitByCreature(cards) => { creatures: card[], others: card[] }` — preserves
  input order within each group.
- `columnize(cards, mode) => [{ label, cards }]` for `mode ∈ {"cmc","color"}`:
  - `"cmc"`: labels `["0","1","2","3","4","5","6+"]`; a card's column is
    `cmc >= 6 ? "6+" : String(Math.floor(cmc))` (missing cmc → `0`).
  - `"color"`: labels `["W","U","B","R","G","Multi","Colorless"]`; >1 color →
    `Multi`, exactly 1 → that color, 0/none → `Colorless`.
  - Each column's `cards` sorted by `cmc` then `name`. All fixed columns are
    returned, including empty ones.

Exposed as `globalThis.DeckLayout = { isCreature, splitByCreature, columnize }`
and the Node `module.exports` equivalent, using the project's UMD guard.

### `viewer.js`

- New deck state: `deckSort = "cmc"`, `splitCreatures = false`.
- Build enriched deck cards by merging each `deckSoFar` ref with the Scryfall
  `cardData` map (`cmc`, `colors`, `typeLine`; defaults `0` / `[]` / `""` when a
  card's data is missing).
- Replace `renderCurve` with `renderDeck`: when `splitCreatures` is off, render one
  row via `columnize(enriched, deckSort)`; when on, render two labeled rows from
  `splitByCreature`, each columnized. Render each column as a stacked set of
  `cardEl`s under a column header.
- Wire the sort buttons (set `deckSort`, re-render) and the split checkbox (set
  `splitCreatures`, re-render). Re-render only when a replay is loaded.

### `viewer.html`

- Add the sort buttons (`#dmw-sort-cmc`, `#dmw-sort-color`) and split checkbox
  (`#dmw-split`) to the deck section header. The deck container id stays
  `#dmw-curve` (now rendered as stacked columns) or is renamed to `#dmw-deck`
  — implementer's choice, kept consistent across html/js. All ids/classes
  `dmw-` prefixed.

### `viewer.css`

- Stacked-column styling: a column is a vertical flex; each card after the first
  gets a negative top margin so only its title strip shows; hovering raises
  `z-index` and lifts the card to full art. Column headers styled like the
  existing `.dmw-col-head`. Active sort button marked (e.g. `.dmw-active`). The
  exact overlap amount is tuned during the e2e verification.

## Testing

- `src/viewer/deck-layout.js`: TDD unit tests — CMC columnization (including the
  `6+` bucket and empty columns), Color columnization (mono/multi/colorless),
  in-column ordering (CMC then name), `isCreature`, and `splitByCreature`.
- Viewer UI + CSS: manual + Puppeteer e2e — toggling CMC↔Color re-columns the
  deck; the split checkbox produces two rows (creatures / non-creatures); stacked
  cards render and hover-enlarge.

## Out of scope (YAGNI)

- Rarity and type sort modes (only CMC and Color).
- Drag-and-drop reordering of the deck (read-only replay).
- Persisting sort/split preferences across sessions.
- Restyling the booster or "didn't wheel" panels.
- Any change to the live content-script "didn't wheel" feature.
