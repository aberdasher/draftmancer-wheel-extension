# Maindeck-Aware Deck Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the deck/sideboard split from Draftmancer and add a maindeck stats strip (counts, Karsten 40-card sources with top-3 cards, color pips, type breakdown) to the replay viewer.

**Architecture:** A pure `deck-stats.js` computes stats from enriched cards (embedding the Karsten 40-card table). The capture tracks a `sideboard` set from forwarded `moveCard`/`moveAllToSideboard`/`swapDeckAndSideboard` events and stores it with the draft; `replay.js` carries `uniqueID` so the viewer can filter `deckSoFar` to the maindeck and render the stats.

**Tech Stack:** Vanilla JS, no build step, Node's `node --test`. No new dependencies.

## Global Constraints

- No third-party runtime/test dependencies. Tests use `node:test`/`node:assert`.
- Pure modules use the UMD guard: `if (typeof module !== "undefined" && module.exports) module.exports = X; if (typeof globalThis !== "undefined") globalThis.X = X;`.
- All viewer DOM ids/classes are `dmw-` prefixed.
- Karsten 40-card source table, keyed `KARSTEN[pips][cmc]`: `{1:{1:9,2:9,3:8,4:7,5:6,6:6}, 2:{2:14,3:12,4:11,5:10,6:9,7:8}, 3:{3:16,4:14,5:13,6:11,7:10}, 4:{4:17,5:15}}`. Clamp: pips→min(pips,4); cmc→clamp into the row's [minKey,maxKey].
- "Creature/spell/land" split: Land → land; else Creature → creature; else spell. Type-breakdown precedence: Creature > Land > Planeswalker > Instant > Sorcery > Enchantment > Artifact (unknown → not counted).
- Sources: per color, the **max** required across nonland cards + the **top 3** most-demanding cards (sorted by sources desc, then name); gold cards count toward **both** colors; lands excluded.
- Color pips: counts of `W/U/B/R/G` symbols in `manaCost` (hybrid counts toward both).
- Capture stays sidebar-safe (try/catch in content.js) and gated by `sawCleanStart`; `getDraft()` includes `sideboard` only when non-empty.
- No new permission; no change to the live "didn't wheel" sidebar behavior.

---

### Task 1: Deck-stats module (`src/viewer/deck-stats.js`)

**Files:**
- Create: `src/viewer/deck-stats.js`
- Test: `test/deck-stats.test.js`

**Interfaces:**
- Consumes: enriched cards `{ name, cmc, colors, typeLine, manaCost }`.
- Produces: `globalThis.DeckStats` / Node export `DeckStats = { computeStats }`. `computeStats(cards) => { total, creatures, spells, lands, sources, pips, types }` where `sources = { W:{max,top:[{name,sources}]}, … }` (only colors with nonland cards; `top` capped at 3), `pips = {W,U,B,R,G}`, `types = {Creature,Instant,Sorcery,Artifact,Enchantment,Planeswalker,Land}`.

- [ ] **Step 1: Write the failing test** in `test/deck-stats.test.js`

