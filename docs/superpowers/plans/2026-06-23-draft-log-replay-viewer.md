# Draft-Log Replay Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toolbar-opened viewer page to the existing extension that loads a Draftmancer MTGO/MagicProTools draft log and replays the draft pick-by-pick, showing each booster (your pick highlighted), what didn't wheel, and your deck-so-far grouped by mana curve.

**Architecture:** A new MV3 extension page (`viewer.html`) opened by a background service worker on toolbar click. Pure, unit-tested modules parse the log (`log-parser.js`), build a per-pick replay model reusing the existing `wheel-core.js` (`replay.js`), and fetch card data/images from Scryfall (`scryfall.js`). A UI module (`viewer.js`) wires input → parse → replay → fetch → render with keyboard/button navigation.

**Tech Stack:** Vanilla JavaScript (no build step), Manifest V3, Node.js built-in test runner (`node --test`), Scryfall `/cards/collection` API. No third-party dependencies.

## Global Constraints

- **No third-party runtime/test dependencies.** Tests use `node:test` and `node:assert`.
- **Shared/pure modules use the UMD guard** so the same file works as a Node module and a browser global: at file end, `if (typeof module !== "undefined" && module.exports) module.exports = X; if (typeof globalThis !== "undefined") globalThis.X = X;`.
- **All viewer DOM ids/classes are prefixed `dmw-`.**
- **The existing live "didn't wheel" content-script feature and its manifest `content_scripts` entries are untouched.** Manifest stays `manifest_version: 3`, `minimum_chrome_version: "111"`.
- **Card identity for the replay** is a synthesized stable id per `(packNum, cardName)` fed to `wheel-core`. Documented caveat: two different physical copies of the same card name within one pack round collide (rare; at worst slightly mis-attributes a duplicate common in the wheel panel).
- **Card data/images come from Scryfall** `POST https://api.scryfall.com/cards/collection`, ≤75 identifiers per request, preferring `{set, collector_number}` when the log provides them, else `{name}`. Internet required; on failure the UI falls back to names.
- **Card-line format in the log** is either `Card Name` or `Card Name (SET) collector`. The `--> ` prefix marks the picked card in a pick block and the log owner in the `Players:` block.
- Unit-test files live directly in `test/` (the `test` script is `node --test test/*.test.js`, which excludes `test/e2e/`).

---

### Task 1: Log parser

**Files:**
- Create: `src/viewer/log-parser.js`
- Test: `test/log-parser.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseDraftLog(text: string) => { player: string|null, picks: Pick[] }`, exposed as Node export `{ parseDraftLog }` and `globalThis.parseDraftLog`. `Pick = { packNum: number, pickNum: number, cards: CardRef[], pickedIndices: number[] }` (1-indexed packNum/pickNum). `CardRef = { name: string, set?: string, collector?: string }` (set/collector keys present only when the line had them).

- [ ] **Step 1: Write the failing test** in `test/log-parser.test.js`

```js
const test = require("node:test");
const assert = require("node:assert");
const { parseDraftLog } = require("../src/viewer/log-parser.js");

const LOG = `Event #: abc_123
Time: Mon, 01 Jan 2026
Players:
--> Me
    Bot 1

------ TST ------

Pack 1 pick 1:
--> Llanowar Elves
    Shock
    Giant Growth

Pack 1 pick 2:
    Opt (TST) 55
--> Lightning Bolt (TST) 161
`;

test("extracts the log owner from the Players block", () => {
  assert.strictEqual(parseDraftLog(LOG).player, "Me");
});

test("parses pick blocks with plain card lines", () => {
  const { picks } = parseDraftLog(LOG);
  assert.deepStrictEqual(picks[0], {
    packNum: 1,
    pickNum: 1,
    cards: [{ name: "Llanowar Elves" }, { name: "Shock" }, { name: "Giant Growth" }],
    pickedIndices: [0],
  });
});

test("parses set + collector number annotations and the picked index", () => {
  const { picks } = parseDraftLog(LOG);
  assert.deepStrictEqual(picks[1], {
    packNum: 1,
    pickNum: 2,
    cards: [
      { name: "Opt", set: "TST", collector: "55" },
      { name: "Lightning Bolt", set: "TST", collector: "161" },
    ],
    pickedIndices: [1],
  });
});

test("tolerates CRLF line endings", () => {
  const { picks } = parseDraftLog(LOG.replace(/\n/g, "\r\n"));
  assert.strictEqual(picks.length, 2);
  assert.strictEqual(picks[0].cards[0].name, "Llanowar Elves");
});

test("throws a clear error when there are no pick blocks", () => {
  assert.throws(() => parseDraftLog("just some text\nwith no packs"), /Pack .* pick/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/viewer/log-parser.js'`.

