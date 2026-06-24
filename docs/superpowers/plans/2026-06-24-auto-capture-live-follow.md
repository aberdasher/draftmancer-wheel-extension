# Auto-Capture + Live-Following Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-capture the user's draft from draftmancer.com into `chrome.storage`, and let the viewer load it with one click and follow it live as new picks land.

**Architecture:** A pure `capture.js` accumulates picks from the events the content script already receives and writes `dmwLastDraft` to `chrome.storage.local`. `buildReplay` uses real `uniqueID`s when present (exact wheel detection for captured drafts). The viewer gets a "Load my last draft" button, an incremental Scryfall fetch, and a `chrome.storage.onChanged` follow mode with tail-follow.

**Tech Stack:** Vanilla JS, no build step, Node's `node --test`, `chrome.storage.local` + `chrome.storage.onChanged`. No new dependencies.

## Global Constraints

- No third-party runtime/test dependencies. Tests use `node:test`/`node:assert`.
- Pure modules use the UMD guard: `if (typeof module !== "undefined" && module.exports) module.exports = X; if (typeof globalThis !== "undefined") globalThis.X = X;`.
- All viewer/sidebar DOM ids/classes are `dmw-` prefixed.
- Captured draft shape stored under `chrome.storage.local` key `dmwLastDraft`: `{ capturedAt: <ms>, player: null, picks: [{ packNum, pickNum, cards: [{ name, set?, collector?, uniqueID }], pickedIndices: number[] }] }`. `set`/`collector` present only when non-empty.
- New draft detected (capture reset) when a `draftState` has `boosterNumber === 0 && pickNumber === 0`.
- `buildReplay` must keep pasted-MTGO-log behavior identical (synthetic ids when a card has no numeric `uniqueID`).
- The capture/storage code must never break the live sidebar (wrap in try/catch).
- The `storage` permission is already present; no manifest permission change. Only standard booster draft is captured.

---

### Task 1: Capture accumulator (`src/capture.js`)

**Files:**
- Create: `src/capture.js`
- Test: `test/capture.test.js`

**Interfaces:**
- Consumes: live `draftState` payloads (`{ booster, boosterNumber, pickNumber }` where booster items have `name`, `set`, `collector_number`, `uniqueID`) and `pickCard` payloads (`{ pickedCards: number[] }`).
- Produces: `globalThis.createDraftCapture` / Node `module.exports = { createDraftCapture }`. `createDraftCapture()` returns `{ onDraftState(payload), onPickCard(payload), getDraft() }`. `getDraft() => { player: null, picks: [{ packNum, pickNum, cards: [{ name, set?, collector?, uniqueID }], pickedIndices }] }`. Pure (no `chrome`, no `Date`).

- [ ] **Step 1: Write the failing test** in `test/capture.test.js`

