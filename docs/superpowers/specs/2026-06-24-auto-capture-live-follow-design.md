# Auto-Capture + Live-Following Replay — Design

**Date:** 2026-06-24
**Status:** Approved design, pre-implementation

## Purpose

Capture your draft automatically as you play on draftmancer.com (no manual MTGO
export), and let the replay viewer load it directly — and **follow it live**,
updating pick-by-pick while you draft in another tab.

## 1. Capture (content script, draftmancer.com)

The MAIN-world injector already forwards `draftState` (your current booster) and
`pickCard` (your picked indices) to `content.js` (isolated world, has
`chrome.storage` access). A small accumulator runs alongside the live sidebar:

- On `draftState` with a non-empty booster: remember it as the current booster.
  If its `boosterNumber === 0 && pickNumber === 0`, start a **new draft** (reset
  the accumulator).
- On `pickCard`: append `{ packNum, pickNum, cards, pickedIndices }` to the
  accumulator, where:
  - `packNum = boosterNumber + 1`, `pickNum = pickNumber + 1` (from the current
    booster's `draftState`).
  - `cards` map the current booster: `{ name, set, collector, uniqueID }` where
    `set = card.set` (omitted if empty), `collector = card.collector_number`
    (omitted if empty), `uniqueID = card.uniqueID`.
  - `pickedIndices = pickCard.pickedCards` (indices into the current booster).
- After every pick, write the whole accumulated draft to `chrome.storage.local`
  under key **`dmwLastDraft`**: `{ capturedAt: <ms>, player: null, picks: [...] }`.
  The payload is names + ids only (no images), tiny, kept in a single slot and
  overwritten each new draft.

Captured **incrementally** so the "last draft" is always current (in-progress or
complete). A mid-draft page reload starts a fresh capture (same limitation the
live sidebar already has). Only standard booster draft is captured (the injector
only forwards `draftState`/`pickCard`).

## 2. Exact wheel detection via real uniqueIDs

Captured cards carry real `uniqueID`s, so the replay doesn't need the pasted-log
synthetic-id / pod-size machinery. `buildReplay` is changed to use a card's
provided `uniqueID` when present, else synthesize as today:

```
const id = (typeof c.uniqueID === "number") ? c.uniqueID : <existing synthetic id>;
```

For captured drafts (all cards have real ids) wheel detection is exactly as
accurate as the live sidebar — no pod-size assumption, no duplicate-name caveat.
Pasted MTGO logs (no `uniqueID`) are unchanged. The captured draft object has no
`players` field; that is fine because the synthetic/pod-size path is bypassed.

## 3. Viewer: load + live-follow

### Load
The landing screen gains a **"Load my last draft"** button, labelled with the
capture date and pick count (e.g. "Load my last draft — Jun 24, 14:32 · 23
picks"). If no `dmwLastDraft` exists, the button is shown disabled/with a hint
("Draft on draftmancer.com first"). Clicking reads `dmwLastDraft`, calls
`buildReplay` on it directly (skipping the text parser), renders, and **enters
follow mode**. Paste/upload of an external MTGO log still works and **exits**
follow mode.

### Follow mode
- The viewer registers a `chrome.storage.onChanged` listener (local area). When
  `dmwLastDraft` changes, it re-reads the draft, rebuilds the replay, and
  re-renders in place (no full reset).
- **Tail-follow rule:** if `stepIndex` was on the previous last step when the
  update arrives, advance to the new last step (follow the live edge); otherwise
  keep `stepIndex` (clamped to the new length) so reviewing an earlier pick is not
  interrupted. The position counter's `/N` grows, hinting new picks arrived.
- Follow mode ends when the user loads an external pasted/uploaded log.

### Incremental Scryfall fetch
On each follow-update, fetch card data only for cards whose name is not already in
the cached `cardData` map, and merge results in — so a long draft does not
re-fetch every card each pick. Implemented via a `scryfall` helper that filters
identifiers by an "already known" set.

## 4. Components / files

- **New `src/capture.js`** — pure, unit-tested. `createDraftCapture()` returns an
  object with:
  - `onDraftState(payload)` — set current booster; reset on `boosterNumber 0 /
    pickNumber 0`.
  - `onPickCard(payload)` — append the pick (mapped cards + indices); returns the
    current draft `{ player: null, picks }`.
  - `getDraft()` — returns the current `{ player: null, picks }`.
  Pure (no `chrome`, no `Date`); the caller stamps `capturedAt`.
  UMD guard exposing `globalThis.createDraftCapture` + Node export.
- **`content.js`** — alongside the existing sidebar handling, feed `draftState`
  and `pickCard` into a `createDraftCapture()` instance, and after each pick
  `chrome.storage.local.set({ dmwLastDraft: { ...capture.getDraft(), capturedAt: Date.now() } })`.
  Defensive: wrapped so a capture/storage error never breaks the sidebar.
- **`src/viewer/replay.js`** — use a card's provided `uniqueID` when present.
- **`src/viewer/scryfall.js`** — add `fetchMissing(cards, knownKeys, fetchImpl?)`
  (or extend `fetchCardData` with a `known` set) that skips identifiers already
  present; pure batching logic remains testable with a stub fetch.
- **`viewer.js` / `viewer.html`** — the "Load my last draft" button; a shared
  `startReplay(parsed)` used by both paste-load and load-last-draft; the
  `chrome.storage.onChanged` follow listener with the tail-follow logic; the
  incremental fetch on updates.
- **`manifest.json`** — add `src/capture.js` to the existing isolated-world
  content-script `js` list (before `content.js`). The `storage` permission is
  already present; no new permission.

## 5. Testing

- `src/capture.js`: TDD unit tests — accumulation across picks; card-field mapping
  (`collector_number → collector`, omit empty `set`/`collector`, keep `uniqueID`);
  reset on a new draft (`0/0`); `getDraft` shape.
- `src/viewer/replay.js`: unit test that a card carrying a real `uniqueID` is used
  as-is (and that a wheel computed from real ids is correct) while pasted-log
  behavior is unchanged.
- `src/viewer/scryfall.js`: unit test that the incremental fetch skips already-known
  cards and fetches only the rest (stub fetch).
- End-to-end (Puppeteer): open the viewer and click **Load my last draft**; drive
  picks on a draftmancer.com bot draft in another page; assert the viewer
  auto-advances / updates as picks land (tail-follow), and that reviewing an
  earlier pick is not interrupted by a new pick.

## Out of scope (YAGNI)

- History / multiple saved drafts (the planned follow-up feature).
- Capturing non-standard draft modes.
- `chrome.storage.sync` / cross-device.
- Storing card images in the capture.
- A manual "Jump to live" button (the tail-follow rule covers it).
- Any change to the live "didn't wheel" sidebar behavior itself.
