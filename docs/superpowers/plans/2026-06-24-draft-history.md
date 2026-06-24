# Draft History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the last 3 auto-captured drafts in a rolling list and let the viewer list and reopen any of them (the newest is live-followable).

**Architecture:** A pure `history.js` maintains the rolling list (`upsertCurrent`/`findById`, keyed by `draftId`). The content script stamps a `draftId` at each clean draft start and maintains `chrome.storage.local.dmwDrafts` (≤3) via that helper, migrating any legacy `dmwLastDraft`. The viewer renders a history list, opens a draft by `draftId`, and live-follows only the current (newest) entry.

**Tech Stack:** Vanilla JS, no build step, Node's `node --test`, `chrome.storage.local` + `onChanged`. No new dependencies.

## Global Constraints

- No third-party runtime/test dependencies. Tests use `node:test`/`node:assert`.
- Pure modules use the UMD guard: `if (typeof module !== "undefined" && module.exports) module.exports = X; if (typeof globalThis !== "undefined") globalThis.X = X;`.
- All viewer/sidebar DOM ids/classes are `dmw-` prefixed.
- Storage key `dmwDrafts`: array, newest first, capped at **3**; each entry `{ draftId, capturedAt, player, picks }`. `draftId` is the draft's start timestamp (ms).
- The current draft is `dmwDrafts[0]`, updated each pick; a new clean start (`draftState` at `boosterNumber 0 / pickNumber 0`) prepends a new entry. Only cleanly-started drafts persist (the `sawCleanStart` gate stays).
- Capture/persist must never break the live sidebar (try/catch).
- Only the current (newest) draft live-follows; older entries are static.
- The `storage` permission is already present; no permission change.

---

### Task 1: History list module (`src/history.js`)

**Files:**
- Create: `src/history.js`
- Test: `test/history.test.js`

**Interfaces:**
- Consumes: draft entry objects `{ draftId, capturedAt, player, picks }`.
- Produces: `globalThis.DraftHistory` / Node `module.exports = DraftHistory` where `DraftHistory = { upsertCurrent, findById }`:
  - `upsertCurrent(list, draft, cap = 3) => newList` — if `list[0].draftId === draft.draftId`, replace entry 0 in place; otherwise prepend `draft` (removing any existing entry with the same `draftId`); always returns a new array trimmed to `cap`. Tolerates a non-array `list`.
  - `findById(list, draftId) => draft | undefined`.
  - Never mutates the input list.

- [ ] **Step 1: Write the failing test** in `test/history.test.js`

```js
const test = require("node:test");
const assert = require("node:assert");
const { upsertCurrent, findById } = require("../src/history.js");

const d = (id, picks = 1) => ({ draftId: id, capturedAt: id, player: null, picks: Array(picks).fill({ name: "X", uniqueID: id }) });

test("upsertCurrent prepends a new draft (different draftId) and trims to cap", () => {
  let list = [];
  list = upsertCurrent(list, d(1));
  list = upsertCurrent(list, d(2));
  list = upsertCurrent(list, d(3));
  list = upsertCurrent(list, d(4)); // 4 distinct drafts, cap 3
  assert.deepStrictEqual(list.map((x) => x.draftId), [4, 3, 2]); // newest first, oldest (1) dropped
});

test("upsertCurrent updates the current draft in place when draftId matches front", () => {
  let list = upsertCurrent([], d(1, 1));
  list = upsertCurrent(list, d(1, 5)); // same draftId, more picks
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].picks.length, 5);
});

test("upsertCurrent keeps older entries when updating the current one", () => {
  let list = upsertCurrent(upsertCurrent([], d(1)), d(2, 1)); // [2,1]
  list = upsertCurrent(list, d(2, 3)); // update front (2)
  assert.deepStrictEqual(list.map((x) => x.draftId), [2, 1]);
  assert.strictEqual(list[0].picks.length, 3);
});

test("upsertCurrent dedupes a same-draftId entry that is not at the front", () => {
  const list = [d(2), d(1), d(3)]; // 1 appears in the middle
  const out = upsertCurrent(list, d(1, 9)); // re-surface draft 1
  assert.deepStrictEqual(out.map((x) => x.draftId), [1, 2, 3]);
  assert.strictEqual(out[0].picks.length, 9);
});

test("upsertCurrent tolerates a non-array list and does not mutate input", () => {
  assert.deepStrictEqual(upsertCurrent(undefined, d(1)).map((x) => x.draftId), [1]);
  const input = [d(2)];
  upsertCurrent(input, d(3));
  assert.deepStrictEqual(input.map((x) => x.draftId), [2]); // input unchanged
});

test("findById returns the matching draft or undefined", () => {
  const list = [d(2), d(1)];
  assert.strictEqual(findById(list, 1).draftId, 1);
  assert.strictEqual(findById(list, 9), undefined);
  assert.strictEqual(findById(undefined, 1), undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/history.js'`.