```js
const test = require("node:test");
const assert = require("node:assert");
const { createDraftCapture } = require("../src/capture.js");

const liveCard = (name, uniqueID, set, collector) => {
  const c = { name, uniqueID };
  if (set !== undefined) c.set = set;
  if (collector !== undefined) c.collector_number = collector;
  return c;
};

test("records a pick mapping live booster cards (collector_number -> collector, keeps uniqueID)", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [liveCard("Shock", 11, "m21", "159"), liveCard("Opt", 12)] });
  cap.onPickCard({ pickedCards: [0] });
  assert.deepStrictEqual(cap.getDraft(), {
    player: null,
    picks: [
      {
        packNum: 1,
        pickNum: 1,
        cards: [
          { name: "Shock", set: "m21", collector: "159", uniqueID: 11 },
          { name: "Opt", uniqueID: 12 },
        ],
        pickedIndices: [0],
      },
    ],
  });
});

test("omits empty set/collector", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [liveCard("Bear", 5, "", "")] });
  cap.onPickCard({ pickedCards: [0] });
  assert.deepStrictEqual(cap.getDraft().picks[0].cards[0], { name: "Bear", uniqueID: 5 });
});

test("accumulates multiple picks with pack/pick numbers", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [liveCard("A", 1)] });
  cap.onPickCard({ pickedCards: [0] });
  cap.onDraftState({ boosterNumber: 0, pickNumber: 1, booster: [liveCard("B", 2)] });
  cap.onPickCard({ pickedCards: [0] });
  cap.onDraftState({ boosterNumber: 1, pickNumber: 0, booster: [liveCard("C", 3)] });
  cap.onPickCard({ pickedCards: [0] });
  assert.deepStrictEqual(
    cap.getDraft().picks.map((p) => [p.packNum, p.pickNum, p.cards[0].name]),
    [[1, 1, "A"], [1, 2, "B"], [2, 1, "C"]]
  );
});

test("resets on a new draft (boosterNumber 0, pickNumber 0)", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [liveCard("A", 1)] });
  cap.onPickCard({ pickedCards: [0] });
  cap.onDraftState({ boosterNumber: 0, pickNumber: 1, booster: [liveCard("B", 2)] });
  cap.onPickCard({ pickedCards: [0] });
  // a brand-new draft starts
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [liveCard("Z", 9)] });
  cap.onPickCard({ pickedCards: [0] });
  assert.deepStrictEqual(cap.getDraft().picks.map((p) => p.cards[0].name), ["Z"]);
});

test("pack 2 pick 1 (boosterNumber 1, pickNumber 0) does NOT reset", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [liveCard("A", 1)] });
  cap.onPickCard({ pickedCards: [0] });
  cap.onDraftState({ boosterNumber: 1, pickNumber: 0, booster: [liveCard("B", 2)] });
  cap.onPickCard({ pickedCards: [0] });
  assert.strictEqual(cap.getDraft().picks.length, 2);
});

test("onPickCard before any booster is a safe no-op", () => {
  const cap = createDraftCapture();
  assert.deepStrictEqual(cap.onPickCard({ pickedCards: [0] }), { player: null, picks: [] });
});

test("ignores draftState with an empty/absent booster", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [] });
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0 });
  assert.deepStrictEqual(cap.getDraft(), { player: null, picks: [] });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/capture.js'`.

- [ ] **Step 3: Implement `src/capture.js`**

```js
// Accumulates the player's draft from the live socket events the content script
// already receives, into the same shape buildReplay consumes (plus real
// uniqueIDs). Pure: no chrome, no Date — the caller stamps capturedAt.
function createDraftCapture() {
  let picks = [];
  let current = null; // { boosterNumber, pickNumber, booster }

  function mapCard(c) {
    const card = { name: c.name, uniqueID: c.uniqueID };
    if (c.set) card.set = c.set;
    if (c.collector_number) card.collector = c.collector_number;
    return card;
  }

  function onDraftState(payload) {
    if (!payload || !Array.isArray(payload.booster) || payload.booster.length === 0) return;
    if (payload.boosterNumber === 0 && payload.pickNumber === 0) picks = []; // new draft
    current = { boosterNumber: payload.boosterNumber, pickNumber: payload.pickNumber, booster: payload.booster };
  }

  function onPickCard(payload) {
    if (!current || !payload) return getDraft();
    const indices = Array.isArray(payload.pickedCards) ? payload.pickedCards.slice() : [];
    picks.push({
      packNum: current.boosterNumber + 1,
      pickNum: current.pickNumber + 1,
      cards: current.booster.map(mapCard),
      pickedIndices: indices,
    });
    return getDraft();
  }

  function getDraft() {
    return { player: null, picks: picks.slice() };
  }

  return { onDraftState, onPickCard, getDraft };
}

if (typeof module !== "undefined" && module.exports) module.exports = { createDraftCapture };
if (typeof globalThis !== "undefined") globalThis.createDraftCapture = createDraftCapture;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `capture` tests green; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/capture.js test/capture.test.js
git commit -m "feat: draft capture accumulator with tests"
```

---

### Task 2: Use real uniqueIDs in `buildReplay`

**Files:**
- Modify: `src/viewer/replay.js` (the booster id assignment in `buildReplay`)
- Test: `test/replay.test.js` (add one test)

**Interfaces:**
- Consumes: parsed picks whose cards may carry a numeric `uniqueID` (captured drafts) or not (pasted logs).
- Produces: unchanged `buildReplay` signature. When a card has a numeric `uniqueID`, that id is used directly; otherwise the existing synthetic `(packNum, lineage, name)` id is used.

