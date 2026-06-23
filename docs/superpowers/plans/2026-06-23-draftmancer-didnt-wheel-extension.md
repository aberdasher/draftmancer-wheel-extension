# Draftmancer "Didn't Wheel" Chrome Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Manifest V3 Chrome extension that, during a live booster draft on draftmancer.com, shows in a sidebar which cards from a pack did not wheel back to you (cards other drafters took).

**Architecture:** A page-context injector wraps `WebSocket` to observe socket.io frames and forwards `draftState`/`rejoinDraft`/`pickCard` payloads via `window.postMessage`. An isolated content script runs the wheel-matching logic (set-difference on stable `uniqueID`s) and renders a sidebar. Pure logic (socket.io frame parsing, wheel matching) lives in dependency-free UMD modules that are unit-tested under Node's built-in test runner; the WebSocket glue and DOM rendering are verified manually in the browser.

**Tech Stack:** Vanilla JavaScript (no build step), Manifest V3, Node.js built-in test runner (`node --test`) — no third-party dependencies.

## Global Constraints

- **Target site only:** content script matches `https://draftmancer.com/*` and `https://www.draftmancer.com/*`. No other hosts.
- **Read-only:** never emit to the server or mutate draft state; only observe and render.
- **No third-party runtime/test dependencies.** Tests use `node:test` and `node:assert`.
- **Shared modules use a UMD guard** so the same file works as a Node module (`module.exports`) and as a browser global: at the end of each shared module, `if (typeof module !== "undefined" && module.exports) module.exports = X; if (typeof globalThis !== "undefined") globalThis.X = X;`.
- **Card identity** is the numeric `uniqueID` field. **Card image URL** is `card.image_uris.en` (fall back to the first value in `card.image_uris` if `en` is absent). **Card name** is `card.name`.
- **Socket.io EVENT frames** are text frames beginning with `42`, optionally followed by `/namespace,` then optional numeric ack id, then a JSON array `[eventName, ...args]`. All other frames (ping `2`/pong `3`, open `0`, binary, unparseable) are ignored.
- **"Didn't wheel" is relative to the most recent prior pass** of the same pack (the prior snapshot with the largest `uniqueID` overlap), which equals the first pass in a standard 8-player pod.
- All DOM elements and CSS classes created by the extension are prefixed `dmw-` to avoid clashing with the app.

---

### Task 1: Project scaffold + socket.io frame parser

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `manifest.json`
- Create: `src/socketio-frame.js`
- Test: `test/socketio-frame.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseSocketIOFrame(data: string) => { event: string, args: any[] } | null`. Returns `null` for any non-EVENT or unparseable frame. Exposed as Node export and as `globalThis.parseSocketIOFrame`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "draftmancer-wheel-extension",
  "version": "0.1.0",
  "description": "Chrome extension showing which cards did not wheel in a Draftmancer draft.",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
