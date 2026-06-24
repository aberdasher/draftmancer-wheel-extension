# Stacked Deck Columns + Sort/Split Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the replay viewer's flat mana-curve deck grid with Draftmancer-style stacked columns, a CMC/Color sort selector, and a creature/non-creature split toggle.

**Architecture:** A new pure, unit-tested module `src/viewer/deck-layout.js` groups enriched deck cards into columns (by CMC or color) and splits creatures from non-creatures. `viewer.js` enriches `deckSoFar` from the Scryfall `cardData` map and renders stacked columns from the module's output; `viewer.html`/`viewer.css` add the controls and stacked styling. No Scryfall change (cmc/colors/type_line are already fetched).

**Tech Stack:** Vanilla JS, no build step, Node's `node --test`. No new dependencies.

## Global Constraints

- No third-party runtime/test dependencies. Tests use `node:test`/`node:assert`.
- Pure modules use the UMD guard: `if (typeof module !== "undefined" && module.exports) module.exports = X; if (typeof globalThis !== "undefined") globalThis.X = X;`.
- All viewer DOM ids/classes are `dmw-` prefixed.
- Only the deck-so-far area changes; the booster and "didn't wheel" panels stay flat image grids.
- Sort modes: **CMC** (default) and **Color** only (no rarity/type). CMC columns `0,1,2,3,4,5,6+`; Color columns `W,U,B,R,G,Multi,Colorless`. Empty columns are shown with count 0.
- "Creature" = `type_line` contains "Creature" (case-insensitive). Split default OFF.
- No manifest change; no change to the live content-script feature.

---

### Task 1: Deck layout module (`src/viewer/deck-layout.js`)

**Files:**
- Create: `src/viewer/deck-layout.js`
- Test: `test/deck-layout.test.js`

**Interfaces:**
- Consumes: enriched card objects `{ name, cmc, colors, typeLine }` (plain data).
- Produces: `globalThis.DeckLayout` / Node `module.exports = DeckLayout` where
  `DeckLayout = { isCreature, splitByCreature, columnize }`:
  - `isCreature(card) => boolean`
  - `splitByCreature(cards) => { creatures: card[], others: card[] }` (input order preserved within each group)
  - `columnize(cards, mode) => [{ label: string, cards: card[] }]` for `mode ∈ {"cmc","color"}`; returns all fixed columns (including empty ones) in fixed order; each column's cards sorted by cmc then name.

- [ ] **Step 1: Write the failing test** in `test/deck-layout.test.js`