- [ ] **Step 1: Add the failing test** to `test/replay.test.js`

```js
test("uses real uniqueIDs when present (captured drafts), wheel without players", () => {
  // No `players` field; cards carry real uniqueIDs (as captured live).
  const parsed = {
    player: null,
    picks: [
      { packNum: 1, pickNum: 1, cards: [{ name: "A", uniqueID: 1 }, { name: "B", uniqueID: 2 }, { name: "C", uniqueID: 3 }], pickedIndices: [0] },
      { packNum: 1, pickNum: 2, cards: [{ name: "D", uniqueID: 4 }, { name: "E", uniqueID: 5 }], pickedIndices: [0] },
      { packNum: 1, pickNum: 3, cards: [{ name: "B", uniqueID: 2 }], pickedIndices: [0] }, // pack 1 returns; B same uniqueID
    ],
  };
  const { steps } = buildReplay(parsed);
  // At pick 3 the pack (A,B,C) returns as {B}: C didn't wheel; A excluded as own pick.
  assert.deepStrictEqual(steps[2].didntWheel.map((c) => c.name), ["C"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — without real-uniqueID support, `podSize` is 0 (no `players`), so the synthetic ids make every pick its own pack and `steps[2].didntWheel` is `null` (or not `["C"]`).

- [ ] **Step 3: Update `src/viewer/replay.js`**

The current booster-build loop body is:

```js
    const booster = p.cards.map((c) => {
      const key = p.packNum + " " + lineage + " " + c.name;
      let id = idByKey.get(key);
      if (id === undefined) {
        id = nextId++;
        idByKey.set(key, id);
      }
      const item = { uniqueID: id, name: c.name };
      if (c.set) item.set = c.set;
      if (c.collector) item.collector = c.collector;
      return item;
    });
```

Replace it with (prefer a card's real `uniqueID`):

```js
    const booster = p.cards.map((c) => {
      let id;
      if (typeof c.uniqueID === "number") {
        id = c.uniqueID; // captured drafts carry real, table-stable uniqueIDs
      } else {
        const key = p.packNum + " " + lineage + " " + c.name;
        id = idByKey.get(key);
        if (id === undefined) {
          id = nextId++;
          idByKey.set(key, id);
        }
      }
      const item = { uniqueID: id, name: c.name };
      if (c.set) item.set = c.set;
      if (c.collector) item.collector = c.collector;
      return item;
    });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the new test plus all existing `replay` tests (pasted-log/synthetic path unchanged) green.

- [ ] **Step 5: Commit**

```bash
git add src/viewer/replay.js test/replay.test.js
git commit -m "feat: buildReplay uses real uniqueIDs when present (captured drafts)"
```

---

### Task 3: Incremental Scryfall fetch helper

**Files:**
- Modify: `src/viewer/scryfall.js` (add `filterUnknown`)
- Test: `test/scryfall.test.js` (add tests)

