# Viewer Settings Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the replay viewer's three controls (Hide my pick, deck sort, Split creatures) across sessions via `chrome.storage.local`.

**Architecture:** A new `src/viewer/prefs.js` holds the defaults, a pure unit-tested `mergePrefs` validator, and thin async `loadPrefs`/`savePref` wrappers over `chrome.storage.local`. `viewer.js` seeds its state from `Prefs.DEFAULTS`, loads stored prefs in `init()` (reflecting them in the controls), and saves on each control change. The manifest gains the `storage` permission.

**Tech Stack:** Vanilla JS, no build step, Node's `node --test`, `chrome.storage.local`. No new dependencies.

## Global Constraints

- No third-party runtime/test dependencies. Tests use `node:test`/`node:assert`.
- Pure modules use the UMD guard: `if (typeof module !== "undefined" && module.exports) module.exports = X; if (typeof globalThis !== "undefined") globalThis.X = X;`.
- All viewer DOM ids/classes are `dmw-` prefixed.
- Storage: `chrome.storage.local`, single key `dmwPrefs = { hidePick, deckSort, splitCreatures }`.
- First-run defaults: `hidePick: true`, `deckSort: "cmc"`, `splitCreatures: false`. Stored values override; invalid/unknown stored values are ignored in favor of the default.
- Validation: `hidePick`/`splitCreatures` must be boolean; `deckSort` must be `"cmc"` or `"color"`.
- No options page, no new settings, no `storage.sync`. No change to the live content-script feature.

---

### Task 1: Prefs module + storage permission

**Files:**
- Create: `src/viewer/prefs.js`
- Test: `test/prefs.test.js`
- Modify: `manifest.json` (add `permissions`)

**Interfaces:**
- Consumes: `chrome.storage.local` at runtime (browser only).
- Produces: `globalThis.Prefs` / Node `module.exports = Prefs` where
  `Prefs = { DEFAULTS, mergePrefs, loadPrefs, savePref }`:
  - `DEFAULTS = { hidePick: true, deckSort: "cmc", splitCreatures: false }`
  - `mergePrefs(stored, defaults?) => { hidePick, deckSort, splitCreatures }` — pure; returns a NEW object equal to `defaults` (or `DEFAULTS`) with only valid values from `stored` applied.
  - `loadPrefs(callback)` — reads `dmwPrefs` from `chrome.storage.local`, calls `callback(mergePrefs(stored))`; if `chrome.storage` is unavailable, calls back with the defaults.
  - `savePref(key, value)` — merges `{ [key]: value }` into the stored `dmwPrefs`; no-op if `chrome.storage` is unavailable.

- [ ] **Step 1: Write the failing test** in `test/prefs.test.js`

```js
const test = require("node:test");
const assert = require("node:assert");
const { DEFAULTS, mergePrefs } = require("../src/viewer/prefs.js");

test("DEFAULTS has the expected first-run values", () => {
  assert.deepStrictEqual(DEFAULTS, { hidePick: true, deckSort: "cmc", splitCreatures: false });
});

test("mergePrefs returns defaults for null/empty/non-object stored", () => {
  assert.deepStrictEqual(mergePrefs(null), DEFAULTS);
  assert.deepStrictEqual(mergePrefs(undefined), DEFAULTS);
  assert.deepStrictEqual(mergePrefs({}), DEFAULTS);
  assert.deepStrictEqual(mergePrefs("nope"), DEFAULTS);
});

test("mergePrefs returns a new object, not the DEFAULTS reference", () => {
  const r = mergePrefs(null);
  assert.notStrictEqual(r, DEFAULTS);
  r.hidePick = false;
  assert.strictEqual(DEFAULTS.hidePick, true); // DEFAULTS not mutated
});

test("mergePrefs applies a partial valid override, keeping the rest default", () => {
  assert.deepStrictEqual(mergePrefs({ hidePick: false }), { hidePick: false, deckSort: "cmc", splitCreatures: false });
  assert.deepStrictEqual(mergePrefs({ deckSort: "color" }), { hidePick: true, deckSort: "color", splitCreatures: false });
  assert.deepStrictEqual(mergePrefs({ splitCreatures: true }), { hidePick: true, deckSort: "cmc", splitCreatures: true });
});

test("mergePrefs rejects invalid types/values in favor of defaults", () => {
  assert.deepStrictEqual(
    mergePrefs({ hidePick: "yes", deckSort: "rarity", splitCreatures: 1 }),
    DEFAULTS
  );
});

test("mergePrefs ignores unknown keys", () => {
  const r = mergePrefs({ foo: 123, deckSort: "color" });
  assert.deepStrictEqual(r, { hidePick: true, deckSort: "color", splitCreatures: false });
  assert.strictEqual("foo" in r, false);
});

test("mergePrefs applies a fully valid stored object", () => {
  assert.deepStrictEqual(
    mergePrefs({ hidePick: false, deckSort: "color", splitCreatures: true }),
    { hidePick: false, deckSort: "color", splitCreatures: true }
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/viewer/prefs.js'`.