- [ ] **Step 3: Implement `src/history.js`**

```js
// Pure rolling-list helpers for captured drafts (newest first, capped). Keyed by
// draftId so update-vs-prepend is decided by content, not by call timing.
function upsertCurrent(list, draft, cap) {
  const max = typeof cap === "number" ? cap : 3;
  const safe = Array.isArray(list) ? list : [];
  let next;
  if (safe.length && safe[0] && safe[0].draftId === draft.draftId) {
    next = [draft, ...safe.slice(1)]; // update the current draft in place
  } else {
    next = [draft, ...safe.filter((x) => !x || x.draftId !== draft.draftId)]; // new draft: prepend, dedupe
  }
  return next.slice(0, max);
}

function findById(list, draftId) {
  return (Array.isArray(list) ? list : []).find((x) => x && x.draftId === draftId);
}

const DraftHistory = { upsertCurrent, findById };
if (typeof module !== "undefined" && module.exports) module.exports = DraftHistory;
if (typeof globalThis !== "undefined") globalThis.DraftHistory = DraftHistory;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `history` tests green; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/history.js test/history.test.js
git commit -m "feat: draft-history rolling-list module with tests"
```

---

### Task 2: Maintain `dmwDrafts` in the content script + manifest

**Files:**
- Modify: `src/content.js` (stamp `draftId`; persist into `dmwDrafts` via `DraftHistory`; migrate legacy `dmwLastDraft`)
- Modify: `manifest.json` (load `src/history.js` before `src/content.js`)

**Interfaces:**
- Consumes: `DraftHistory.upsertCurrent` (Task 1, content-script global); `chrome.storage.local`.
- Produces: `chrome.storage.local.dmwDrafts` (≤3, newest first) maintained per pick; the front entry is the current draft.

Content-script glue; verified by `node --check` + manifest check + end-to-end.

- [ ] **Step 1: Add `history.js` to the content-script list in `manifest.json`**

The isolated-world entry's `js` is currently:

```json
      "js": ["src/wheel-core.js", "src/capture.js", "src/content.js"],
```

Change it to (history before content so `DraftHistory` exists):

```json
      "js": ["src/wheel-core.js", "src/capture.js", "src/history.js", "src/content.js"],
```

- [ ] **Step 2: Stamp `draftId` on a clean start in `src/content.js`**

Add a `currentDraftId` next to the existing `sawCleanStart` declaration. Currently:

```js
  const capture = createDraftCapture();
  let sawCleanStart = false;
```

Change to:

```js
  const capture = createDraftCapture();
  let sawCleanStart = false;
  let currentDraftId = null;
```

In the `draftState` branch, set the id when a fresh draft begins. Currently:

```js
        const ds = msg.args[0];
        if (ds && ds.boosterNumber === 0 && ds.pickNumber === 0) sawCleanStart = true;
        capture.onDraftState(ds);
```

Change to:

```js
        const ds = msg.args[0];
        if (ds && ds.boosterNumber === 0 && ds.pickNumber === 0) {
          sawCleanStart = true;
          currentDraftId = Date.now(); // stable id for this draft (start time)
        }
        capture.onDraftState(ds);
```

- [ ] **Step 3: Rewrite `persistDraft()` in `src/content.js` to maintain `dmwDrafts`**

Replace the whole `persistDraft` function. Currently:

```js
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

with:

```js
  function persistDraft() {
    try {
      const area = (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) || null;
      if (!area) return;
      const entry = Object.assign({ draftId: currentDraftId, capturedAt: Date.now() }, capture.getDraft());
      area.get(["dmwDrafts", "dmwLastDraft"], (data) => {
        let list = Array.isArray(data.dmwDrafts) ? data.dmwDrafts : [];
        // one-time migration: seed the list from a legacy single-slot capture
        if (list.length === 0 && data.dmwLastDraft && data.dmwLastDraft.picks && data.dmwLastDraft.picks.length) {
          const legacy = data.dmwLastDraft;
          list = [Object.assign({ draftId: legacy.capturedAt || 0 }, legacy)];
        }
        area.set({ dmwDrafts: DraftHistory.upsertCurrent(list, entry, 3) });
      });
    } catch (_e) {
      /* never break the sidebar */
    }
  }
