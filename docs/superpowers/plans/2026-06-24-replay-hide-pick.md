# Replay Hide-My-Pick + Deck-So-Far Timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the replay viewer's "deck so far" reflect only picks before the current pick, and add a "Hide my pick" toggle with a "Reveal pick" button so the replay works as a self-quiz.

**Architecture:** Two scoped changes to the existing viewer: a one-line reordering in the pure `replay.js` (snapshot deck-so-far before adding the current pick), and UI state + controls in `viewer.js`/`viewer.html`/`viewer.css` (a checkbox and reveal button gating the booster's pick highlight).

**Tech Stack:** Vanilla JS, no build step, Node's built-in `node --test`. No new dependencies.

## Global Constraints

- No third-party runtime/test dependencies. Tests use `node:test`/`node:assert`.
- All viewer DOM ids/classes are `dmw-` prefixed.
- "Hide my pick" defaults OFF (current behavior unchanged: picked card highlighted).
- The change must NOT alter the "didn't wheel" computation in `replay.js` (order `handleDraftState` → capture `didntWheel` → `handlePickCard` stays).
- No manifest change; no change to the live content-script feature.

---

### Task 1: Deck-so-far excludes the current pick (`src/viewer/replay.js`)

**Files:**
- Modify: `src/viewer/replay.js` (the deck accumulation + `steps.push` in `buildReplay`)
- Test: `test/replay.test.js` (update the deckSoFar assertions)

**Interfaces:**
- Consumes: unchanged (`parseDraftLog` output).
- Produces: unchanged `buildReplay(parsed) => { player, steps }`, except `steps[k].deckSoFar` now contains the cards picked at steps `0..k-1` (NOT the current pick's selection). All other `Step` fields (`packNum`, `pickNum`, `cards`, `didntWheel`) are unchanged.

- [ ] **Step 1: Update the failing test** in `test/replay.test.js`

Replace the existing test named `"deckSoFar accumulates picked cards in pick order"` with this (new semantics — deck reflects picks *before* the current one):

```js
test("deckSoFar reflects only picks made before the current pick", () => {
  const { steps } = buildReplay(parsed);
  assert.deepStrictEqual(steps[0].deckSoFar.map((c) => c.name), []); // nothing drafted entering pick 1
  assert.deepStrictEqual(steps[1].deckSoFar.map((c) => c.name), ["Alpha"]); // only pick 1's card
  assert.deepStrictEqual(steps[2].deckSoFar.map((c) => c.name), ["Alpha", "Delta"]); // picks 1 and 2
});
```

(Leave the other tests — player, first-pass/picked flags, wheel, rejoin/reset, cumulative, false-wheel — unchanged.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL on `"deckSoFar reflects only picks made before the current pick"` (current code includes the current pick, so step0 is `["Alpha"]`, not `[]`).

- [ ] **Step 3: Update the implementation** in `src/viewer/replay.js`

The current tail of the `for (const p of parsed.picks)` loop is:

```js
    for (const idx of p.pickedIndices) {
      if (p.cards[idx]) deckSoFar.push(ref(p.cards[idx]));
    }
    tracker.handlePickCard({ pickedCards: p.pickedIndices });

    steps.push({ packNum: p.packNum, pickNum: p.pickNum, cards, didntWheel, deckSoFar: deckSoFar.slice() });
```

Replace it with (snapshot the deck BEFORE adding this pick's cards, and push that snapshot):

```js
    // Snapshot the deck as it stood ENTERING this pick (excludes the current
    // selection); the card taken here first appears in the deck at the next step.
    const deckBefore = deckSoFar.slice();
    for (const idx of p.pickedIndices) {
      if (p.cards[idx]) deckSoFar.push(ref(p.cards[idx]));
    }
    tracker.handlePickCard({ pickedCards: p.pickedIndices });

    steps.push({ packNum: p.packNum, pickNum: p.pickNum, cards, didntWheel, deckSoFar: deckBefore });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all tests green (the updated deckSoFar test plus the unchanged wheel/first-pass/etc. tests).

- [ ] **Step 5: Commit**

```bash
git add src/viewer/replay.js test/replay.test.js
git commit -m "feat: deck-so-far reflects only picks before the current pick"
```

---

### Task 2: "Hide my pick" toggle + "Reveal pick" button (`viewer.html`, `viewer.css`, `src/viewer/viewer.js`)

**Files:**
- Modify: `viewer.html` (add checkbox + reveal button to `#dmw-header`)
- Modify: `src/viewer/viewer.css` (spacing for the new controls)
- Modify: `src/viewer/viewer.js` (state + gating + wiring)

**Interfaces:**
- Consumes: `Step.cards[].picked` (boolean) from Task 1's `buildReplay`; the existing `#dmw-header` and booster rendering.
- Produces: UI only. New DOM ids: `#dmw-hidepick` (checkbox), `#dmw-reveal` (button). No exported API.

This is browser glue verified by `node --check` + manual/e2e (no unit test).

- [ ] **Step 1: Add the controls to `viewer.html`**

Replace the `#dmw-header` block:

```html
      <div id="dmw-header">
        <button id="dmw-prev">◀ Prev</button>
        <span id="dmw-position"></span>
        <button id="dmw-next">Next ▶</button>
        <span id="dmw-notice"></span>
      </div>
```

with (adds the hide-pick checkbox and the reveal button):

```html
      <div id="dmw-header">
        <button id="dmw-prev">◀ Prev</button>
        <span id="dmw-position"></span>
        <button id="dmw-next">Next ▶</button>
        <label id="dmw-hidepick-label" class="dmw-toggle">
          <input type="checkbox" id="dmw-hidepick" /> Hide my pick
        </label>
        <button id="dmw-reveal" hidden>Reveal pick</button>
        <span id="dmw-notice"></span>
      </div>
```

- [ ] **Step 2: Add styles to `src/viewer/viewer.css`**

Append:

```css
.dmw-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}
```

- [ ] **Step 3: Update `src/viewer/viewer.js`** — add state, gate the highlight, toggle the reveal button, reset on navigation, and wire the controls.

3a. Add two state variables next to the existing ones at the top of the IIFE. The current lines are:

```js
  let replay = null; // { player, steps }
  let stepIndex = 0;
  let cardData = new Map(); // nameLowercased -> { imageUrl, cmc, colors, typeLine, name }
```

Add below them:

```js
  let hidePick = false; // "Hide my pick" toggle
  let revealed = false; // whether the current step's pick has been revealed
```

3b. In `renderStep()`, the booster rendering and a reveal-button update. The current lines are:

```js
    const booster = $("dmw-booster");
    booster.innerHTML = "";
    step.cards.forEach((c) => booster.appendChild(cardEl(c, c.picked)));
```

Replace with (highlight the pick only when not hidden, or when revealed; and show the Reveal button only while hidden-and-not-yet-revealed):

```js
    const showPick = !hidePick || revealed;
    const booster = $("dmw-booster");
    booster.innerHTML = "";
    step.cards.forEach((c) => booster.appendChild(cardEl(c, c.picked && showPick)));
    $("dmw-reveal").hidden = !(hidePick && !revealed);
```

3c. In `go(delta)`, reset the reveal when navigating. The current function is:

```js
  function go(delta) {
    if (!replay) return;
    const n = Math.min(replay.steps.length - 1, Math.max(0, stepIndex + delta));
    if (n !== stepIndex) {
      stepIndex = n;
      renderStep();
    }
  }
```

Replace with (clear `revealed` whenever the step actually changes):

```js
  function go(delta) {
    if (!replay) return;
    const n = Math.min(replay.steps.length - 1, Math.max(0, stepIndex + delta));
    if (n !== stepIndex) {
      stepIndex = n;
      revealed = false;
      renderStep();
    }
  }
```

3d. In `init()`, wire the checkbox and the reveal button. The current `init()` body ends with the keydown listener:

```js
    $("dmw-prev").addEventListener("click", () => go(-1));
    $("dmw-next").addEventListener("click", () => go(1));
    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    });
```

Add, immediately after the `keydown` listener (still inside `init()`):

```js
    $("dmw-hidepick").addEventListener("change", (e) => {
      hidePick = e.target.checked;
      revealed = false; // re-hide on toggle
      if (replay) renderStep();
    });
    $("dmw-reveal").addEventListener("click", () => {
      revealed = true;
      renderStep();
    });
```

3e. In `load(text)`, reset the reveal state when a new log is loaded so a stale reveal can't leak the pick. The current lines are:

```js
    stepIndex = 0;
    cardData = new Map();
```

Replace with:

```js
    stepIndex = 0;
    revealed = false;
    cardData = new Map();
```

- [ ] **Step 4: Syntax-check**

Run: `node --check src/viewer/viewer.js`
Expected: exit 0.

Run: `npm test`
Expected: PASS — unit tests unaffected (this task changes only browser glue).

- [ ] **Step 5: Manual / e2e verification** (record results)

1. Reload the unpacked extension at `chrome://extensions`; open the viewer (toolbar icon) and load a real Draftmancer MTGO log.
2. Default (checkbox off): the booster highlights your picked card; "your deck so far" at pick 1 is empty and grows by one each time you advance (the card you take at a pick appears in the deck on the *next* pick).
3. Check **"Hide my pick"**: the highlight disappears, a **"Reveal pick"** button appears, and the current pick is not shown anywhere (not highlighted, not in the deck).
4. Click **"Reveal pick"**: the taken card is highlighted without advancing; the button hides.
5. Press **Next** then **Prev**: the reveal resets (pick hidden again on each new step while the checkbox stays checked).
6. Uncheck **"Hide my pick"**: highlight returns immediately; Reveal button gone.

- [ ] **Step 6: Commit**

```bash
git add viewer.html src/viewer/viewer.css src/viewer/viewer.js
git commit -m "feat: hide-my-pick toggle with reveal button in replay viewer"
```

---

## Notes for the implementer

- Task 1 is the only logic change and is fully unit-tested. Task 2 is browser glue (no unit test) — the manual checklist in Step 5 is the verification.
- Keep the `dmw-` prefix on all new ids/classes.
- Do not touch `src/wheel-core.js`, the parser, Scryfall, the manifest, or the live content-script feature.