```js
const test = require("node:test");
const assert = require("node:assert");
const { isCreature, splitByCreature, columnize } = require("../src/viewer/deck-layout.js");

const card = (name, cmc, colors, typeLine) => ({ name, cmc, colors, typeLine });

test("isCreature matches Creature type lines (incl. compound), else false", () => {
  assert.strictEqual(isCreature(card("Elf", 1, ["G"], "Creature — Elf")), true);
  assert.strictEqual(isCreature(card("Golem", 4, [], "Artifact Creature — Golem")), true);
  assert.strictEqual(isCreature(card("Bolt", 1, ["R"], "Instant")), false);
  assert.strictEqual(isCreature(card("Forest", 0, [], "Basic Land — Forest")), false);
  assert.strictEqual(isCreature({ name: "Mystery" }), false); // no typeLine
});

test("splitByCreature partitions preserving order", () => {
  const cards = [
    card("Elf", 1, ["G"], "Creature — Elf"),
    card("Bolt", 1, ["R"], "Instant"),
    card("Bear", 2, ["G"], "Creature — Bear"),
  ];
  const { creatures, others } = splitByCreature(cards);
  assert.deepStrictEqual(creatures.map((c) => c.name), ["Elf", "Bear"]);
  assert.deepStrictEqual(others.map((c) => c.name), ["Bolt"]);
});

test("columnize by cmc buckets into 0..6+ with all fixed columns present", () => {
  const cards = [
    card("Opt", 1, ["U"], "Instant"),
    card("Bear", 2, ["G"], "Creature"),
    card("Wrath", 4, ["W"], "Sorcery"),
    card("Dragon", 6, ["R"], "Creature"),
    card("Titan", 7, ["G"], "Creature"),
    card("Mox", 0, [], "Artifact"),
  ];
  const cols = columnize(cards, "cmc");
  assert.deepStrictEqual(cols.map((c) => c.label), ["0", "1", "2", "3", "4", "5", "6+"]);
  assert.deepStrictEqual(cols.find((c) => c.label === "0").cards.map((c) => c.name), ["Mox"]);
  assert.deepStrictEqual(cols.find((c) => c.label === "6+").cards.map((c) => c.name), ["Dragon", "Titan"]); // cmc 6 then 7
  assert.deepStrictEqual(cols.find((c) => c.label === "5").cards, []); // empty column present
});

test("columnize by cmc treats missing cmc as 0", () => {
  const cols = columnize([{ name: "X", colors: [], typeLine: "Instant" }], "cmc");
  assert.deepStrictEqual(cols.find((c) => c.label === "0").cards.map((c) => c.name), ["X"]);
});

test("columnize by color buckets mono/multi/colorless with all fixed columns", () => {
  const cards = [
    card("Plains guy", 2, ["W"], "Creature"),
    card("Merfolk", 1, ["U"], "Creature"),
    card("Hybrid", 3, ["W", "U"], "Creature"),
    card("Golem", 4, [], "Artifact Creature"),
  ];
  const cols = columnize(cards, "color");
  assert.deepStrictEqual(cols.map((c) => c.label), ["W", "U", "B", "R", "G", "Multi", "Colorless"]);
  assert.deepStrictEqual(cols.find((c) => c.label === "W").cards.map((c) => c.name), ["Plains guy"]);
  assert.deepStrictEqual(cols.find((c) => c.label === "Multi").cards.map((c) => c.name), ["Hybrid"]);
  assert.deepStrictEqual(cols.find((c) => c.label === "Colorless").cards.map((c) => c.name), ["Golem"]);
});

test("cards within a column are sorted by cmc then name", () => {
  const cards = [
    card("Zebra", 2, ["G"], "Creature"),
    card("Apple", 2, ["G"], "Creature"),
    card("Ant", 1, ["G"], "Creature"),
  ];
  const col = columnize(cards, "color").find((c) => c.label === "G");
  assert.deepStrictEqual(col.cards.map((c) => c.name), ["Ant", "Apple", "Zebra"]); // cmc1 first, then cmc2 by name
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/viewer/deck-layout.js'`.

- [ ] **Step 3: Implement `src/viewer/deck-layout.js`**

```js
// Pure deck-layout helpers for the replay viewer: split creatures from the rest
// and group cards into stacked columns by CMC or color. Operates on enriched
// card objects { name, cmc, colors, typeLine } so it is testable without the DOM.
const CMC_LABELS = ["0", "1", "2", "3", "4", "5", "6+"];
const COLOR_LABELS = ["W", "U", "B", "R", "G", "Multi", "Colorless"];

function isCreature(card) {
  return /creature/i.test((card && card.typeLine) || "");
}

function splitByCreature(cards) {
  const creatures = [];
  const others = [];
  for (const c of cards) (isCreature(c) ? creatures : others).push(c);
  return { creatures, others };
}

function cmcOf(card) {
  return typeof card.cmc === "number" && !Number.isNaN(card.cmc) ? card.cmc : 0;
}

function cmcLabel(card) {
  const v = cmcOf(card);
  return v >= 6 ? "6+" : String(Math.floor(v));
}

function colorLabel(card) {
  const colors = Array.isArray(card.colors) ? card.colors : [];
  if (colors.length > 1) return "Multi";
  if (colors.length === 1) return colors[0];
  return "Colorless";
}

function inColumnOrder(a, b) {
  const d = cmcOf(a) - cmcOf(b);
  return d !== 0 ? d : a.name.localeCompare(b.name);
}

function columnize(cards, mode) {
  const labels = mode === "color" ? COLOR_LABELS : CMC_LABELS;
  const labelOf = mode === "color" ? colorLabel : cmcLabel;
  const buckets = {};
  for (const label of labels) buckets[label] = [];
  for (const c of cards) {
    const label = labelOf(c);
    if (!buckets[label]) buckets[label] = []; // defensive: unexpected color code
    buckets[label].push(c);
  }
  // Fixed labels first (incl. empties), then any unexpected labels appended.
  const ordered = labels.concat(Object.keys(buckets).filter((l) => !labels.includes(l)));
  return ordered.map((label) => ({ label, cards: buckets[label].slice().sort(inColumnOrder) }));
}

const DeckLayout = { isCreature, splitByCreature, columnize };
if (typeof module !== "undefined" && module.exports) module.exports = DeckLayout;
if (typeof globalThis !== "undefined") globalThis.DeckLayout = DeckLayout;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `deck-layout` tests green; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/viewer/deck-layout.js test/deck-layout.test.js
git commit -m "feat: deck-layout module (cmc/color columnize + creature split) with tests"
```