- [ ] **Step 3: Implement `src/viewer/log-parser.js`**

```js
// Parses a Draftmancer MTGO / MagicProTools draft log (one player's perspective)
// into structured picks. Each "Pack X pick Y:" block lists every card in that
// booster in order, with "--> " marking the card(s) the owner picked.
function parseDraftLog(text) {
  if (typeof text !== "string") throw new Error("Draft log must be text.");
  const lines = text.split(/\r?\n/);

  let player = null;
  let inPlayers = false;
  const picks = [];
  let current = null;

  const headerRe = /^Pack (\d+) pick (\d+):/;
  // Card line: "--> Name" or "    Name", with optional trailing " (SET) collector".
  const cardRe = /^(?:-->|\s{2,})\s*(.*?)(?: \(([^()]+)\) (\S+))?\s*$/;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (/^Players:/.test(line)) {
      inPlayers = true;
      continue;
    }
    const header = line.match(headerRe);
    if (header) {
      inPlayers = false;
      current = { packNum: parseInt(header[1], 10), pickNum: parseInt(header[2], 10), cards: [], pickedIndices: [] };
      picks.push(current);
      continue;
    }
    if (inPlayers) {
      const m = line.match(/^-->\s+(.*\S)/);
      if (m && player === null) player = m[1];
      continue;
    }
    if (current) {
      if (line.trim() === "" || /^-{3,}/.test(line)) {
        // blank line or "------ banner ------" ends/separates blocks
        if (line.trim() === "") current = null;
        continue;
      }
      const c = line.match(cardRe);
      if (!c) continue;
      const picked = /^-->/.test(line);
      const card = { name: c[1].trim() };
      if (c[2] && c[3]) {
        card.set = c[2];
        card.collector = c[3];
      }
      if (picked) current.pickedIndices.push(current.cards.length);
      current.cards.push(card);
    }
  }

  if (picks.length === 0) {
    throw new Error("No 'Pack X pick Y' blocks found — is this a Draftmancer MTGO/MagicProTools draft log?");
  }
  return { player, picks };
}

if (typeof module !== "undefined" && module.exports) module.exports = { parseDraftLog };
if (typeof globalThis !== "undefined") globalThis.parseDraftLog = parseDraftLog;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `log-parser` tests green; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/viewer/log-parser.js test/log-parser.test.js
git commit -m "feat: MTGO draft-log parser with tests"
```

---

### Task 2: Replay model (reuses wheel-core)

**Files:**
- Create: `src/viewer/replay.js`
- Test: `test/replay.test.js`

**Interfaces:**
- Consumes: `parseDraftLog`'s output shape (`{ player, picks }` with `Pick`/`CardRef` from Task 1); `createWheelTracker` from `src/wheel-core.js` (in Node via `require("../wheel-core.js")`, in the browser via the global set by `wheel-core.js` loaded first).
- Produces: `buildReplay(parsed) => { player, steps }`, exposed as Node export `{ buildReplay }` and `globalThis.buildReplay`. `Step = { packNum, pickNum, cards: StepCard[], didntWheel: CardRef[]|null, deckSoFar: CardRef[] }`. `StepCard = { name, set?, collector?, picked: boolean }`. `didntWheel` is `null` when the pack is not a wheel; otherwise the cards (`CardRef`) that did not wheel back.

- [ ] **Step 1: Write the failing test** in `test/replay.test.js`