```js
const test = require("node:test");
const assert = require("node:assert");
const { computeStats } = require("../src/viewer/deck-stats.js");

const card = (name, cmc, manaCost, typeLine) => ({ name, cmc, manaCost, typeLine, colors: [] });

test("counts creatures / spells / lands and total", () => {
  const s = computeStats([
    card("Elf", 1, "{G}", "Creature — Elf"),
    card("Bolt", 1, "{R}", "Instant"),
    card("Forest", 0, "", "Basic Land — Forest"),
    card("Golem", 4, "{4}", "Artifact Creature — Golem"),
  ]);
  assert.deepStrictEqual([s.total, s.creatures, s.spells, s.lands], [4, 2, 1, 1]);
});

test("type breakdown uses precedence (Creature > Land > … > Artifact)", () => {
  const s = computeStats([
    card("Golem", 4, "{4}", "Artifact Creature — Golem"), // Creature
    card("Manland", 3, "", "Creature Land"), // Creature (creature beats land)
    card("Signet", 2, "{2}", "Artifact"), // Artifact
    card("Wrath", 4, "{2}{W}{W}", "Sorcery"), // Sorcery
  ]);
  assert.strictEqual(s.types.Creature, 2);
  assert.strictEqual(s.types.Artifact, 1);
  assert.strictEqual(s.types.Sorcery, 1);
});

test("color pips count symbols including hybrid, across costs", () => {
  const s = computeStats([
    card("WW", 2, "{1}{W}{W}", "Sorcery"),
    card("Hybrid", 2, "{W/U}", "Instant"),
  ]);
  assert.strictEqual(s.pips.W, 3); // 2 + 1
  assert.strictEqual(s.pips.U, 1); // hybrid
});

test("sources: max per color (Karsten 40-card) + top 3, lands excluded", () => {
  const s = computeStats([
    card("Wrath", 4, "{2}{W}{W}", "Sorcery"), // pips 2, cmc 4 -> 11
    card("Bear", 2, "{1}{W}", "Creature"), // pips 1, cmc 2 -> 9
    card("Angel", 5, "{3}{W}{W}", "Creature"), // pips 2, cmc 5 -> 10
    card("Plains", 0, "", "Basic Land — Plains"), // land excluded
  ]);
  assert.strictEqual(s.sources.W.max, 11); // Wrath is most demanding
  assert.deepStrictEqual(s.sources.W.top.map((t) => [t.name, t.sources]), [
    ["Wrath", 11],
    ["Angel", 10],
    ["Bear", 9],
  ]);
});

test("a gold card counts toward both colors' source requirements", () => {
  const s = computeStats([card("Gold", 2, "{W}{U}", "Creature")]); // pips 1 each, cmc 2 -> 9 each
  assert.strictEqual(s.sources.W.max, 9);
  assert.strictEqual(s.sources.U.max, 9);
});

test("source lookup clamps out-of-range cmc to the row range", () => {
  // pips 1, cmc 9 -> clamp to cmc 6 -> 6
  const s = computeStats([card("Big", 9, "{8}{W}", "Sorcery")]);
  assert.strictEqual(s.sources.W.max, 6);
});

test("empty deck yields zeros and no source colors", () => {
  const s = computeStats([]);
  assert.deepStrictEqual([s.total, s.creatures, s.spells, s.lands], [0, 0, 0, 0]);
  assert.deepStrictEqual(s.sources, {});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/viewer/deck-stats.js'`.

- [ ] **Step 3: Implement `src/viewer/deck-stats.js`**

```js
// Pure deck-stats over enriched cards { name, cmc, colors, typeLine, manaCost }.
// Embeds Frank Karsten's 40-card "colored sources needed" table.
const KARSTEN = {
  1: { 1: 9, 2: 9, 3: 8, 4: 7, 5: 6, 6: 6 },
  2: { 2: 14, 3: 12, 4: 11, 5: 10, 6: 9, 7: 8 },
  3: { 3: 16, 4: 14, 5: 13, 6: 11, 7: 10 },
  4: { 4: 17, 5: 15 },
};
const COLORS = ["W", "U", "B", "R", "G"];

function cmcOf(c) {
  return typeof c.cmc === "number" && !Number.isNaN(c.cmc) ? c.cmc : 0;
}

function isLand(c) {
  return /land/i.test(c.typeLine || "");
}

function primaryType(typeLine) {
  const t = typeLine || "";
  if (/creature/i.test(t)) return "Creature";
  if (/land/i.test(t)) return "Land";
  if (/planeswalker/i.test(t)) return "Planeswalker";
  if (/instant/i.test(t)) return "Instant";
  if (/sorcery/i.test(t)) return "Sorcery";
  if (/enchantment/i.test(t)) return "Enchantment";
  if (/artifact/i.test(t)) return "Artifact";
  return "Other";
}

function pipsOfColor(manaCost, color) {
  return ((manaCost || "").match(new RegExp(color, "g")) || []).length;
}

function sourcesForCard(pips, cmc) {
  if (pips <= 0) return 0;
  const row = KARSTEN[Math.min(pips, 4)];
  const keys = Object.keys(row).map(Number);
  const lo = Math.min(...keys);
  const hi = Math.max(...keys);
  const c = Math.max(lo, Math.min(cmc, hi));
  return row[c];
}

function computeStats(cards) {
  const list = Array.isArray(cards) ? cards : [];
  let creatures = 0;
  let spells = 0;
  let lands = 0;
  const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const types = { Creature: 0, Instant: 0, Sorcery: 0, Artifact: 0, Enchantment: 0, Planeswalker: 0, Land: 0 };
  const byColor = { W: [], U: [], B: [], R: [], G: [] };

  for (const c of list) {
    const land = isLand(c);
    if (land) lands++;
    else if (/creature/i.test(c.typeLine || "")) creatures++;
    else spells++;

    const pt = primaryType(c.typeLine);
    if (types[pt] != null) types[pt]++;

    for (const color of COLORS) {
      const n = pipsOfColor(c.manaCost, color);
      if (n > 0) {
        pips[color] += n;
        if (!land) byColor[color].push({ name: c.name, sources: sourcesForCard(n, cmcOf(c)) });
      }
    }
  }

  const sources = {};
  for (const color of COLORS) {
    const arr = byColor[color].slice().sort((a, b) => b.sources - a.sources || a.name.localeCompare(b.name));
    if (arr.length) sources[color] = { max: arr[0].sources, top: arr.slice(0, 3) };
  }

  return { total: list.length, creatures, spells, lands, sources, pips, types };
}

const DeckStats = { computeStats };
if (typeof module !== "undefined" && module.exports) module.exports = DeckStats;
if (typeof globalThis !== "undefined") globalThis.DeckStats = DeckStats;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `deck-stats` tests green; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/viewer/deck-stats.js test/deck-stats.test.js
git commit -m "feat: deck-stats module (Karsten sources, pips, types) with tests"
```