*.log
.DS_Store
```

- [ ] **Step 3: Create a minimal valid `manifest.json`** (filled out further in Task 5)

```json
{
  "manifest_version": 3,
  "name": "Draftmancer Didn't Wheel",
  "version": "0.1.0",
  "description": "Shows which cards from a pack did not wheel back to you during a Draftmancer draft.",
  "content_scripts": [
    {
      "matches": ["https://draftmancer.com/*", "https://www.draftmancer.com/*"],
      "js": ["src/content.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["src/socketio-frame.js", "src/inject.js"],
      "matches": ["https://draftmancer.com/*", "https://www.draftmancer.com/*"]
    }
  ]
}
```

- [ ] **Step 4: Write the failing test** in `test/socketio-frame.test.js`

```js
const test = require("node:test");
const assert = require("node:assert");
const { parseSocketIOFrame } = require("../src/socketio-frame.js");

test("parses a plain default-namespace EVENT frame", () => {
  const r = parseSocketIOFrame('42["draftState",{"boosterNumber":0,"pickNumber":0}]');
  assert.deepStrictEqual(r, { event: "draftState", args: [{ boosterNumber: 0, pickNumber: 0 }] });
});

test("parses an EVENT frame carrying an ack id", () => {
  const r = parseSocketIOFrame('420["pickCard",{"pickedCards":[2]}]');
  assert.deepStrictEqual(r, { event: "pickCard", args: [{ pickedCards: [2] }] });
});

test("parses an EVENT frame with an explicit namespace and ack id", () => {
  const r = parseSocketIOFrame('42/draft,7["draftState",{"pickNumber":3}]');
  assert.deepStrictEqual(r, { event: "draftState", args: [{ pickNumber: 3 }] });
});

test("parses an EVENT frame with multiple args", () => {
  const r = parseSocketIOFrame('42["foo",1,"two",{"k":3}]');
  assert.deepStrictEqual(r, { event: "foo", args: [1, "two", { k: 3 }] });
});

test("returns null for engine.io ping/pong frames", () => {
  assert.strictEqual(parseSocketIOFrame("2"), null);
  assert.strictEqual(parseSocketIOFrame("3"), null);
});

test("returns null for non-event socket.io message frames (CONNECT=40)", () => {
  assert.strictEqual(parseSocketIOFrame("40"), null);
});

test("returns null for binary-event frames (45...) ", () => {
  assert.strictEqual(parseSocketIOFrame('451-["x",{}]'), null);
});

test("returns null for non-string and unparseable input", () => {
  assert.strictEqual(parseSocketIOFrame(123), null);
  assert.strictEqual(parseSocketIOFrame("42not-json"), null);
  assert.strictEqual(parseSocketIOFrame(""), null);
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/socketio-frame.js'`.

- [ ] **Step 6: Implement `src/socketio-frame.js`**

```js
// Parses a socket.io v4 text frame into { event, args } for EVENT packets only.
// Frame shape: "4" (engine.io MESSAGE) + "2" (socket.io EVENT) + optional
// "/namespace," + optional numeric ack id + JSON array [event, ...args].
function parseSocketIOFrame(data) {
  if (typeof data !== "string" || data.length < 2) return null;
  // Engine.io MESSAGE is "4"; socket.io EVENT is "2" => prefix "42".
  if (data[0] !== "4" || data[1] !== "2") return null;
  let i = 2;
  // Optional namespace: "/...," up to the first comma.
  if (data[i] === "/") {
    const comma = data.indexOf(",", i);
    if (comma === -1) return null;
    i = comma + 1;
  }
  // Optional numeric ack id.
  while (i < data.length && data[i] >= "0" && data[i] <= "9") i++;
  const payload = data.slice(i);
  if (payload.length === 0 || payload[0] !== "[") return null;
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (_e) {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0] !== "string") return null;
  return { event: parsed[0], args: parsed.slice(1) };
}

if (typeof module !== "undefined" && module.exports) module.exports = { parseSocketIOFrame };
if (typeof globalThis !== "undefined") globalThis.parseSocketIOFrame = parseSocketIOFrame;
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `socketio-frame` tests green.

- [ ] **Step 8: Commit**

```bash
git add package.json .gitignore manifest.json src/socketio-frame.js test/socketio-frame.test.js
git commit -m "feat: scaffold extension + socket.io frame parser with tests"
```

---

### Task 2: Wheel-matching core

**Files:**
- Create: `src/wheel-core.js`
- Test: `test/wheel-core.test.js`

**Interfaces:**
- Consumes: nothing (pure logic; operates on plain payload objects).
- Produces: `createWheelTracker() => tracker` exposed as Node export and `globalThis.createWheelTracker`. The tracker has:
  - `tracker.handleDraftState(payload) => WheelResult` where `payload = { booster?: Card[], boosterCount?: number, boosterNumber: number, pickNumber: number }`.
  - `tracker.handlePickCard(payload) => void` where `payload = { pickedCards?: number[], burnedCards?: number[] }` (indices into the last-seen booster).
  - `tracker.handleRejoin(statePayload) => WheelResult` where `statePayload` has the same shape as a `draftState` payload (from `rejoinDraft`'s `state`).
  - `tracker.reset() => void`.
  - `WheelResult` is one of:
    - `{ active: false }` — no current booster (waiting / not picking).
    - `{ active: true, isWheel: false, boosterNumber, pickNumber }` — first pass, nothing to compare.
    - `{ active: true, isWheel: true, boosterNumber, pickNumber, didntWheel: Card[] }` — `didntWheel` are full card objects from the earlier snapshot, in that snapshot's order.

- [ ] **Step 1: Write the failing test** in `test/wheel-core.test.js`

```js
const test = require("node:test");
const assert = require("node:assert");
const { createWheelTracker } = require("../src/wheel-core.js");

const card = (uniqueID, name) => ({ uniqueID, name, image_uris: { en: name + ".jpg" } });

test("first booster of a round is not a wheel", () => {
  const t = createWheelTracker();
  const r = t.handleDraftState({
    boosterNumber: 0,
    pickNumber: 0,
    booster: [card(1, "A"), card(2, "B"), card(3, "C")],
  });
  assert.deepStrictEqual(r, { active: true, isWheel: false, boosterNumber: 0, pickNumber: 0 });
});

test("empty/absent booster yields inactive result", () => {
  const t = createWheelTracker();
  assert.deepStrictEqual(t.handleDraftState({ boosterNumber: 0, pickNumber: 0, booster: [] }), { active: false });
  assert.deepStrictEqual(t.handleDraftState({ boosterNumber: 0, pickNumber: 1 }), { active: false });
});

test("wheel reports cards others took, excluding your own pick", () => {
  const t = createWheelTracker();
  // First pass: see A,B,C,D at pick 0.
  t.handleDraftState({ boosterNumber: 0, pickNumber: 0, booster: [card(1, "A"), card(2, "B"), card(3, "C"), card(4, "D")] });
  // You pick index 0 (card A) and pass.
  t.handlePickCard({ pickedCards: [0] });
  // Pack wheels back at pick 4 with only B and D left (C was taken by someone else; A is yours).
  const r = t.handleDraftState({ boosterNumber: 0, pickNumber: 4, booster: [card(2, "B"), card(4, "D")] });
  assert.strictEqual(r.active, true);
  assert.strictEqual(r.isWheel, true);
  assert.strictEqual(r.boosterNumber, 0);
  assert.deepStrictEqual(r.didntWheel.map((c) => c.uniqueID), [3]); // only C; A excluded as own pick
  assert.strictEqual(r.didntWheel[0].name, "C");
});

test("burned cards are also excluded from didntWheel", () => {
  const t = createWheelTracker();
  t.handleDraftState({ boosterNumber: 0, pickNumber: 0, booster: [card(1, "A"), card(2, "B"), card(3, "C")] });
  t.handlePickCard({ pickedCards: [0], burnedCards: [1] }); // pick A, burn B
  const r = t.handleDraftState({ boosterNumber: 0, pickNumber: 3, booster: [card(3, "C")] });
  assert.deepStrictEqual(r.didntWheel.map((c) => c.uniqueID), []); // C still here, A+B are own pick/burn
  assert.strictEqual(r.isWheel, true);
});

test("a different boosterNumber never matches a prior round", () => {
  const t = createWheelTracker();
  t.handleDraftState({ boosterNumber: 0, pickNumber: 0, booster: [card(1, "A"), card(2, "B")] });
  const r = t.handleDraftState({ boosterNumber: 1, pickNumber: 0, booster: [card(10, "X"), card(11, "Y")] });
  assert.strictEqual(r.isWheel, false);
});

test("matches the most recent prior pass in a small pod (incremental)", () => {
  const t = createWheelTracker();
  // Pick 0: A,B,C,D,E
  t.handleDraftState({ boosterNumber: 0, pickNumber: 0, booster: [card(1,"A"),card(2,"B"),card(3,"C"),card(4,"D"),card(5,"E")] });
  t.handlePickCard({ pickedCards: [0] }); // take A
  // Pick 4 (second pass): B,C,D,E minus one taken -> B,C,E (D taken)
  t.handleDraftState({ boosterNumber: 0, pickNumber: 4, booster: [card(2,"B"),card(3,"C"),card(5,"E")] });
  t.handlePickCard({ pickedCards: [0] }); // take B
  // Pick 8 (third pass): C,E minus one -> C (E taken since last pass)
  const r = t.handleDraftState({ boosterNumber: 0, pickNumber: 8, booster: [card(3,"C")] });
  // Relative to the pick-4 snapshot: E didn't wheel (B excluded as own pick).
  assert.deepStrictEqual(r.didntWheel.map((c) => c.uniqueID), [5]);
});

test("handleRejoin seeds a snapshot without crashing and is treated as first pass", () => {
  const t = createWheelTracker();
  const r = t.handleRejoin({ boosterNumber: 0, pickNumber: 2, booster: [card(1, "A"), card(2, "B")] });
  assert.deepStrictEqual(r, { active: true, isWheel: false, boosterNumber: 0, pickNumber: 2 });
});

test("reset clears state", () => {
  const t = createWheelTracker();
  t.handleDraftState({ boosterNumber: 0, pickNumber: 0, booster: [card(1, "A")] });
  t.reset();
  const r = t.handleDraftState({ boosterNumber: 0, pickNumber: 4, booster: [card(1, "A")] });
  assert.strictEqual(r.isWheel, false); // prior snapshot was cleared
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/wheel-core.js'`.

- [ ] **Step 3: Implement `src/wheel-core.js`**

```js
// Tracks boosters seen during a draft and computes which cards did not wheel
// back, using each card's stable numeric uniqueID.
function createWheelTracker() {
  let snapshots = []; // { boosterNumber, pickNumber, ids:Set<number>, cardsById:Map<number,Card> }
  const pickedIds = new Set(); // uniqueIDs you picked or burned (never "didn't wheel")
  let lastBooster = []; // ordered card list of the most recent booster (for index resolution)

  function reset() {
    snapshots = [];
    pickedIds.clear();
    lastBooster = [];
  }

  function ingest(payload) {
    const booster = Array.isArray(payload && payload.booster) ? payload.booster : null;
    const boosterNumber = payload ? payload.boosterNumber : undefined;
    const pickNumber = payload ? payload.pickNumber : undefined;
    if (!booster || booster.length === 0) return { active: false };

    const ids = new Set();
    const cardsById = new Map();
    for (const c of booster) {
      ids.add(c.uniqueID);
      cardsById.set(c.uniqueID, c);
    }

    // Find the most recent prior pass of this same pack: same boosterNumber,
    // lower pickNumber, largest uniqueID overlap with the current booster.
    let best = null;
    let bestOverlap = 0;
    for (const s of snapshots) {
      if (s.boosterNumber !== boosterNumber) continue;
      if (s.pickNumber >= pickNumber) continue;
      let overlap = 0;
      for (const id of ids) if (s.ids.has(id)) overlap++;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = s;
      }
    }

    let result;
    if (best && bestOverlap > 0) {
      const didntWheel = [];
      for (const c of best.cardsById.values()) {
        if (!ids.has(c.uniqueID) && !pickedIds.has(c.uniqueID)) didntWheel.push(c);
      }
      result = { active: true, isWheel: true, boosterNumber, pickNumber, didntWheel };
    } else {
      result = { active: true, isWheel: false, boosterNumber, pickNumber };
    }

    snapshots.push({ boosterNumber, pickNumber, ids, cardsById });
    lastBooster = booster;
    return result;
  }

  function handleDraftState(payload) {
    return ingest(payload);
  }

  function handleRejoin(statePayload) {
    return ingest(statePayload);
  }

  function handlePickCard(payload) {
    if (!payload) return;
    const indices = []
      .concat(Array.isArray(payload.pickedCards) ? payload.pickedCards : [])
      .concat(Array.isArray(payload.burnedCards) ? payload.burnedCards : []);
    for (const idx of indices) {
      const c = lastBooster[idx];
      if (c && typeof c.uniqueID === "number") pickedIds.add(c.uniqueID);
    }
  }

  return { handleDraftState, handleRejoin, handlePickCard, reset };
}

if (typeof module !== "undefined" && module.exports) module.exports = { createWheelTracker };
if (typeof globalThis !== "undefined") globalThis.createWheelTracker = createWheelTracker;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `wheel-core` and `socketio-frame` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/wheel-core.js test/wheel-core.test.js
git commit -m "feat: wheel-matching core with tests"
```

---

### Task 3: Page-context injector

**Files:**
- Create: `src/inject.js`

**Interfaces:**
- Consumes: `globalThis.parseSocketIOFrame` (from `src/socketio-frame.js`, injected before this file).
- Produces: posts `window.postMessage({ source: "dm-wheel", event, args }, "*")` for the events `draftState`, `rejoinDraft` (incoming) and `pickCard` (outgoing). No Node export (browser-only glue).

This task is verified manually in the browser (Task 5), since it depends on the live `WebSocket` object and socket.io. Keep the file minimal and defensive.

- [ ] **Step 1: Implement `src/inject.js`**

```js
// Runs in the page's JS world. Wraps WebSocket to observe socket.io frames and
// forwards the relevant draft events to the content script via postMessage.
(function () {
  const FORWARD = new Set(["draftState", "rejoinDraft", "pickCard"]);

  function forward(data) {
    try {
      const parsed = globalThis.parseSocketIOFrame(data);
      if (parsed && FORWARD.has(parsed.event)) {
        window.postMessage({ source: "dm-wheel", event: parsed.event, args: parsed.args }, "*");
      }
    } catch (_e) {
      /* never throw into page code */
    }
  }

  const NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket) return;

  function WrappedWebSocket(url, protocols) {
    const ws = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);

    ws.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") forward(ev.data);
    });

    const nativeSend = ws.send;
    ws.send = function (data) {
      if (typeof data === "string") forward(data);
      return nativeSend.call(this, data);
    };

    return ws;
  }

  WrappedWebSocket.prototype = NativeWebSocket.prototype;
  WrappedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
  WrappedWebSocket.OPEN = NativeWebSocket.OPEN;
  WrappedWebSocket.CLOSING = NativeWebSocket.CLOSING;
  WrappedWebSocket.CLOSED = NativeWebSocket.CLOSED;

  window.WebSocket = WrappedWebSocket;
})();
```

- [ ] **Step 2: Sanity-check the file loads without syntax errors**

Run: `node --check src/inject.js`
Expected: no output, exit code 0 (syntax valid). (Runtime behavior is verified in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add src/inject.js
git commit -m "feat: page-context WebSocket injector forwarding draft events"
```

---

### Task 4: Content script + sidebar UI

**Files:**
- Create: `src/content.js`
- Create: `src/sidebar.css`

**Interfaces:**
- Consumes: `window.postMessage` events with `{ source: "dm-wheel", event, args }` (from Task 3); `createWheelTracker` (from Task 2, loaded as a content-script global before `content.js`).
- Produces: a sidebar DOM element rooted at `#dmw-sidebar`. No Node export.

This task's UI is verified manually in the browser (Task 5). Keep rendering in a single `render(result)` function so behavior is easy to reason about.

- [ ] **Step 1: Create `src/sidebar.css`**

```css
#dmw-sidebar {
  position: fixed;
  top: 64px;
  right: 0;
  width: 220px;
  max-height: 80vh;
  overflow-y: auto;
  background: rgba(20, 20, 24, 0.95);
  color: #eee;
  font-family: sans-serif;
  font-size: 13px;
  z-index: 2147483647;
  border-top-left-radius: 8px;
  border-bottom-left-radius: 8px;
  box-shadow: -2px 2px 8px rgba(0, 0, 0, 0.5);
}
#dmw-sidebar.dmw-collapsed .dmw-body { display: none; }
.dmw-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  cursor: pointer;
  font-weight: bold;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.dmw-body { padding: 8px; }
.dmw-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.dmw-card { display: flex; flex-direction: column; align-items: center; text-align: center; }
.dmw-card img { width: 100%; border-radius: 4px; }
.dmw-card span { margin-top: 2px; font-size: 11px; line-height: 1.1; }
.dmw-empty { opacity: 0.7; font-style: italic; }
```

- [ ] **Step 2: Implement `src/content.js`**

```js
// Isolated content-script world. Injects the page-context scripts, listens for
// forwarded draft events, runs the wheel tracker, and renders the sidebar.
(function () {
  // 1. Inject page-context scripts (parser first, then the WebSocket wrapper).
  function injectScript(path) {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL(path);
    s.async = false; // preserve execution order: parser must run before inject.js
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }
  injectScript("src/socketio-frame.js");
  injectScript("src/inject.js");

  // 2. Wheel tracker (createWheelTracker is a content-script global from wheel-core.js).
  const tracker = createWheelTracker();

  // 3. Sidebar.
  let root = null;
  let body = null;
  let header = null;

  function ensureSidebar() {
    if (root) return;
    root = document.createElement("div");
    root.id = "dmw-sidebar";
    header = document.createElement("div");
    header.className = "dmw-header";
    header.addEventListener("click", () => root.classList.toggle("dmw-collapsed"));
    body = document.createElement("div");
    body.className = "dmw-body";
    root.appendChild(header);
    root.appendChild(body);
    document.body.appendChild(root);
  }

  function imageUrl(card) {
    const u = card.image_uris || {};
    return u.en || Object.values(u)[0] || "";
  }

  function render(result) {
    ensureSidebar();
    if (!result || result.active === false) {
      header.textContent = "Didn't Wheel";
      body.innerHTML = '<div class="dmw-empty">Waiting for a pack…</div>';
      return;
    }
    if (!result.isWheel) {
      header.textContent = "Pack " + (result.boosterNumber + 1) + " — first pass";
      body.innerHTML = '<div class="dmw-empty">First pass — nothing to compare yet.</div>';
      return;
    }
    header.textContent = "Pack " + (result.boosterNumber + 1) + " — didn't wheel (" + result.didntWheel.length + ")";
    if (result.didntWheel.length === 0) {
      body.innerHTML = '<div class="dmw-empty">Everything you passed wheeled back!</div>';
      return;
    }
    const grid = document.createElement("div");
    grid.className = "dmw-grid";
    for (const card of result.didntWheel) {
      const cell = document.createElement("div");
      cell.className = "dmw-card";
      const img = document.createElement("img");
      img.src = imageUrl(card);
      img.alt = card.name || "";
      img.loading = "lazy";
      const label = document.createElement("span");
      label.textContent = card.name || "";
      cell.appendChild(img);
      cell.appendChild(label);
      grid.appendChild(cell);
    }
    body.innerHTML = "";
    body.appendChild(grid);
  }

  // 4. Receive forwarded events.
  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const msg = ev.data;
    if (!msg || msg.source !== "dm-wheel") return;
    if (msg.event === "draftState") {
      render(tracker.handleDraftState(msg.args[0]));
    } else if (msg.event === "rejoinDraft") {
      const data = msg.args[0] || {};
      render(tracker.handleRejoin(data.state || {}));
    } else if (msg.event === "pickCard") {
      tracker.handlePickCard(msg.args[0]);
    }
  });
})();
```

- [ ] **Step 3: Wire the content-script load order and CSS into `manifest.json`**

Update the `content_scripts` entry's `js` to load the core modules before `content.js`, and add the CSS:

```json
  "content_scripts": [
    {
      "matches": ["https://draftmancer.com/*", "https://www.draftmancer.com/*"],
      "js": ["src/socketio-frame.js", "src/wheel-core.js", "src/content.js"],
      "css": ["src/sidebar.css"],
      "run_at": "document_idle"
    }
  ],
```

(`src/socketio-frame.js` is listed both as a content-script `js` entry — so `createWheelTracker`/parser globals exist in the isolated world — and stays in `web_accessible_resources` so it can also be injected into the page world for `inject.js`.)

- [ ] **Step 4: Syntax-check both files**

Run: `node --check src/content.js`
Expected: exit 0. (`chrome`/`document`/`window` are referenced but `--check` only parses, so no runtime error.)

- [ ] **Step 5: Commit**

```bash
git add src/content.js src/sidebar.css manifest.json
git commit -m "feat: content script + sidebar UI rendering didn't-wheel cards"
```

---

### Task 5: Manifest finalization, README, and manual verification

**Files:**
- Modify: `manifest.json` (verify final state)
- Create: `README.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a loadable, manually-verified extension and install/usage docs.

- [ ] **Step 1: Verify `manifest.json` final state** matches the combined result of Task 1 + Task 4 Step 3 — specifically that:
  - `content_scripts[0].js` is `["src/socketio-frame.js", "src/wheel-core.js", "src/content.js"]`
  - `content_scripts[0].css` is `["src/sidebar.css"]`
  - `web_accessible_resources[0].resources` is `["src/socketio-frame.js", "src/inject.js"]`
  - both `matches` lists are `["https://draftmancer.com/*", "https://www.draftmancer.com/*"]`

- [ ] **Step 2: Create `README.md`**

```markdown
# Draftmancer "Didn't Wheel" Extension

A Chrome extension that shows, during a live booster draft on draftmancer.com,
which cards from a pack did **not** wheel back to you (i.e. cards other drafters
took while the pack circulated the table).

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder.
4. Open https://draftmancer.com and start (or join) a standard booster draft.

## How it works

The extension observes the draft's socket.io WebSocket traffic in the page,
records each booster you see (keyed by each card's stable `uniqueID`), and when a
pack wheels back to you it shows the set difference — the cards that were in the
pack last time but are gone now, excluding your own picks — in a sidebar.

## Limitations

- Standard booster draft only. Other modes (Winston, Grid, etc.) are ignored.
- draftmancer.com only.
- If you reload the page mid-draft, picks made before the reload are not tracked.
- If the connection ever falls back to socket.io long-polling (instead of
  WebSocket), the sidebar will show nothing.

## Development

Run the unit tests for the pure logic (frame parsing + wheel matching):

    npm test
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests from Tasks 1 and 2 green.

- [ ] **Step 4: Manual verification in Chrome** (record results)

1. Load the extension unpacked (README steps 1–3).
2. Go to draftmancer.com, create a session, add bots (e.g. 7 bots for an 8-player pod), and start a draft.
3. **First pick:** sidebar shows "Pack 1 — first pass — nothing to compare yet."
4. Pick through the pack. When the pack wheels back (pick 9 in an 8-player pod), the sidebar header reads "Pack 1 — didn't wheel (N)" and shows card images + names for the cards that did not return.
5. Confirm the card you took on the first pass is **not** listed.
6. Confirm clicking the header collapses/expands the sidebar.
7. Confirm pack 2 starts fresh ("first pass") and does not reference pack-1 cards.
8. Open DevTools console; confirm no uncaught errors from the extension.

If injection timing prevents interception of the initial connection (sidebar never updates), resolve the spec's open question: add a second `content_scripts` entry that injects `src/socketio-frame.js` + `src/inject.js` at `run_at: "document_start"` via a tiny loader, or set the main entry to `document_start`. Re-verify.

- [ ] **Step 5: Commit**

```bash
git add manifest.json README.md
git commit -m "docs: add README and finalize manifest"
```

---

## Notes for the implementer

- There is **no bundler**; files are loaded directly. The UMD guard in `socketio-frame.js` and `wheel-core.js` is what lets the same file serve both Node tests and the browser.
- Do not add npm dependencies. The only tooling is Node's built-in `--test` and `--check`.
- The injector and the DOM rendering have no automated tests by design — they are thin glue over browser APIs and are covered by the Task 5 manual checklist. All non-trivial logic lives in the two tested core modules.