```js
const test = require("node:test");
const assert = require("node:assert");
const { buildReplay } = require("../src/viewer/replay.js");

// Pick 1: open {Alpha,Beta,Gamma}, take Alpha.
// Pick 2: a different pack {Delta,Epsilon}, take Delta (first pass, no wheel).
// Pick 3: original pack wheels back as {Beta} (Gamma was taken by someone else); take Beta.
const parsed = {
  player: "Me",
  picks: [
    { packNum: 1, pickNum: 1, cards: [{ name: "Alpha" }, { name: "Beta" }, { name: "Gamma" }], pickedIndices: [0] },
    { packNum: 1, pickNum: 2, cards: [{ name: "Delta" }, { name: "Epsilon" }], pickedIndices: [0] },
    { packNum: 1, pickNum: 3, cards: [{ name: "Beta" }], pickedIndices: [0] },
  ],
};

test("carries the player through", () => {
  assert.strictEqual(buildReplay(parsed).player, "Me");
});

test("first pass has didntWheel null and marks the picked card", () => {
  const { steps } = buildReplay(parsed);
  assert.strictEqual(steps[0].didntWheel, null);
  assert.deepStrictEqual(steps[0].cards.map((c) => c.picked), [true, false, false]);
});

test("deckSoFar accumulates picked cards in pick order", () => {
  const { steps } = buildReplay(parsed);
  assert.deepStrictEqual(steps[0].deckSoFar.map((c) => c.name), ["Alpha"]);
  assert.deepStrictEqual(steps[1].deckSoFar.map((c) => c.name), ["Alpha", "Delta"]);
  assert.deepStrictEqual(steps[2].deckSoFar.map((c) => c.name), ["Alpha", "Delta", "Beta"]);
});

test("the wheel step reports the card others took, excluding your own picks", () => {
  const { steps } = buildReplay(parsed);
  // At pick 3 the pack (Alpha,Beta,Gamma) returns as {Beta}: Gamma didn't wheel;
  // Alpha is excluded as your own pick; Beta is still present.
  assert.deepStrictEqual(steps[2].didntWheel.map((c) => c.name), ["Gamma"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/viewer/replay.js'`.

- [ ] **Step 3: Implement `src/viewer/replay.js`**

```js
// Builds a per-pick replay model from a parsed draft log. Reuses wheel-core's
// uniqueID-based matcher by synthesizing a stable id per (packNum, cardName) so
// the same physical card matches itself as the pack wheels back. Across pack
// rounds ids differ (packNum differs). Caveat: two distinct physical copies of
// the same name within one pack round collide — rare, at worst a slight
// mis-attribution of a duplicate common in the wheel panel.
const createWheelTracker =
  typeof require === "function"
    ? require("../wheel-core.js").createWheelTracker
    : globalThis.createWheelTracker;

function ref(card) {
  const r = { name: card.name };
  if (card.set) r.set = card.set;
  if (card.collector) r.collector = card.collector;
  return r;
}

function buildReplay(parsed) {
  const tracker = createWheelTracker();
  const steps = [];
  const deckSoFar = [];
  const idByKey = new Map();
  let nextId = 1;

  for (const p of parsed.picks) {
    const booster = p.cards.map((c) => {
      const key = p.packNum + " " + c.name;
      let id = idByKey.get(key);
      if (id === undefined) {
        id = nextId++;
        idByKey.set(key, id);
      }
      return { uniqueID: id, name: c.name, set: c.set, collector: c.collector };
    });

    const result = tracker.handleDraftState({
      booster,
      boosterNumber: p.packNum - 1,
      pickNumber: p.pickNum - 1,
    });
    const didntWheel = result && result.isWheel ? result.didntWheel.map(ref) : null;

    const cards = p.cards.map((c, idx) => {
      const r = ref(c);
      r.picked = p.pickedIndices.includes(idx);
      return r;
    });

    for (const idx of p.pickedIndices) {
      if (p.cards[idx]) deckSoFar.push(ref(p.cards[idx]));
    }
    tracker.handlePickCard({ pickedCards: p.pickedIndices });

    steps.push({ packNum: p.packNum, pickNum: p.pickNum, cards, didntWheel, deckSoFar: deckSoFar.slice() });
  }

  return { player: parsed.player, steps };
}

if (typeof module !== "undefined" && module.exports) module.exports = { buildReplay };
if (typeof globalThis !== "undefined") globalThis.buildReplay = buildReplay;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `replay` tests green; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/viewer/replay.js test/replay.test.js
git commit -m "feat: pick-by-pick replay model reusing wheel-core"
```