---

### Task 2: Scryfall `manaCost`

**Files:**
- Modify: `src/viewer/scryfall.js` (`toCardData`)
- Test: `test/scryfall.test.js`

**Interfaces:**
- Produces: `toCardData` output gains a `manaCost` string (`card.mana_cost`, else the first face's `mana_cost`, else `""`).

- [ ] **Step 1: Add the failing test** to `test/scryfall.test.js`

```js
test("toCardData includes manaCost from mana_cost or the first face", () => {
  assert.strictEqual(toCardData({ name: "A", mana_cost: "{1}{W}" }).manaCost, "{1}{W}");
  assert.strictEqual(
    toCardData({ name: "B // C", card_faces: [{ mana_cost: "{U}", image_uris: { normal: "b.jpg" } }] }).manaCost,
    "{U}"
  );
  assert.strictEqual(toCardData({ name: "X" }).manaCost, "");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `manaCost` is `undefined`.

- [ ] **Step 3: Update `src/viewer/scryfall.js`**

In `toCardData`, the returned object currently ends with `typeLine: card.type_line || "",`. Add a `manaCost` line. The function's `const face = card.card_faces && card.card_faces[0];` is already present. Change the return object to include:

```js
  return {
    name: card.name,
    imageUrl,
    cmc: typeof card.cmc === "number" ? card.cmc : 0,
    colors: card.colors || (face && face.colors) || [],
    typeLine: card.type_line || "",
    manaCost: card.mana_cost || (face && face.mana_cost) || "",
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — new + existing scryfall tests green.

- [ ] **Step 5: Commit**

```bash
git add src/viewer/scryfall.js test/scryfall.test.js
git commit -m "feat: Scryfall toCardData carries manaCost"
```

---

### Task 3: `replay.js` carries `uniqueID` on deck/booster cards

**Files:**
- Modify: `src/viewer/replay.js` (`ref`)
- Test: `test/replay.test.js`

**Interfaces:**
- Produces: `ref()` output (used for `cards`, `deckSoFar`, `didntWheel`) includes `uniqueID` when the source card has a numeric one. Lets the viewer match `deckSoFar` cards against the captured `sideboard` uniqueIDs. Pasted logs (no `uniqueID`) are unchanged.

- [ ] **Step 1: Add the failing test** to `test/replay.test.js`

```js
test("deckSoFar cards carry uniqueID when present (for maindeck filtering)", () => {
  const parsed = {
    player: null,
    picks: [
      { packNum: 1, pickNum: 1, cards: [{ name: "A", uniqueID: 7 }, { name: "B", uniqueID: 8 }], pickedIndices: [0] },
      { packNum: 1, pickNum: 2, cards: [{ name: "C", uniqueID: 9 }], pickedIndices: [0] },
    ],
  };
  const { steps } = buildReplay(parsed);
  assert.strictEqual(steps[1].deckSoFar[0].uniqueID, 7); // A, picked at step 0
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `deckSoFar[0].uniqueID` is `undefined`.

- [ ] **Step 3: Update `src/viewer/replay.js`**

The `ref` function is currently:

```js
function ref(card) {
  const r = { name: card.name };
  if (card.set) r.set = card.set;
  if (card.collector) r.collector = card.collector;
  return r;
}
```

Change it to also carry a numeric `uniqueID`:

```js
function ref(card) {
  const r = { name: card.name };
  if (card.set) r.set = card.set;
  if (card.collector) r.collector = card.collector;
  if (typeof card.uniqueID === "number") r.uniqueID = card.uniqueID;
  return r;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the new test plus all existing replay tests (pasted-log fixtures have no `uniqueID`, so their `ref` output is unchanged) green.

- [ ] **Step 5: Commit**

```bash
git add src/viewer/replay.js test/replay.test.js
git commit -m "feat: replay refs carry uniqueID for maindeck filtering"
```

---

### Task 4: Capture deck/sideboard membership (`src/capture.js`)

**Files:**
- Modify: `src/capture.js`
- Test: `test/capture.test.js`

**Interfaces:**
- Produces: `createDraftCapture()` gains `onMoveCard(uniqueID, zone)`, `onMoveAllToSideboard()`, `onSwapDeckAndSideboard()`, `onRejoinZones(pickedCards)`. `getDraft()` includes `sideboard: number[]` only when the sideboard set is non-empty. The set resets on a new draft (`0/0`). Default membership is main (not in the set).

- [ ] **Step 1: Add the failing test** to `test/capture.test.js`

```js
test("tracks sideboard via moveCard / moveAll / swap and includes it only when non-empty", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [{ name: "A", uniqueID: 1 }, { name: "B", uniqueID: 2 }] });
  cap.onPickCard({ pickedCards: [0] }); // pick A(1)
  cap.onDraftState({ boosterNumber: 0, pickNumber: 1, booster: [{ name: "C", uniqueID: 3 }] });
  cap.onPickCard({ pickedCards: [0] }); // pick C(3)
  assert.strictEqual("sideboard" in cap.getDraft(), false); // none yet

  cap.onMoveCard(1, "side");
  assert.deepStrictEqual(cap.getDraft().sideboard, [1]);
  cap.onMoveCard(1, "main");
  assert.strictEqual("sideboard" in cap.getDraft(), false);

  cap.onMoveAllToSideboard(); // all picked -> side
  assert.deepStrictEqual(cap.getDraft().sideboard.slice().sort(), [1, 3]);
  cap.onSwapDeckAndSideboard(); // complement of {1,3} among picked {1,3} = empty
  assert.strictEqual("sideboard" in cap.getDraft(), false);
});

test("a new draft (0/0) clears the sideboard", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [{ name: "A", uniqueID: 1 }] });
  cap.onPickCard({ pickedCards: [0] });
  cap.onMoveCard(1, "side");
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [{ name: "Z", uniqueID: 9 }] }); // new draft
  assert.strictEqual("sideboard" in cap.getDraft(), false);
});

test("onRejoinZones seeds the sideboard from pickedCards.side", () => {
  const cap = createDraftCapture();
  cap.onRejoinZones({ main: [{ uniqueID: 1 }], side: [{ uniqueID: 2 }, { uniqueID: 3 }] });
  assert.deepStrictEqual(cap.getDraft().sideboard.slice().sort(), [2, 3]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `cap.onMoveCard is not a function`.

- [ ] **Step 3: Update `src/capture.js`**

Add a `sideboard` set and the new methods. After `let current = null;` add:

```js
  const sideboard = new Set(); // uniqueIDs currently in the sideboard (absence = maindeck)
```

In `onDraftState`, the new-draft reset currently is `if (payload.boosterNumber === 0 && payload.pickNumber === 0) picks = [];`. Change it to also clear the sideboard:

```js
    if (payload.boosterNumber === 0 && payload.pickNumber === 0) {
      picks = [];
      sideboard.clear();
    }
```

Add these helpers/methods (e.g. before `getDraft`):

```js
  function pickedIds() {
    const ids = [];
    for (const p of picks) {
      for (const idx of p.pickedIndices) {
        const c = p.cards[idx];
        if (c && typeof c.uniqueID === "number") ids.push(c.uniqueID);
      }
    }
    return ids;
  }

  function onMoveCard(uniqueID, zone) {
    if (zone === "side") sideboard.add(uniqueID);
    else sideboard.delete(uniqueID);
  }

  function onMoveAllToSideboard() {
    for (const id of pickedIds()) sideboard.add(id);
  }

  function onSwapDeckAndSideboard() {
    const all = pickedIds();
    const complement = all.filter((id) => !sideboard.has(id));
    sideboard.clear();
    for (const id of complement) sideboard.add(id);
  }

  function onRejoinZones(pickedCards) {
    if (!pickedCards || !Array.isArray(pickedCards.side)) return;
    sideboard.clear();
    for (const c of pickedCards.side) if (c && typeof c.uniqueID === "number") sideboard.add(c.uniqueID);
  }
```

Change `getDraft` to include `sideboard` only when non-empty:

```js
  function getDraft() {
    const d = { player: null, picks: picks.slice() };
    if (sideboard.size) d.sideboard = [...sideboard];
    return d;
  }
```

And add the new methods to the returned object:

```js
  return { onDraftState, onPickCard, onMoveCard, onMoveAllToSideboard, onSwapDeckAndSideboard, onRejoinZones, getDraft };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — new + existing capture tests green (existing tests have no moves, so `getDraft()` still equals `{ player, picks }`).

- [ ] **Step 5: Commit**

```bash
git add src/capture.js test/capture.test.js
git commit -m "feat: capture tracks deck/sideboard membership"
```

---

### Task 5: Forward move events + route them in the content script

**Files:**
- Modify: `src/inject.js` (forward set)
- Modify: `src/content.js` (route move events; seed zones on rejoin)

**Interfaces:**
- Consumes: `capture.onMoveCard`/`onMoveAllToSideboard`/`onSwapDeckAndSideboard`/`onRejoinZones` (Task 4).
- Produces: deck/sideboard moves reach the capture and are persisted into `dmwDrafts`.

Content-script glue; verified by `node --check` + the Task-6 end-to-end run.

- [ ] **Step 1: Add the move events to `src/inject.js`'s forward set**

The line is currently:

```js
  const FORWARD = new Set(["draftState", "rejoinDraft", "pickCard"]);
```

Change it to:

```js
  const FORWARD = new Set(["draftState", "rejoinDraft", "pickCard", "moveCard", "moveAllToSideboard", "swapDeckAndSideboard"]);
```

- [ ] **Step 2: Route the move events in `src/content.js`**

In the `rejoinDraft` branch, seed sideboard zones. The branch currently is:

```js
    } else if (msg.event === "rejoinDraft") {
      const data = msg.args[0] || {};
      render(tracker.handleRejoin(data.state || {}));
      try { capture.onDraftState(data.state || {}); } catch (_e) { /* ignore */ }
    }
```

Change to:

```js
    } else if (msg.event === "rejoinDraft") {
      const data = msg.args[0] || {};
      render(tracker.handleRejoin(data.state || {}));
      try {
        capture.onDraftState(data.state || {});
        capture.onRejoinZones(data.pickedCards);
      } catch (_e) { /* ignore */ }
    }
```

Then, after the existing `pickCard` branch (the `} else if (msg.event === "pickCard") { … }` block), add three new branches:

```js
    } else if (msg.event === "moveCard") {
      try { capture.onMoveCard(msg.args[0], msg.args[1]); if (sawCleanStart) persistDraft(); } catch (_e) { /* ignore */ }
    } else if (msg.event === "moveAllToSideboard") {
      try { capture.onMoveAllToSideboard(); if (sawCleanStart) persistDraft(); } catch (_e) { /* ignore */ }
    } else if (msg.event === "swapDeckAndSideboard") {
      try { capture.onSwapDeckAndSideboard(); if (sawCleanStart) persistDraft(); } catch (_e) { /* ignore */ }
    }
```

- [ ] **Step 3: Verify**

Run: `node --check src/inject.js && node --check src/content.js`
Expected: exit 0.

Run: `npm test`
Expected: PASS — existing unit tests unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/inject.js src/content.js
git commit -m "feat: capture deck/sideboard moves from the socket"
```

---

### Task 6: Viewer — maindeck filtering + stats strip

**Files:**
- Modify: `viewer.html` (load `deck-stats.js`; add `#dmw-stats` strip)
- Modify: `src/viewer/viewer.css` (stats styling)
- Modify: `src/viewer/viewer.js` (sideboard state; maindeck filtering; `enrichDeck` manaCost/uniqueID; `renderStats`)

**Interfaces:**
- Consumes: `DeckStats.computeStats` (Task 1); `manaCost`/`uniqueID` on cards (Tasks 2–3); the draft's `sideboard` array (Tasks 4–5).
- Produces: the deck columns + stats over the maindeck; a "Sideboard: N" note. No exported API.

Browser glue verified by `node --check` + manual/e2e.

- [ ] **Step 1: Load `deck-stats.js` + add the stats strip in `viewer.html`**

In the script list, add `src/viewer/deck-stats.js` before `viewer.js`. The current tail is:

```html
    <script src="src/viewer/prefs.js"></script>
    <script src="src/history.js"></script>
    <script src="src/viewer/viewer.js"></script>
```

Change to:

```html
    <script src="src/viewer/prefs.js"></script>
    <script src="src/history.js"></script>
    <script src="src/viewer/deck-stats.js"></script>
    <script src="src/viewer/viewer.js"></script>
```

In the deck section, add a stats container right after the deck header. The current deck section starts:

```html
      <section id="dmw-deck-section">
        <div id="dmw-deck-header">
```

Insert a `#dmw-stats` div immediately before `<div id="dmw-deck-header">`:

```html
      <section id="dmw-deck-section">
        <div id="dmw-stats"></div>
        <div id="dmw-deck-header">
```

- [ ] **Step 2: Add stats styling to `src/viewer/viewer.css`**

Append:

```css
#dmw-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 13px;
  margin-bottom: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #333;
}
.dmw-stat-block { max-width: 320px; }
.dmw-stat-head { font-weight: bold; opacity: 0.85; }
.dmw-stat-sub { opacity: 0.8; }
```

- [ ] **Step 3: Add sideboard state + maindeck filtering in `src/viewer/viewer.js`**

After the `let viewedDraftId = null;` declaration, add:

```js
  let currentSideboard = []; // uniqueIDs in the open draft's sideboard
```

Carry `manaCost` and `uniqueID` in `enrichDeck`. The current return object inside `enrichDeck` is:

```js
      return {
        name: c.name,
        set: c.set,
        collector: c.collector,
        cmc: d ? d.cmc : 0,
        colors: d ? d.colors : [],
        typeLine: d ? d.typeLine : "",
      };
```

Change to:

```js
      return {
        name: c.name,
        set: c.set,
        collector: c.collector,
        uniqueID: c.uniqueID,
        cmc: d ? d.cmc : 0,
        colors: d ? d.colors : [],
        typeLine: d ? d.typeLine : "",
        manaCost: d ? d.manaCost : "",
      };
```

- [ ] **Step 4: Add `renderStats` in `src/viewer/viewer.js`**

Add this function (e.g. just above `renderDeck`):

```js
  function renderStats(maindeckEnriched, sideboardCount) {
    const el = $("dmw-stats");
    el.innerHTML = "";
    const s = DeckStats.computeStats(maindeckEnriched);

    const block = (headText, subLines) => {
      const b = document.createElement("div");
      b.className = "dmw-stat-block";
      const h = document.createElement("div");
      h.className = "dmw-stat-head";
      h.textContent = headText;
      b.appendChild(h);
      for (const line of subLines) {
        const d = document.createElement("div");
        d.className = "dmw-stat-sub";
        d.textContent = line;
        b.appendChild(d);
      }
      return b;
    };

    el.appendChild(
      block(`Maindeck: ${s.total}`, [
        `${s.creatures} creatures · ${s.spells} spells · ${s.lands} lands`,
        sideboardCount > 0 ? `Sideboard: ${sideboardCount}` : "",
      ].filter(Boolean))
    );

    const pipLine = ["W", "U", "B", "R", "G"].filter((c) => s.pips[c] > 0).map((c) => `${c} ${s.pips[c]}`).join(" · ");
    el.appendChild(block("Color pips", [pipLine || "—"]));

    const srcColors = Object.keys(s.sources);
    const srcSub = srcColors.length
      ? srcColors.map((c) => `${c}: ${s.sources[c].max} (${s.sources[c].top.map((t) => `${t.name} ${t.sources}`).join(", ")})`)
      : ["—"];
    el.appendChild(block("Sources needed (40-card)", srcSub));

    const typeLine = Object.keys(s.types).filter((t) => s.types[t] > 0).map((t) => `${t} ${s.types[t]}`).join(" · ");
    el.appendChild(block("Types", [typeLine || "—"]));
  }
```

- [ ] **Step 5: Use the maindeck in `renderStep` in `src/viewer/viewer.js`**

The deck-render lines in `renderStep` are currently:

```js
    $("dmw-deck-title").textContent = `Your deck so far (${step.deckSoFar.length})`;
    renderDeck(step.deckSoFar);
```

Replace with (filter to maindeck; render stats + deck over it):

```js
    const sideSet = new Set(currentSideboard);
    const maindeck = step.deckSoFar.filter((c) => !sideSet.has(c.uniqueID));
    $("dmw-deck-title").textContent = `Your deck so far (${maindeck.length})`;
    renderStats(enrichDeck(maindeck), step.deckSoFar.length - maindeck.length);
    renderDeck(maindeck);
```

- [ ] **Step 6: Track `currentSideboard` in `openDraft`, `onDraftsChanged`, and `load` (`src/viewer/viewer.js`)**

In `openDraft`, after `viewedDraftId = draftId;`, add:

```js
      currentSideboard = Array.isArray(draft.sideboard) ? draft.sideboard : [];
```

In `onDraftsChanged`, inside the tail-follow update (after `const draft = list[0];` and its picks check, before `const wasAtEnd = …`), add:

```js
    currentSideboard = Array.isArray(draft.sideboard) ? draft.sideboard : [];
```

In `load(text)`, after the existing `viewedDraftId = null;`, add:

```js
    currentSideboard = []; // external pasted logs have no sideboard data
```

- [ ] **Step 7: Verify**

Run: `node --check src/viewer/viewer.js`
Expected: exit 0.

Run: `npm test`
Expected: PASS — unit tests unaffected.

- [ ] **Step 8: End-to-end verification (controller-run)** (record results)

1. Reload the unpacked extension. Draft a bot draft on draftmancer.com and finish it (so you reach deckbuilding).
2. Open the viewer, open the current draft. The stats strip shows Maindeck counts, color pips, "Sources needed (40-card)" with the top cards per color, and the type breakdown — over your whole pool (nothing sideboarded yet).
3. On draftmancer.com, move some cards to the sideboard (and/or "Move all to sideboard" then add a few back). Confirm the viewer's deck columns shrink to the maindeck, the "Sideboard: N" count appears, and the stats (counts, sources, pips, types) update live to reflect only the maindeck.
4. Confirm pasting an external MTGO log still renders stats over the whole pool (no sideboard), and the live "didn't wheel" sidebar still works.

- [ ] **Step 9: Commit**

```bash
git add viewer.html src/viewer/viewer.css src/viewer/viewer.js
git commit -m "feat: maindeck stats strip with deck/sideboard filtering"
```

---

## Notes for the implementer

- Tasks 1–4 hold the testable logic (stats math, manaCost, uniqueID refs, sideboard tracking); Tasks 5–6 are browser glue covered by the Task-6 end-to-end checklist.
- `deck-stats.js` loads before `viewer.js` (viewer.html); `capture.js` already loads before `content.js` (manifest, unchanged).
- The capture's `sawCleanStart` gate and sidebar-safe try/catch are preserved; `getDraft().sideboard` is omitted when empty so existing capture/draft shapes are unchanged.
- Keep the `dmw-` prefix on every DOM id/class; do not change `wheel-core.js`, the parser, `deck-layout.js`, `history.js`, or `prefs.js`.