- [ ] **Step 3: Implement `src/viewer/prefs.js`**

```js
// Persisted viewer preferences (chrome.storage.local). mergePrefs is pure and
// validated; loadPrefs/savePref are thin browser-only wrappers that degrade to
// defaults / no-op when chrome.storage is unavailable.
const DEFAULTS = { hidePick: true, deckSort: "cmc", splitCreatures: false };

function mergePrefs(stored, defaults) {
  const base = defaults || DEFAULTS;
  const out = { hidePick: base.hidePick, deckSort: base.deckSort, splitCreatures: base.splitCreatures };
  if (stored && typeof stored === "object") {
    if (typeof stored.hidePick === "boolean") out.hidePick = stored.hidePick;
    if (stored.deckSort === "cmc" || stored.deckSort === "color") out.deckSort = stored.deckSort;
    if (typeof stored.splitCreatures === "boolean") out.splitCreatures = stored.splitCreatures;
  }
  return out;
}

function storageArea() {
  return (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) || null;
}

function loadPrefs(callback) {
  const area = storageArea();
  if (!area) {
    callback(mergePrefs(null));
    return;
  }
  area.get("dmwPrefs", (data) => callback(mergePrefs(data && data.dmwPrefs)));
}

function savePref(key, value) {
  const area = storageArea();
  if (!area) return;
  area.get("dmwPrefs", (data) => {
    const merged = mergePrefs(data && data.dmwPrefs);
    merged[key] = value;
    area.set({ dmwPrefs: merged });
  });
}

const Prefs = { DEFAULTS, mergePrefs, loadPrefs, savePref };
if (typeof module !== "undefined" && module.exports) module.exports = Prefs;
if (typeof globalThis !== "undefined") globalThis.Prefs = Prefs;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `prefs` tests green; existing tests still pass.

- [ ] **Step 5: Add the `storage` permission to `manifest.json`**

The manifest currently has no top-level `permissions` key. Add one after the `description`/`minimum_chrome_version`/`icons` block and before `action` (exact placement isn't critical as long as the JSON stays valid). Insert:

```json
  "permissions": ["storage"],
```

Verify validity and that the existing keys are intact:

Run: `node -e "const m=require('./manifest.json'); if(!Array.isArray(m.permissions)||!m.permissions.includes('storage')) throw new Error('storage permission missing'); if(m.content_scripts.length!==2||!m.action||!m.background) throw new Error('existing keys changed'); console.log('manifest ok')"`
Expected: prints `manifest ok`.

- [ ] **Step 6: Commit**

```bash
git add src/viewer/prefs.js test/prefs.test.js manifest.json
git commit -m "feat: prefs module (validated defaults + chrome.storage wrappers) + storage permission"
```

---

### Task 2: Wire persistence into the viewer

**Files:**
- Modify: `viewer.html` (load `prefs.js` before `viewer.js`)
- Modify: `src/viewer/viewer.js` (seed state from `Prefs.DEFAULTS`; load in `init()`; save in handlers)

**Interfaces:**
- Consumes: `Prefs.DEFAULTS`, `Prefs.loadPrefs`, `Prefs.savePref` (Task 1); the existing control handlers and DOM ids (`#dmw-hidepick`, `#dmw-sort-cmc`, `#dmw-sort-color`, `#dmw-split`).
- Produces: persistence behavior. No exported API.

Browser glue verified by `node --check` + manual/e2e (no unit test).

- [ ] **Step 1: Load `prefs.js` in `viewer.html`**

In the script list near the bottom, add `prefs.js` before `viewer.js`. The current list is:

```html
    <script src="src/wheel-core.js"></script>
    <script src="src/viewer/log-parser.js"></script>
    <script src="src/viewer/scryfall.js"></script>
    <script src="src/viewer/replay.js"></script>
    <script src="src/viewer/deck-layout.js"></script>
    <script src="src/viewer/viewer.js"></script>
```

Change it to:

```html
    <script src="src/wheel-core.js"></script>
    <script src="src/viewer/log-parser.js"></script>
    <script src="src/viewer/scryfall.js"></script>
    <script src="src/viewer/replay.js"></script>
    <script src="src/viewer/deck-layout.js"></script>
    <script src="src/viewer/prefs.js"></script>
    <script src="src/viewer/viewer.js"></script>
```

- [ ] **Step 2: Seed state from `Prefs.DEFAULTS` in `src/viewer/viewer.js`**