---

### Task 3: Scryfall card-data fetcher

**Files:**
- Create: `src/viewer/scryfall.js`
- Test: `test/scryfall.test.js`

**Interfaces:**
- Consumes: `CardRef[]` (`{ name, set?, collector? }`).
- Produces: object `Scryfall = { buildIdentifiers, chunk, toCardData, fetchCardData }`, exposed as Node export (`module.exports = Scryfall`) and `globalThis.Scryfall`.
  - `buildIdentifiers(cards) => Array<{name}|{set,collector_number}>` (deduped by lowercased name; `{set,collector_number}` when available).
  - `chunk(arr, size) => arr[][]`.
  - `toCardData(scryfallCard) => { name, imageUrl, cmc, colors, typeLine }`.
  - `fetchCardData(cards, fetchImpl?) => Promise<Map<nameLowercased, CardData>>`. Uses `fetchImpl` (defaults to global `fetch`); POSTs batches of ≤75 to `https://api.scryfall.com/cards/collection`; throws on non-ok response.

- [ ] **Step 1: Write the failing test** in `test/scryfall.test.js`

```js
const test = require("node:test");
const assert = require("node:assert");
const { buildIdentifiers, chunk, toCardData, fetchCardData } = require("../src/viewer/scryfall.js");

test("buildIdentifiers dedupes by name and prefers set+collector", () => {
  const ids = buildIdentifiers([
    { name: "Shock" },
    { name: "Opt", set: "IKO", collector: "55" },
    { name: "Shock" },
  ]);
  assert.deepStrictEqual(ids, [{ name: "Shock" }, { set: "iko", collector_number: "55" }]);
});

test("chunk splits into batches of the given size", () => {
  assert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("toCardData reads image_uris, falling back to the first face", () => {
  assert.deepStrictEqual(
    toCardData({ name: "A", cmc: 3, image_uris: { normal: "a.jpg" }, type_line: "Creature", colors: ["G"] }),
    { name: "A", imageUrl: "a.jpg", cmc: 3, colors: ["G"], typeLine: "Creature" }
  );
  const dfc = toCardData({
    name: "B // C",
    cmc: 2,
    card_faces: [{ image_uris: { normal: "b.jpg" }, colors: ["U"] }],
    type_line: "Sorcery",
  });
  assert.strictEqual(dfc.imageUrl, "b.jpg");
  assert.deepStrictEqual(dfc.colors, ["U"]);
});

test("toCardData defaults a missing cmc to 0 and missing image to empty string", () => {
  const d = toCardData({ name: "X" });
  assert.strictEqual(d.cmc, 0);
  assert.strictEqual(d.imageUrl, "");
});

test("fetchCardData POSTs identifiers and returns a map keyed by lowercased name", async () => {
  const calls = [];
  const stubFetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    const data = JSON.parse(opts.body).identifiers.map((id) => ({
      name: id.name,
      cmc: 1,
      image_uris: { normal: id.name + ".jpg" },
      type_line: "Instant",
      colors: [],
    }));
    return { ok: true, json: async () => ({ data, not_found: [] }) };
  };
  const map = await fetchCardData([{ name: "Shock" }, { name: "Opt" }], stubFetch);
  assert.strictEqual(calls[0].url, "https://api.scryfall.com/cards/collection");
  assert.deepStrictEqual(calls[0].body.identifiers, [{ name: "Shock" }, { name: "Opt" }]);
  assert.strictEqual(map.get("shock").imageUrl, "Shock.jpg");
  assert.strictEqual(map.get("opt").cmc, 1);
});

test("fetchCardData throws on a non-ok response", async () => {
  const stubFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(() => fetchCardData([{ name: "Shock" }], stubFetch), /503/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/viewer/scryfall.js'`.