**Interfaces:**
- Consumes: a `cards` array and a `known` object with a `.has(lowercasedName)` method (a `Map` keyed by lowercased name, like the viewer's `cardData`, or a `Set`).
- Produces: `Scryfall.filterUnknown(cards, known) => card[]` — the subset of `cards` whose `name.toLowerCase()` is not in `known`. Added to the exported `Scryfall` object.

- [ ] **Step 1: Add the failing test** to `test/scryfall.test.js`

```js
test("filterUnknown returns only cards whose lowercased name is not in known", () => {
  const known = new Set(["shock"]);
  const out = Scryfall.filterUnknown([{ name: "Shock" }, { name: "Opt" }, { name: "shock" }], known);
  assert.deepStrictEqual(out.map((c) => c.name), ["Opt"]);
});

test("filterUnknown works with a Map keyed by lowercased name", () => {
  const known = new Map([["opt", { name: "Opt" }]]);
  const out = Scryfall.filterUnknown([{ name: "Opt" }, { name: "Bolt" }], known);
  assert.deepStrictEqual(out.map((c) => c.name), ["Bolt"]);
});
```

(`Scryfall` is already imported at the top of `test/scryfall.test.js` — reuse it. If only the destructured helpers are imported, also reference `Scryfall` via `require("../src/viewer/scryfall.js")`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Scryfall.filterUnknown is not a function`.

- [ ] **Step 3: Update `src/viewer/scryfall.js`**

Add this function (e.g. after `chunk`):

```js
function filterUnknown(cards, known) {
  return cards.filter((c) => !known.has(c.name.toLowerCase()));
}
```

And add it to the exported object — change:

```js
const Scryfall = { buildIdentifiers, chunk, toCardData, fetchCardData };
```

to:

```js
const Scryfall = { buildIdentifiers, chunk, toCardData, fetchCardData, filterUnknown };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — new + existing scryfall tests green.

- [ ] **Step 5: Commit**

```bash
git add src/viewer/scryfall.js test/scryfall.test.js
git commit -m "feat: Scryfall.filterUnknown for incremental fetch"
```

---

### Task 4: Wire capture into the content script + manifest

**Files:**
- Modify: `src/content.js` (feed events into a capture, persist `dmwLastDraft`)
- Modify: `manifest.json` (load `src/capture.js` before `src/content.js`)

**Interfaces:**
- Consumes: `createDraftCapture` (Task 1, loaded as a content-script global before `content.js`); `chrome.storage.local`.
- Produces: after each pick, `chrome.storage.local` key `dmwLastDraft` is written with the captured draft plus `capturedAt`.

This is content-script glue; verified by `node --check` + the Task 6 end-to-end run (no unit test).

- [ ] **Step 1: Add `capture.js` to the content-script list in `manifest.json`**

The second (isolated-world) content-script entry's `js` is currently:

```json
      "js": ["src/wheel-core.js", "src/content.js"],
```

Change it to (capture before content so `createDraftCapture` exists):

```json
      "js": ["src/wheel-core.js", "src/capture.js", "src/content.js"],
```

- [ ] **Step 2: Add capture + persistence to `src/content.js`**

After the existing `const tracker = createWheelTracker();` line, add a capture instance and a persist helper:

```js
  // Draft capture (createDraftCapture is a content-script global from capture.js).
  const capture = createDraftCapture();
  function persistDraft() {
    try {
      const area = (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) || null;
      if (!area) return;
      area.set({ dmwLastDraft: Object.assign({ capturedAt: Date.now() }, capture.getDraft()) });
    } catch (_e) {
      /* never break the sidebar */
    }
  }
```

Then extend the message handler so capture runs alongside the sidebar. The current handler body is:

```js
    if (msg.event === "draftState") {
      render(tracker.handleDraftState(msg.args[0]));
    } else if (msg.event === "rejoinDraft") {
      const data = msg.args[0] || {};
      render(tracker.handleRejoin(data.state || {}));
    } else if (msg.event === "pickCard") {
      tracker.handlePickCard(msg.args[0]);
    }
```

Replace it with:

```js
    if (msg.event === "draftState") {
      render(tracker.handleDraftState(msg.args[0]));
      try { capture.onDraftState(msg.args[0]); } catch (_e) { /* ignore */ }
    } else if (msg.event === "rejoinDraft") {
      const data = msg.args[0] || {};
      render(tracker.handleRejoin(data.state || {}));
      try { capture.onDraftState(data.state || {}); } catch (_e) { /* ignore */ }
    } else if (msg.event === "pickCard") {
      tracker.handlePickCard(msg.args[0]);
      try { capture.onPickCard(msg.args[0]); persistDraft(); } catch (_e) { /* ignore */ }
    }
```

- [ ] **Step 3: Verify**

Run: `node --check src/content.js`
Expected: exit 0.

Run: `node -e "const m=require('./manifest.json'); const js=m.content_scripts[1].js; if(JSON.stringify(js)!==JSON.stringify(['src/wheel-core.js','src/capture.js','src/content.js'])) throw new Error('content js order wrong'); console.log('manifest ok')"`
Expected: prints `manifest ok`.

Run: `npm test`
Expected: PASS — existing unit tests unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/content.js manifest.json
git commit -m "feat: capture the live draft into chrome.storage (dmwLastDraft)"
```

---

### Task 5: Viewer — "Load my last draft" button + incremental fetch

**Files:**
- Modify: `viewer.html` (the button on the landing screen)
- Modify: `src/viewer/viewer.js` (storage helper, incremental `loadCardData`, refactor `load`, add `loadLastDraft`, button label, wiring)

**Interfaces:**
- Consumes: `buildReplay`, `Scryfall.fetchCardData`, `Scryfall.filterUnknown`, `chrome.storage.local`, the `dmwLastDraft` shape (Task 1/4).
- Produces: a working "Load my last draft" button that loads the captured draft into the replay; an incremental `loadCardData()` reused for follow updates (Task 6). Introduces a module-level `let following = false;` (used by Task 6).

Browser glue verified by `node --check` + manual/e2e.

- [ ] **Step 1: Add the button to `viewer.html`**

In the `#dmw-landing` block, after the existing Load button (`<button id="dmw-load">Load</button>`), add:

```html
      <button id="dmw-load-last" disabled>Load my last draft</button>
```

- [ ] **Step 2: Add a `following` flag + a storage helper in `src/viewer/viewer.js`**

After the existing state declarations near the top of the IIFE (the `splitCreatures` line), add:

```js
  let following = false; // viewer is tracking the live-captured draft
```

Add this helper (e.g. just above `function load(`):

```js
  function storageLocal() {
    return (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) || null;
  }
```

- [ ] **Step 3: Replace the inline fetch in `load()` with an incremental `loadCardData()`**

Add this function (e.g. just above `function load(`):

```js
  // Fetch Scryfall data only for cards not already cached, merging into cardData.
  async function loadCardData() {
    const all = [];
    for (const s of replay.steps) for (const c of s.cards) all.push(c);
    const missing = Scryfall.filterUnknown(all, cardData);
    if (missing.length === 0) {
      $("dmw-notice").textContent = "";
      return;
    }
    $("dmw-notice").textContent = "Loading card images…";
    try {
      const more = await Scryfall.fetchCardData(missing);
      for (const [k, v] of more) cardData.set(k, v);
      $("dmw-notice").textContent = "";
    } catch (e) {
      $("dmw-notice").textContent = "Card images unavailable (Scryfall fetch failed) — showing names.";
    }
  }
```

Then change the body of `load(text)` from:

```js
    stepIndex = 0;
    revealed = false;
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
```

to:

```js
    following = false; // loading an external log exits follow mode
    stepIndex = 0;
    revealed = false;
    cardData = new Map();
    $("dmw-landing").hidden = true;
    $("dmw-replay").hidden = false;
    renderStep();
    await loadCardData();
    renderStep();
```

- [ ] **Step 4: Add `loadLastDraft()` and a button-label refresher in `src/viewer/viewer.js`**

Add these functions (e.g. after `load`):

```js
  function loadLastDraft() {
    $("dmw-error").textContent = "";
    const area = storageLocal();
    if (!area) {
      $("dmw-error").textContent = "Storage unavailable.";
      return;
    }
    area.get("dmwLastDraft", async (data) => {
      const draft = data && data.dmwLastDraft;
      if (!draft || !draft.picks || draft.picks.length === 0) {
        $("dmw-error").textContent = "No saved draft yet — draft on draftmancer.com first.";
        return;
      }
      following = true;
      replay = buildReplay(draft);
      stepIndex = replay.steps.length - 1; // jump to the latest pick
      revealed = false;
      cardData = new Map();
      $("dmw-landing").hidden = true;
      $("dmw-replay").hidden = false;
      renderStep();
      await loadCardData();
      renderStep();
    });
  }

  function refreshLastDraftButton() {
    const btn = $("dmw-load-last");
    const area = storageLocal();
    if (!area) {
      btn.disabled = true;
      btn.textContent = "Load my last draft (unavailable)";
      return;
    }
    area.get("dmwLastDraft", (data) => {
      const d = data && data.dmwLastDraft;
      if (d && d.picks && d.picks.length) {
        const when = new Date(d.capturedAt || 0).toLocaleString();
        btn.disabled = false;
        btn.textContent = `Load my last draft — ${when} · ${d.picks.length} picks`;
      } else {
        btn.disabled = true;
        btn.textContent = "Load my last draft (none captured yet)";
      }
    });
  }
```

- [ ] **Step 5: Wire the button in `init()` in `src/viewer/viewer.js`**

Inside `init()`, after the `#dmw-load` click listener, add:

```js
    $("dmw-load-last").addEventListener("click", loadLastDraft);
    refreshLastDraftButton();
```

- [ ] **Step 6: Verify**

Run: `node --check src/viewer/viewer.js`
Expected: exit 0.

Run: `npm test`
Expected: PASS — unit tests unaffected.

- [ ] **Step 7: Manual sanity** (the full live flow is verified in Task 6)

1. Reload the unpacked extension; open the viewer. With no captured draft yet, the "Load my last draft" button shows "(none captured yet)" and is disabled.
2. Pasting a normal MTGO log still loads and steps as before (regression check).

- [ ] **Step 8: Commit**

```bash
git add viewer.html src/viewer/viewer.js
git commit -m "feat: viewer 'Load my last draft' button + incremental card fetch"
```

---

### Task 6: Viewer — live-follow via storage changes

**Files:**
- Modify: `src/viewer/viewer.js` (register a `chrome.storage.onChanged` listener with tail-follow)

**Interfaces:**
- Consumes: `following` (Task 5), `buildReplay`, `loadCardData`, `renderStep`, `chrome.storage.onChanged`.
- Produces: when `following` and `dmwLastDraft` changes, the viewer rebuilds the replay and re-renders, advancing to the newest pick only if already at the edge.

Browser glue verified by `node --check` + the Task-6 end-to-end run.

- [ ] **Step 1: Add the follow listener in `src/viewer/viewer.js`**

Add this function (e.g. after `loadLastDraft`):

```js
  function onLastDraftChanged(changes, area) {
    if (area !== "local" || !changes.dmwLastDraft || !following || !replay) return;
    const draft = changes.dmwLastDraft.newValue;
    if (!draft || !draft.picks || draft.picks.length === 0) return;
    const wasAtEnd = stepIndex === replay.steps.length - 1;
    replay = buildReplay(draft);
    stepIndex = wasAtEnd ? replay.steps.length - 1 : Math.min(stepIndex, replay.steps.length - 1);
    renderStep();
    loadCardData().then(renderStep);
  }
```

- [ ] **Step 2: Register the listener in `init()` in `src/viewer/viewer.js`**

Inside `init()`, after the `refreshLastDraftButton();` line added in Task 5, add:

```js
    const area = (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) || null;
    if (area) chrome.storage.onChanged.addListener(onLastDraftChanged);
```

- [ ] **Step 3: Verify**

Run: `node --check src/viewer/viewer.js`
Expected: exit 0.

Run: `npm test`
Expected: PASS — unit tests unaffected.

- [ ] **Step 4: End-to-end verification (controller-run)** (record results)

1. Reload the unpacked extension. Open the viewer tab and the draftmancer.com tab.
2. Start a bot draft on draftmancer.com and make a pick or two so a draft is captured.
3. In the viewer, click **Load my last draft** — it loads and jumps to the latest pick; the booster, deck, and "didn't wheel" panel render.
4. Make another pick on draftmancer.com. The viewer **auto-advances** to the new pick within a moment (tail-follow), the deck grows, and the position counter increments — without reloading.
5. In the viewer, press **Prev** to review an earlier pick, then make another pick on draftmancer.com: the viewer does **not** jump (your position is kept) but the `/N` count grows.
6. The live "didn't wheel" sidebar on draftmancer.com still works (capture is additive).

- [ ] **Step 5: Commit**

```bash
git add src/viewer/viewer.js
git commit -m "feat: viewer live-follow of the captured draft via storage changes"
```

---

## Notes for the implementer

- Tasks 1–3 hold the testable logic (capture accumulation, real-uniqueID replay, incremental-fetch filter). Tasks 4–6 are browser glue covered by the Task-6 end-to-end checklist.
- `capture.js` loads before `content.js` (manifest); the viewer does NOT load `capture.js` (it reads `dmwLastDraft` and calls `buildReplay` directly).
- Capture/persist code in `content.js` is wrapped in try/catch so it can never break the live sidebar.
- Keep the `dmw-` prefix on every DOM id/class; do not change `wheel-core.js`, the parser, `deck-layout.js`, `prefs.js`, or the manifest beyond the one `js`-list edit.