The current state declarations (lines 7, 9, 10) are:

```js
  let hidePick = true; // "Hide my pick" toggle (default on — start with the pick hidden)
  let revealed = false; // whether the current step's pick has been revealed
  let deckSort = "cmc"; // "cmc" | "color"
  let splitCreatures = false;
```

Replace them with (single source of truth for defaults is `Prefs.DEFAULTS`):

```js
  let hidePick = Prefs.DEFAULTS.hidePick; // "Hide my pick" (persisted)
  let revealed = false; // whether the current step's pick has been revealed
  let deckSort = Prefs.DEFAULTS.deckSort; // "cmc" | "color" (persisted)
  let splitCreatures = Prefs.DEFAULTS.splitCreatures; // (persisted)
```

- [ ] **Step 3: Load stored prefs at the start of `init()` in `src/viewer/viewer.js`**

`init()` currently begins with the `#dmw-load` click listener. Insert this block as the FIRST statement inside `init()` (before the `#dmw-load` listener):

```js
    Prefs.loadPrefs((prefs) => {
      hidePick = prefs.hidePick;
      deckSort = prefs.deckSort;
      splitCreatures = prefs.splitCreatures;
      $("dmw-hidepick").checked = hidePick;
      $("dmw-split").checked = splitCreatures;
      $("dmw-sort-cmc").classList.toggle("dmw-active", deckSort === "cmc");
      $("dmw-sort-color").classList.toggle("dmw-active", deckSort === "color");
      if (replay) renderStep();
    });
```

- [ ] **Step 4: Save on change in the three handlers in `src/viewer/viewer.js`**

In the hide-pick handler, add a save. Current:

```js
    $("dmw-hidepick").addEventListener("change", (e) => {
      hidePick = e.target.checked;
      revealed = false; // re-hide on toggle
      if (replay) renderStep();
    });
```

Becomes:

```js
    $("dmw-hidepick").addEventListener("change", (e) => {
      hidePick = e.target.checked;
      revealed = false; // re-hide on toggle
      Prefs.savePref("hidePick", hidePick);
      if (replay) renderStep();
    });
```

In `setSort`, add a save. Current:

```js
    function setSort(mode) {
      deckSort = mode;
      $("dmw-sort-cmc").classList.toggle("dmw-active", mode === "cmc");
      $("dmw-sort-color").classList.toggle("dmw-active", mode === "color");
      if (replay) renderStep();
    }
```

Becomes:

```js
    function setSort(mode) {
      deckSort = mode;
      $("dmw-sort-cmc").classList.toggle("dmw-active", mode === "cmc");
      $("dmw-sort-color").classList.toggle("dmw-active", mode === "color");
      Prefs.savePref("deckSort", mode);
      if (replay) renderStep();
    }
```

In the split handler, add a save. Current:

```js
    $("dmw-split").addEventListener("change", (e) => {
      splitCreatures = e.target.checked;
      if (replay) renderStep();
    });
```

Becomes:

```js
    $("dmw-split").addEventListener("change", (e) => {
      splitCreatures = e.target.checked;
      Prefs.savePref("splitCreatures", splitCreatures);
      if (replay) renderStep();
    });
```

- [ ] **Step 5: Syntax-check + unit tests**

Run: `node --check src/viewer/viewer.js`
Expected: exit 0.

Run: `npm test`
Expected: PASS — all unit tests (incl. Task 1's prefs tests) green.

- [ ] **Step 6: Manual / e2e verification** (record results)

1. Reload the unpacked extension at `chrome://extensions` (it will request the new "storage" permission — accept it). Open the viewer and load a log.
2. Uncheck **Hide my pick**, click **Color**, check **Split creatures**.
3. Close the viewer tab and reopen it (toolbar icon), load a log again.
4. Confirm the controls come back as you left them: Hide-pick unchecked, sort **Color** active, Split **checked** — and the rendered deck reflects them.
5. Reset them (Hide-pick on, CMC, split off), reopen → confirm those persist too.

- [ ] **Step 7: Commit**

```bash
git add viewer.html src/viewer/viewer.js
git commit -m "feat: persist viewer controls (hide-pick, sort, split) via prefs"
```

---

## Notes for the implementer

- Task 1 holds the only testable logic (`mergePrefs`); `loadPrefs`/`savePref` and the viewer wiring are browser glue covered by the manual/e2e checklist.
- `prefs.js` must load before `viewer.js` so `Prefs.DEFAULTS` exists when `viewer.js`'s IIFE seeds its state.
- Keep the `dmw-` prefix on any DOM access; do not touch `deck-layout.js`, `replay.js`, the parser, Scryfall, `wheel-core.js`, or the live content-script feature.