- [ ] **Step 3: Implement `src/viewer/scryfall.js`**

```js
// Fetches card data + image URLs from Scryfall for the cards in a draft log.
// The log has only names (optionally set+collector), so we resolve them via the
// /cards/collection batch endpoint (<=75 identifiers per request).
function buildIdentifiers(cards) {
  const byName = new Map();
  for (const c of cards) {
    const key = c.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      if (c.set && c.collector) byName.set(key, { set: c.set.toLowerCase(), collector_number: String(c.collector) });
      else byName.set(key, { name: c.name });
    } else if (existing.name && c.set && c.collector) {
      byName.set(key, { set: c.set.toLowerCase(), collector_number: String(c.collector) });
    }
  }
  return [...byName.values()];
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toCardData(card) {
  const face = card.card_faces && card.card_faces[0];
  const imageUrl =
    (card.image_uris && card.image_uris.normal) ||
    (face && face.image_uris && face.image_uris.normal) ||
    "";
  return {
    name: card.name,
    imageUrl,
    cmc: typeof card.cmc === "number" ? card.cmc : 0,
    colors: card.colors || (face && face.colors) || [],
    typeLine: card.type_line || "",
  };
}

async function fetchCardData(cards, fetchImpl) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) throw new Error("No fetch implementation available.");
  const batches = chunk(buildIdentifiers(cards), 75);
  const map = new Map();
  for (let i = 0; i < batches.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 100)); // be gentle on Scryfall
    const res = await f("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: batches[i] }),
    });
    if (!res.ok) throw new Error("Scryfall request failed: " + res.status);
    const json = await res.json();
    for (const card of json.data || []) {
      const data = toCardData(card);
      map.set(data.name.toLowerCase(), data);
    }
  }
  return map;
}

const Scryfall = { buildIdentifiers, chunk, toCardData, fetchCardData };
if (typeof module !== "undefined" && module.exports) module.exports = Scryfall;
if (typeof globalThis !== "undefined") globalThis.Scryfall = Scryfall;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `scryfall` tests green; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/viewer/scryfall.js test/scryfall.test.js
git commit -m "feat: Scryfall card-data fetcher with batching, tested with a stub"
```

---

### Task 4: Viewer page shell + toolbar entry point

**Files:**
- Create: `background.js`
- Create: `viewer.html`
- Create: `src/viewer/viewer.css`
- Modify: `manifest.json`

**Interfaces:**
- Consumes: nothing at runtime yet (the rendering logic is Task 5).
- Produces: clicking the toolbar icon opens `viewer.html` in a new tab; the page shows the landing state (file upload + paste + Load) and empty replay containers with the ids Task 5 will populate.

- [ ] **Step 1: Create `background.js`**

```js
// Opens the replay viewer in a new tab when the toolbar icon is clicked.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
});
```

- [ ] **Step 2: Create `src/viewer/viewer.css`**

```css
body {
  margin: 0;
  font-family: sans-serif;
  background: #16181c;
  color: #eee;
}
#dmw-landing,
#dmw-replay {
  padding: 16px;
}
#dmw-landing textarea {
  width: 100%;
  max-width: 700px;
  display: block;
  margin: 8px 0;
  background: #0e0f12;
  color: #eee;
  border: 1px solid #444;
  border-radius: 4px;
}
button {
  background: #2a6;
  color: #fff;
  border: 0;
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
.dmw-error {
  color: #f77;
  margin-top: 8px;
  min-height: 1em;
}
#dmw-header {
  display: flex;
  align-items: center;
  gap: 12px;
  position: sticky;
  top: 0;
  background: #16181c;
  padding: 8px 0;
  border-bottom: 1px solid #333;
}
#dmw-notice {
  opacity: 0.8;
  font-size: 13px;
}
.dmw-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dmw-card {
  width: 110px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.dmw-card img {
  width: 100%;
  border-radius: 5px;
  transition: transform 0.1s;
}
.dmw-card img:hover {
  transform: scale(1.6);
  position: relative;
  z-index: 5;
}
.dmw-card.dmw-picked img {
  outline: 3px solid #2a6;
  outline-offset: 1px;
}
.dmw-cardname {
  font-size: 12px;
  padding: 2px;
}
#dmw-wheel-section h2 {
  color: #f9a;
}
.dmw-curve {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.dmw-col {
  flex: 1;
  min-width: 90px;
}
.dmw-col-head {
  font-weight: bold;
  border-bottom: 1px solid #444;
  margin-bottom: 4px;
  text-align: center;
}
.dmw-col .dmw-card {
  width: 100%;
  margin-bottom: 4px;
}
```