```

(`upsertCurrent` decides update-vs-prepend from `draftId`, so no extra flag is needed: the current draft updates entry 0; a new clean start — with a new `currentDraftId` — prepends.)

- [ ] **Step 4: Verify**

Run: `node --check src/content.js`
Expected: exit 0.

Run: `node -e "const m=require('./manifest.json'); const js=m.content_scripts[1].js; if(JSON.stringify(js)!==JSON.stringify(['src/wheel-core.js','src/capture.js','src/history.js','src/content.js'])) throw new Error('content js order wrong'); console.log('manifest ok')"`
Expected: prints `manifest ok`.

Run: `npm test`
Expected: PASS — existing unit tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/content.js manifest.json
git commit -m "feat: maintain rolling dmwDrafts history in the content script"
```

---

### Task 3: Viewer — history list, open by id, follow current only

**Files:**
- Modify: `viewer.html` (history list container + load `history.js`)
- Modify: `src/viewer/viewer.css` (history-row styling)
- Modify: `src/viewer/viewer.js` (replace the single-button logic with the history list)

**Interfaces:**
- Consumes: `DraftHistory.findById` (Task 1); `dmwDrafts` (Task 2); `buildReplay`, `loadCardData`, `renderStep`, `storageLocal`.
- Produces: a landing-screen history list; `openDraft(draftId)`; `following` true only when the opened draft is `dmwDrafts[0]`. No exported API.

Browser glue verified by `node --check` + manual/e2e.

- [ ] **Step 1: Replace the button with a history list in `viewer.html`**

Replace:

```html
      <button id="dmw-load-last" disabled>Load my last draft</button>
```

with:

```html
      <div id="dmw-history-section">
        <div class="dmw-history-label">Your recent drafts</div>
        <div id="dmw-history"></div>
      </div>
```

- [ ] **Step 2: Load `history.js` in `viewer.html`**

In the script list, add `src/history.js` before `viewer.js` (after `prefs.js`). The current tail is:

```html
    <script src="src/viewer/prefs.js"></script>
    <script src="src/viewer/viewer.js"></script>
```

Change to:

```html
    <script src="src/viewer/prefs.js"></script>
    <script src="src/history.js"></script>
    <script src="src/viewer/viewer.js"></script>
```

- [ ] **Step 3: Add history-row styles to `src/viewer/viewer.css`**

Append:

```css
.dmw-history-label {
  font-size: 13px;
  opacity: 0.8;
  margin: 8px 0 4px;
}
#dmw-history {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 480px;
}
.dmw-history-row {
  text-align: left;
}
```

- [ ] **Step 4: Add `viewedDraftId` state in `src/viewer/viewer.js`**

After the existing `let following = false;` declaration, add:

```js
  let viewedDraftId = null; // draftId of the history entry currently open
```

- [ ] **Step 5: Exit history-follow when an external log is pasted (`src/viewer/viewer.js`)**

In `load(text)`, the line `following = false; // loading an external log exits follow mode` is present. Immediately after it, add:

```js
    viewedDraftId = null;
```

- [ ] **Step 6: Replace `loadLastDraft`/`onLastDraftChanged`/`refreshLastDraftButton` in `src/viewer/viewer.js`**

Delete those three functions (the block from `function loadLastDraft() {` through the end of `function refreshLastDraftButton() { … }`) and replace with:

```js
  function openDraft(draftId) {
    $("dmw-error").textContent = "";
    const area = storageLocal();
    if (!area) {
      $("dmw-error").textContent = "Storage unavailable.";
      return;
    }
    area.get("dmwDrafts", async (data) => {
      const list = Array.isArray(data.dmwDrafts) ? data.dmwDrafts : [];
      const draft = DraftHistory.findById(list, draftId);
      if (!draft || !draft.picks || draft.picks.length === 0) {
        $("dmw-error").textContent = "That draft is no longer available.";
        refreshHistory();
        return;
      }
      viewedDraftId = draftId;
      following = !!(list[0] && list[0].draftId === draftId); // only the current (newest) draft live-follows
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

  function onDraftsChanged(changes, area) {
    if (area !== "local" || !changes.dmwDrafts) return;
    refreshHistory(); // keep the landing list current as drafts are captured
    if (!following || !replay || viewedDraftId == null) return;
    const list = changes.dmwDrafts.newValue;
    if (!Array.isArray(list) || list.length === 0) return;
    if (!list[0] || list[0].draftId !== viewedDraftId) {
      following = false; // a newer draft started — the one we're viewing is now archived
      return;
    }
    const draft = list[0];
    if (!draft.picks || draft.picks.length === 0) return;
    const wasAtEnd = stepIndex === replay.steps.length - 1;
    replay = buildReplay(draft);
    stepIndex = wasAtEnd ? replay.steps.length - 1 : Math.min(stepIndex, replay.steps.length - 1);
    renderStep();
    loadCardData().then(renderStep);
  }

  function refreshHistory() {
    const container = $("dmw-history");
    const area = storageLocal();
    if (!area) {
      container.textContent = "Storage unavailable.";
      return;
    }
    area.get("dmwDrafts", (data) => {
      const list = Array.isArray(data.dmwDrafts) ? data.dmwDrafts : [];
      container.innerHTML = "";
      if (list.length === 0) {
        const empty = document.createElement("div");
        empty.className = "dmw-empty";
        empty.textContent = "No captured drafts yet — draft on draftmancer.com first.";
        container.appendChild(empty);
        return;
      }
      list.forEach((draft, i) => {
        const row = document.createElement("button");
        row.className = "dmw-history-row";
        const when = new Date(draft.capturedAt || 0).toLocaleString();
        const n = (draft.picks && draft.picks.length) || 0;
        row.textContent = `${i === 0 ? "● current — " : ""}${when} · ${n} picks`;
        row.addEventListener("click", () => openDraft(draft.draftId));
        container.appendChild(row);
      });
    });
  }
```

(`.dmw-empty` is an existing class used elsewhere; row text is set via `textContent`, so no card/data string reaches `innerHTML`.)

- [ ] **Step 7: Update `init()` wiring in `src/viewer/viewer.js`**

The current wiring is:

```js
    $("dmw-load-last").addEventListener("click", loadLastDraft);
    refreshLastDraftButton();
    const area = (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) || null;
    if (area) chrome.storage.onChanged.addListener(onLastDraftChanged);
```

Replace it with:

```js
    refreshHistory();
    const area = (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) || null;
    if (area) chrome.storage.onChanged.addListener(onDraftsChanged);
```

- [ ] **Step 8: Verify**

Run: `node --check src/viewer/viewer.js`
Expected: exit 0.

Run: `npm test`
Expected: PASS — unit tests unaffected.

- [ ] **Step 9: End-to-end verification (controller-run)** (record results)

1. Reload the unpacked extension. Open the viewer: with no captures, the history list shows "No captured drafts yet…".
2. On draftmancer.com, start a bot draft and make 2 picks; the viewer's list shows one row "● current — … · 2 picks" (live, via storage change).
3. Open that current row → it loads at the latest pick and live-follows: make another pick on draftmancer.com, the viewer advances (tail-follow).
4. Back on draftmancer.com, start a *second* bot draft and make a pick. The viewer's list now shows two rows (new current on top); the previously-followed draft is archived (following stopped). Open the older row → it shows statically (making more picks in the new draft does not change it).
5. Confirm pasting an external MTGO log still works and isn't added to history; the live "didn't wheel" sidebar still works.

- [ ] **Step 10: Commit**

```bash
git add viewer.html src/viewer/viewer.css src/viewer/viewer.js
git commit -m "feat: viewer draft-history list (open any of the last 3; follow the current)"
```

---

## Notes for the implementer

- Task 1 holds the testable list logic; Tasks 2–3 are browser glue covered by the Task-3 end-to-end checklist.
- `history.js` loads before `content.js` (manifest) and before `viewer.js` (viewer.html) so `DraftHistory` is defined in both worlds.
- The capture's `sawCleanStart` gate is unchanged — partial (reload) captures still do not persist.
- Keep the `dmw-` prefix on every DOM id/class; do not change `capture.js`, `replay.js`, `scryfall.js`, `wheel-core.js`, the parser, `deck-layout.js`, or `prefs.js`.