---

### Task 2: Viewer integration — stacked columns, sort buttons, split toggle

**Files:**
- Modify: `viewer.html` (deck section header controls; load `deck-layout.js`)
- Modify: `src/viewer/viewer.js` (state, enrich, `renderDeck`, wiring; remove old `renderCurve`/`columnFor`/`COLUMNS`)
- Modify: `src/viewer/viewer.css` (stacked-column + controls styling)

**Interfaces:**
- Consumes: `DeckLayout.columnize` / `DeckLayout.splitByCreature` (Task 1); the existing `cardEl`, `dataFor`, `renderStep`, and the Scryfall `cardData` map.
- Produces: UI only. New ids: `#dmw-deck` (deck container, replaces `#dmw-curve`), `#dmw-sort-cmc`, `#dmw-sort-color`, `#dmw-split`. No exported API.

Browser glue verified by `node --check` + manual/e2e (no unit test).

- [ ] **Step 1: Update the deck section in `viewer.html`**

Replace:

```html
      <section id="dmw-deck-section">
        <h2 id="dmw-deck-title"></h2>
        <div id="dmw-curve" class="dmw-curve"></div>
      </section>
```

with:

```html
      <section id="dmw-deck-section">
        <div id="dmw-deck-header">
          <h2 id="dmw-deck-title"></h2>
          <span class="dmw-deck-controls">
            <span class="dmw-sortlabel">Sort:</span>
            <button id="dmw-sort-cmc" class="dmw-sortbtn dmw-active">CMC</button>
            <button id="dmw-sort-color" class="dmw-sortbtn">Color</button>
            <label class="dmw-toggle"><input type="checkbox" id="dmw-split" /> Split creatures</label>
          </span>
        </div>
        <div id="dmw-deck"></div>
      </section>
```

- [ ] **Step 2: Load `deck-layout.js` in `viewer.html`**

In the script list near the bottom of `viewer.html`, add `deck-layout.js` before `viewer.js`. The current list is:

```html
    <script src="src/wheel-core.js"></script>
    <script src="src/viewer/log-parser.js"></script>
    <script src="src/viewer/scryfall.js"></script>
    <script src="src/viewer/replay.js"></script>
    <script src="src/viewer/viewer.js"></script>
```

Change it to:

```html
    <script src="src/wheel-core.js"></script>
    <script src="src/viewer/log-parser.js"></script>
    <script src="src/viewer/scryfall.js"></script>
    <script src="src/viewer/replay.js"></script>
    <script src="src/viewer/deck-layout.js"></script>
    <script src="src/viewer/viewer.js"></script>
```

- [ ] **Step 3: Update `src/viewer/viewer.js` — remove the old curve code**

Delete the `COLUMNS` constant (currently line 9):

```js
  const COLUMNS = ["0", "1", "2", "3", "4", "5", "6+"];
```