- [ ] **Step 3: Create `viewer.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Draftmancer Draft Log Replay</title>
    <link rel="stylesheet" href="src/viewer/viewer.css" />
  </head>
  <body>
    <div id="dmw-landing">
      <h1>Draftmancer Draft Log Replay</h1>
      <p>Load a Draftmancer MTGO / MagicProTools draft log to replay your draft pick by pick.</p>
      <input type="file" id="dmw-file" accept=".txt,text/plain" />
      <div>or paste the log below:</div>
      <textarea id="dmw-paste" rows="10" placeholder="Paste your draft log here…"></textarea>
      <button id="dmw-load">Load</button>
      <div id="dmw-error" class="dmw-error"></div>
    </div>

    <div id="dmw-replay" hidden>
      <div id="dmw-header">
        <button id="dmw-prev">◀ Prev</button>
        <span id="dmw-position"></span>
        <button id="dmw-next">Next ▶</button>
        <span id="dmw-notice"></span>
      </div>

      <section id="dmw-booster-section">
        <h2>Booster</h2>
        <div id="dmw-booster" class="dmw-grid"></div>
      </section>

      <section id="dmw-wheel-section" hidden>
        <h2 id="dmw-wheel-title"></h2>
        <div id="dmw-wheel" class="dmw-grid"></div>
      </section>

      <section id="dmw-deck-section">
        <h2 id="dmw-deck-title"></h2>
        <div id="dmw-curve" class="dmw-curve"></div>
      </section>
    </div>

    <script src="src/wheel-core.js"></script>
    <script src="src/viewer/log-parser.js"></script>
    <script src="src/viewer/scryfall.js"></script>
    <script src="src/viewer/replay.js"></script>
    <script src="src/viewer/viewer.js"></script>
  </body>
</html>
```

- [ ] **Step 4: Modify `manifest.json`** — add the action, background worker, and Scryfall host permission. The file currently is:

```json
{
  "manifest_version": 3,
  "name": "Draftmancer Didn't Wheel",
  "version": "0.1.0",
  "description": "Shows which cards from a pack did not wheel back to you during a Draftmancer draft.",
  "minimum_chrome_version": "111",
  "content_scripts": [
    {
      "matches": ["https://draftmancer.com/*", "https://www.draftmancer.com/*"],
      "js": ["src/socketio-frame.js", "src/inject.js"],
      "run_at": "document_start",
      "world": "MAIN"
    },
    {
      "matches": ["https://draftmancer.com/*", "https://www.draftmancer.com/*"],
      "js": ["src/wheel-core.js", "src/content.js"],
      "css": ["src/sidebar.css"],
      "run_at": "document_idle"
    }
  ]
}
```

Add the three top-level keys after `minimum_chrome_version` so the file becomes:

```json
{
  "manifest_version": 3,
  "name": "Draftmancer Didn't Wheel",
  "version": "0.1.0",
  "description": "Shows which cards from a pack did not wheel back to you during a Draftmancer draft.",
  "minimum_chrome_version": "111",
  "action": { "default_title": "Draftmancer Draft Log Replay" },
  "background": { "service_worker": "background.js" },
  "host_permissions": ["https://api.scryfall.com/*"],
  "content_scripts": [
    {
      "matches": ["https://draftmancer.com/*", "https://www.draftmancer.com/*"],
      "js": ["src/socketio-frame.js", "src/inject.js"],
      "run_at": "document_start",
      "world": "MAIN"
    },
    {
      "matches": ["https://draftmancer.com/*", "https://www.draftmancer.com/*"],
      "js": ["src/wheel-core.js", "src/content.js"],
      "css": ["src/sidebar.css"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 5: Verify syntax and manifest validity**

Run: `node --check background.js && node -e "const m=require('./manifest.json'); if(!m.action||!m.background||!m.host_permissions) throw new Error('missing keys'); console.log('manifest ok')"`
Expected: prints `manifest ok` (exit 0).

Run: `npm test`
Expected: PASS — existing unit tests unaffected.

- [ ] **Step 6: Commit**

```bash
git add background.js viewer.html src/viewer/viewer.css manifest.json
git commit -m "feat: viewer page shell + toolbar entry point"
```

---

### Task 5: Viewer UI logic

**Files:**
- Create: `src/viewer/viewer.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: `parseDraftLog` (Task 1), `buildReplay` (Task 2), `Scryfall.fetchCardData` (Task 3), and the DOM ids in `viewer.html` (Task 4).
- Produces: the working replay UI. No Node export (browser-only glue; verified by `node --check` + manual end-to-end).

- [ ] **Step 1: Implement `src/viewer/viewer.js`**