Delete the `columnFor` function (currently lines ~34-39):

```js
  function columnFor(name) {
    const d = dataFor(name);
    if (!d) return "?";
    if (d.cmc >= 6) return "6+";
    return String(Math.floor(d.cmc));
  }
```

Delete the entire `renderCurve` function (currently lines ~41-64):

```js
  function renderCurve(deck) {
    const curve = $("dmw-curve");
    curve.innerHTML = "";
    const cols = {};
    for (const label of COLUMNS) cols[label] = [];
    const unknown = [];
    for (const c of deck) {
      const col = columnFor(c.name);
      if (col === "?") unknown.push(c);
      else cols[col].push(c);
    }
    const labels = unknown.length ? COLUMNS.concat(["?"]) : COLUMNS;
    for (const label of labels) {
      const list = label === "?" ? unknown : cols[label];
      const colEl = document.createElement("div");
      colEl.className = "dmw-col";
      const head = document.createElement("div");
      head.className = "dmw-col-head";
      head.textContent = `${label} (${list.length})`;
      colEl.appendChild(head);
      list.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((c) => colEl.appendChild(cardEl(c, false)));
      curve.appendChild(colEl);
    }
  }
```

- [ ] **Step 4: Add deck state + enrichment + `renderDeck` in `src/viewer/viewer.js`**

Add two state variables next to the existing `hidePick`/`revealed` declarations near the top of the IIFE:

```js
  let deckSort = "cmc"; // "cmc" | "color"
  let splitCreatures = false;
```

Add these functions (place them where `renderCurve` was removed):

```js
  // Merge a deck card ref with its Scryfall data so DeckLayout can group it.
  function enrichDeck(deck) {
    return deck.map((c) => {
      const d = dataFor(c.name);
      return {
        name: c.name,
        set: c.set,
        collector: c.collector,
        cmc: d ? d.cmc : 0,
        colors: d ? d.colors : [],
        typeLine: d ? d.typeLine : "",
      };
    });
  }

  function renderColumns(container, cards) {
    for (const col of DeckLayout.columnize(cards, deckSort)) {
      const colEl = document.createElement("div");
      colEl.className = "dmw-col";
      const head = document.createElement("div");
      head.className = "dmw-col-head";
      head.textContent = `${col.label} (${col.cards.length})`;
      colEl.appendChild(head);
      const stack = document.createElement("div");
      stack.className = "dmw-stack";
      col.cards.forEach((c) => stack.appendChild(cardEl(c, false)));
      colEl.appendChild(stack);
      container.appendChild(colEl);
    }
  }

  function renderDeck(deck) {
    const enriched = enrichDeck(deck);
    const root = $("dmw-deck");
    root.innerHTML = "";
    if (splitCreatures) {
      const { creatures, others } = DeckLayout.splitByCreature(enriched);
      for (const [label, group] of [["Creatures", creatures], ["Non-creatures", others]]) {
        const row = document.createElement("div");
        row.className = "dmw-deck-row";
        const h = document.createElement("div");
        h.className = "dmw-row-head";
        h.textContent = `${label} (${group.length})`;
        row.appendChild(h);
        const cols = document.createElement("div");
        cols.className = "dmw-cols";
        renderColumns(cols, group);
        row.appendChild(cols);
        root.appendChild(row);
      }
    } else {
      const cols = document.createElement("div");
      cols.className = "dmw-cols";
      renderColumns(cols, enriched);
      root.appendChild(cols);
    }
  }
```

- [ ] **Step 5: Call `renderDeck` from `renderStep` in `src/viewer/viewer.js`**

The current last line of `renderStep()` is:

```js
    renderCurve(step.deckSoFar);
```

Replace it with:

```js
    renderDeck(step.deckSoFar);
```

(Leave the `$("dmw-deck-title").textContent = ...` line directly above it unchanged.)

- [ ] **Step 6: Wire the controls in `init()` in `src/viewer/viewer.js`**

Add, inside `init()` after the existing reveal-button listener:

```js
    function setSort(mode) {
      deckSort = mode;
      $("dmw-sort-cmc").classList.toggle("dmw-active", mode === "cmc");
      $("dmw-sort-color").classList.toggle("dmw-active", mode === "color");
      if (replay) renderStep();
    }
    $("dmw-sort-cmc").addEventListener("click", () => setSort("cmc"));
    $("dmw-sort-color").addEventListener("click", () => setSort("color"));
    $("dmw-split").addEventListener("change", (e) => {
      splitCreatures = e.target.checked;
      if (replay) renderStep();
    });
```

- [ ] **Step 7: Replace the deck styles in `src/viewer/viewer.css`**

Remove the old `.dmw-curve` rule:

```css
.dmw-curve {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
```

Append the new deck styles:

```css
#dmw-deck-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.dmw-deck-controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.dmw-sortlabel {
  font-size: 13px;
  opacity: 0.8;
}
.dmw-sortbtn.dmw-active {
  outline: 2px solid #2a6;
  outline-offset: 1px;
}
.dmw-row-head {
  font-weight: bold;
  font-size: 13px;
  margin: 6px 0 2px;
  opacity: 0.85;
}
.dmw-cols {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.dmw-stack {
  display: flex;
  flex-direction: column;
}
/* Overlap stacked cards so only each card's title strip shows (margin-% is
   relative to width; card art aspect ≈ 1.4× width, so ~-1.18 reveals the top). */
.dmw-stack .dmw-card {
  width: 100%;
}
.dmw-stack .dmw-card:not(:first-child) {
  margin-top: -118%;
}
.dmw-stack .dmw-card:hover {
  z-index: 10;
}
```

(The existing `.dmw-card`, `.dmw-card img:hover { transform: scale(1.6) }`, `.dmw-col`, and `.dmw-col-head` rules stay; `.dmw-card` already sets `position` via the hover/img rules — if `z-index` does not take effect during the e2e check, add `position: relative;` to `.dmw-stack .dmw-card`.)

- [ ] **Step 8: Syntax-check + unit tests**

Run: `node --check src/viewer/viewer.js`
Expected: exit 0.

Run: `npm test`
Expected: PASS — all unit tests (incl. Task 1's deck-layout) green; viewer glue isn't picked up by the runner.

- [ ] **Step 9: Manual / e2e verification** (record results)

1. Reload the unpacked extension; open the viewer; load a real Draftmancer MTGO log and advance a few picks so the deck has cards.
2. The deck renders as **stacked columns** (cards overlap; only title strips show; hovering a card shows full art above its neighbors).
3. Default sort is **CMC** (button marked active); columns are `0..6+` with counts.
4. Click **Color**: the deck re-columns into `W,U,B,R,G,Multi,Colorless`; the active marker moves.
5. Check **Split creatures**: two labeled rows appear — **Creatures** and **Non-creatures** — each with its own columns for the active sort. Uncheck: back to one row.
6. Confirm the booster and "didn't wheel" panels are unchanged (still flat image grids), and the existing live "didn't wheel" sidebar on draftmancer.com still works.

If the stacked overlap looks wrong (too much/little of each card showing, or hover art clipped), tune `.dmw-stack .dmw-card:not(:first-child) { margin-top }` and add `position: relative` to `.dmw-stack .dmw-card`; re-verify.

- [ ] **Step 10: Commit**

```bash
git add viewer.html src/viewer/viewer.js src/viewer/viewer.css
git commit -m "feat: stacked deck columns with CMC/Color sort and creature split"
```

---

## Notes for the implementer

- Task 1 holds all the testable logic; Task 2 is browser glue covered by the manual/e2e checklist.
- Keep the `dmw-` prefix on every new id/class.
- Do not change `replay.js`, the parser, Scryfall, `wheel-core.js`, the manifest, or the live content-script feature.
- The stacked-overlap `margin-top` is an approximation to tune visually in Step 9; the logic (which cards go in which column/row) is fixed and tested in Task 1.