```js
// Wires the viewer page: input -> parse -> build replay -> fetch card data ->
// render booster / didn't-wheel / deck-curve with prev/next + arrow-key nav.
(function () {
  let replay = null; // { player, steps }
  let stepIndex = 0;
  let cardData = new Map(); // nameLowercased -> { imageUrl, cmc, colors, typeLine, name }

  const $ = (id) => document.getElementById(id);
  const COLUMNS = ["0", "1", "2", "3", "4", "5", "6+"];

  function dataFor(name) {
    return cardData.get(name.toLowerCase());
  }

  function cardEl(card, picked) {
    const div = document.createElement("div");
    div.className = "dmw-card" + (picked ? " dmw-picked" : "");
    const d = dataFor(card.name);
    if (d && d.imageUrl) {
      const img = document.createElement("img");
      img.src = d.imageUrl;
      img.alt = card.name;
      img.loading = "lazy";
      div.appendChild(img);
    } else {
      const span = document.createElement("span");
      span.className = "dmw-cardname";
      span.textContent = card.name;
      div.appendChild(span);
    }
    return div;
  }

  function columnFor(name) {
    const d = dataFor(name);
    if (!d) return "?";
    if (d.cmc >= 6) return "6+";
    return String(Math.floor(d.cmc));
  }

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

  function renderStep() {
    const step = replay.steps[stepIndex];
    $("dmw-position").textContent = `Pack ${step.packNum} · Pick ${step.pickNum}  (${stepIndex + 1}/${replay.steps.length})`;
    $("dmw-prev").disabled = stepIndex === 0;
    $("dmw-next").disabled = stepIndex === replay.steps.length - 1;

    const booster = $("dmw-booster");
    booster.innerHTML = "";
    step.cards.forEach((c) => booster.appendChild(cardEl(c, c.picked)));

    const ws = $("dmw-wheel-section");
    if (step.didntWheel) {
      ws.hidden = false;
      $("dmw-wheel-title").textContent = step.didntWheel.length
        ? `Didn't wheel (${step.didntWheel.length})`
        : "Didn't wheel (0) — everything you passed wheeled back";
      const w = $("dmw-wheel");
      w.innerHTML = "";
      step.didntWheel.forEach((c) => w.appendChild(cardEl(c, false)));
    } else {
      ws.hidden = true;
    }

    $("dmw-deck-title").textContent = `Your deck so far (${step.deckSoFar.length})`;
    renderCurve(step.deckSoFar);
  }

  function go(delta) {
    if (!replay) return;
    const n = Math.min(replay.steps.length - 1, Math.max(0, stepIndex + delta));
    if (n !== stepIndex) {
      stepIndex = n;
      renderStep();
    }
  }

  async function load(text) {
    $("dmw-error").textContent = "";
    let parsed;
    try {
      parsed = parseDraftLog(text);
      replay = buildReplay(parsed);
    } catch (e) {
      $("dmw-error").textContent = e.message;
      return;
    }
    stepIndex = 0;
    cardData = new Map();
    $("dmw-landing").hidden = true;
    $("dmw-replay").hidden = false;
    renderStep();

    $("dmw-notice").textContent = "Loading card images…";
    const all = [];
    for (const s of replay.steps) for (const c of s.cards) all.push(c);
    try {
      cardData = await Scryfall.fetchCardData(all);
      $("dmw-notice").textContent = "";
    } catch (e) {
      $("dmw-notice").textContent = "Card images unavailable (Scryfall fetch failed) — showing names.";
    }
    renderStep();
  }

  function init() {
    $("dmw-load").addEventListener("click", () => {
      const file = $("dmw-file").files[0];
      if (file) file.text().then(load);
      else load($("dmw-paste").value || "");
    });
    $("dmw-prev").addEventListener("click", () => go(-1));
    $("dmw-next").addEventListener("click", () => go(1));
    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
```

- [ ] **Step 2: Syntax-check**

Run: `node --check src/viewer/viewer.js`
Expected: exit 0.

- [ ] **Step 3: Add a README section** documenting the viewer. Append to `README.md` after the existing content:

```markdown
## Draft Log Replay viewer

Click the extension's toolbar icon to open the replay viewer in a new tab. Upload
or paste a Draftmancer draft log exported in **MTGO / MagicProTools** format, then
step through your draft pick by pick with the on-screen buttons or the ← / →
arrow keys. Each step shows:

- the booster you faced, with your pick highlighted,
- which cards did not wheel back when a pack returns to you,
- your deck so far, grouped into mana-curve columns.

Card images and data are fetched from Scryfall, so the viewer needs an internet
connection. Requires Chrome 111+.

Note: the log identifies cards by name, so two different physical copies of the
same card name within one pack round can't be told apart — at worst this slightly
mis-attributes a duplicate common in the "didn't wheel" panel.
```

- [ ] **Step 4: Run the full unit suite**

Run: `npm test`
Expected: PASS — all unit tests (log-parser, replay, scryfall, plus the pre-existing socketio-frame and wheel-core) green.

- [ ] **Step 5: Manual end-to-end verification** (record results)

1. Load the unpacked extension (or reload it) at `chrome://extensions`.
2. Click the extension's toolbar icon → the viewer opens in a new tab showing the landing screen.
3. Get a real log: on draftmancer.com, finish/open a draft, and use the draft log's **export to MTGO** (MagicProTools) option to get the text; or paste a known-good log.
4. Paste it and click **Load**. Confirm:
   - The header shows `Pack 1 · Pick 1 (1/N)`; **Prev** is disabled.
   - The booster renders as card images with your pick outlined; card data loads within a couple of seconds (the "Loading card images…" notice clears).
   - Pressing **→** / **Next** advances; the deck-so-far grows and is grouped into mana-curve columns; at the wheel pick a "Didn't wheel (N)" panel appears.
   - **←** / **Prev** goes back; the deck shrinks accordingly.
5. Test the error path: click **Load** with random non-log text → a clear error message appears and the landing screen stays.
6. Confirm the live "didn't wheel" sidebar still works on draftmancer.com (the content-script feature is unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/viewer/viewer.js README.md
git commit -m "feat: viewer UI logic + README"
```

---

## Notes for the implementer

- No bundler; files load directly. The UMD guard lets `log-parser.js`, `replay.js`, and `scryfall.js` serve both `node --test` and the browser page.
- `replay.js` pulls `createWheelTracker` from `src/wheel-core.js` via `require("../wheel-core.js")` in Node and the global in the browser — `viewer.html` loads `wheel-core.js` before `replay.js`.
- Do not add npm dependencies. Tooling is Node's built-in `--test` and `--check`.
- The viewer UI (`viewer.js`) and `background.js` have no automated tests by design — they are browser glue, covered by the Task 5 manual checklist. All non-trivial logic lives in the three tested core modules.
