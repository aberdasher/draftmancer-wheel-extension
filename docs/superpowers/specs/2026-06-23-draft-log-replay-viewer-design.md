# Draft-Log Replay Viewer — Design

**Date:** 2026-06-23
**Status:** Approved design, pre-implementation

## Purpose

Add a draft-log replay tool to the existing Draftmancer "Didn't Wheel" extension.
The user loads a Draftmancer-exported MTGO / MagicProTools draft log, then walks
through their draft **pick by pick**, seeing at each step:

- the booster they faced (cards as images, with their pick highlighted),
- which cards from that pack did **not** wheel back (when the pack is a wheel),
- their **deck so far**, grouped into mana-curve columns.

This is a standalone viewer page; it does not touch the live content-script
feature or draftmancer.com.

## Constraints

- Same extension, Manifest V3. The existing content script and "didn't wheel"
  live feature are untouched.
- The viewer is opened from the toolbar icon and runs as an extension page
  (`viewer.html`), so it works any time, not only right after a draft.
- Card images and card data (CMC/color/type) are fetched from **Scryfall**
  (the log contains only names), so the viewer requires an internet connection.
- No third-party runtime/test dependencies; pure-logic modules use the same UMD
  guard pattern as the existing code and are unit-tested with Node's `node --test`.

## Input format

The viewer parses the format produced by Draftmancer's
`exportToMagicProTools` (client/src/helper.ts):

```
Event #: <sessionID>_<time>
Time: <date>
Players:
--> YourName
    Player2
    ...

------ SET ------

Pack 1 pick 1:
--> Llanowar Elves
    Shock
    Giant Growth
    ...

Pack 1 pick 2:
    Opt
--> Lightning Bolt
    ...
```

Key properties the parser relies on:

- The `--> ` prefix in the `Players:` block marks the log owner; the `--> `
  prefix inside a `Pack X pick Y:` block marks the card(s) that player picked.
- Each `Pack X pick Y:` block lists **every** card in that booster, in order,
  with the picked one(s) marked. This is enough to reconstruct boosters, picks,
  the deck, and wheel diffs from the log alone.
- Card lines are either `Card Name` or `Card Name (SET) 123` (set code +
  collector number) — both must be handled.

## Architecture & files

New files (all under the existing extension repo):

- `background.js` — MV3 service worker. On `chrome.action.onClicked`, opens
  `viewer.html` in a new tab. (The action has no default popup.)
- `viewer.html` — the viewer page markup.
- `src/viewer/viewer.css` — viewer styles (all classes prefixed `dmw-`).
- `src/viewer/log-parser.js` — **pure**: MTGO log text → structured picks.
  Unit-tested.
- `src/viewer/replay.js` — **pure**: parsed picks → per-pick replay model
  (booster, your pick, deck-so-far, wheel result). Reuses `src/wheel-core.js`.
  Unit-tested.
- `src/viewer/scryfall.js` — fetch + cache card data/images by identifier,
  batched (≤75 per request). The batching / identifier-shaping logic is
  unit-tested with a stubbed `fetch`; the live network call is verified
  manually.
- `src/viewer/viewer.js` — UI wiring: input (file upload + paste), rendering,
  navigation. Verified manually.

Manifest changes:

- Add `"action": {}` (no `default_popup`; click handled by the service worker).
- Add `"background": { "service_worker": "background.js" }`.
- Add `"host_permissions": ["https://api.scryfall.com/*"]` for the card-data
  fetch.
- The existing `content_scripts` (the live "didn't wheel" feature) are unchanged.

`viewer.html` loads the pure modules as classic scripts in dependency order
(`src/wheel-core.js`, then `src/viewer/log-parser.js`, `src/viewer/scryfall.js`,
`src/viewer/replay.js`, `src/viewer/viewer.js`), relying on the existing UMD
globals (`createWheelTracker`, etc.). This keeps the viewer consistent with the
existing code style and keeps every pure module loadable by both the page and
`node --test`.

## Component design

### log-parser.js (pure)

`parseDraftLog(text) => { player, picks }` where:

- `player` is the owner's name (the `--> ` entry in `Players:`), or `null` if
  absent.
- `picks` is an ordered array of
  `{ packNum, pickNum, cards: [{ name, set?, collector? }], pickedIndices: [number] }`,
  with `packNum`/`pickNum` 1-indexed as written in the log.

Behavior:

- Tolerates extra blank lines, the `------ … ------` set/cube banners, and the
  header block.
- Throws a clear `Error` (e.g. `"No 'Pack X pick Y' blocks found — is this a
  Draftmancer MTGO/MagicProTools draft log?"`) when no pick blocks parse.
- Card-line regex captures an optional trailing ` (SET) collector`.

### replay.js (pure)

`buildReplay(parsed) => { player, steps }` where `steps[k]` is:

```
{
  packNum, pickNum,
  cards: [{ name, set?, collector?, picked: boolean }],   // the booster, order preserved
  didntWheel: [{ name, set?, collector? }] | null,          // null when not a wheel
  deckSoFar: [{ name, set?, collector? }],                  // your picks through step k, in pick order
}
```

Construction:

- Synthesize a stable card id per `(packNum, cardName)` so the same physical
  card matches itself across passes when fed to `wheel-core`. (Within a pack
  round, two distinct physical copies of the same name would collide — see
  Caveat. Across pack rounds, ids differ because `packNum` differs.)
- Iterate `parsed.picks` in order. For each: build the booster (cards + synthetic
  ids), call `tracker.handleDraftState({ booster, boosterNumber: packNum-1,
  pickNumber: pickNum-1 })` and record its `WheelResult` → `didntWheel`
  (mapping result cards back to `{name,set?,collector?}`); then
  `tracker.handlePickCard({ pickedCards: pickedIndices })`.
- `deckSoFar` accumulates the picked cards (resolved from `pickedIndices`) across
  steps, in pick order.

**Caveat (documented):** name-based identity cannot distinguish two different
physical copies of the same card name within one pack round. Worst case: a
duplicate common is slightly mis-attributed in the wheel panel. Acceptable for a
log replay; noted in code and README.

### scryfall.js

`fetchCardData(identifiers) => Promise<Map<key, CardData>>` where `identifiers`
are derived from the parsed log (deduplicated). Behavior:

- Prefer `{ set, collector_number }` identifiers when the log provided them,
  else `{ name }`.
- Batch into POST requests to `https://api.scryfall.com/cards/collection`
  (≤75 identifiers per request), with a small delay between requests to respect
  Scryfall's rate-limit guidance.
- Return a map keyed by a normalized card key → `{ imageUrl, cmc, colors, typeLine, name }`.
  `imageUrl` comes from `image_uris` (or the first face for double-faced cards).
- On network/HTTP failure, reject with a clear error; the UI falls back to
  rendering names without images and shows a non-blocking notice.

### viewer.js / viewer.html (UI)

- **Landing state:** an upload control (`.txt` file) and a paste textarea, with a
  "Load" action. On load: parse → build replay → kick off the Scryfall fetch →
  render step 0.
- **Replay state** (matches the approved layout):
  - Header: `Pack X · Pick Y`, **Prev** / **Next** buttons, **←/→** keyboard
    navigation.
  - **Booster** section on top: cards as images in pack order, your pick visually
    highlighted. When `didntWheel` is non-null, a "didn't wheel (N)" panel shows
    those cards (beside or under the booster).
  - **Deck so far** section below: cards grouped into **mana-curve columns**
    (0, 1, 2, 3, 4, 5, 6+) using Scryfall CMC; within a column, sorted (e.g. by
    name). A running count is shown.
  - Hovering a card shows a larger preview.
- Images render progressively as Scryfall data arrives; missing images degrade to
  a name label.
- All injected DOM/CSS is namespaced `dmw-`.

## Testing

- `log-parser.js`: TDD unit tests against a representative fixture log (with and
  without set/collector annotations, multiple packs, a wheel) → expected
  `picks` structure; plus the no-pick-blocks error case.
- `replay.js`: TDD unit tests feeding parsed picks → assert `deckSoFar`
  accumulation, `picked` flags, and `didntWheel` contents (including the
  cumulative-from-first behavior inherited from `wheel-core`).
- `scryfall.js`: unit-test batching and identifier shaping with a stubbed
  `fetch` (≤75 per batch, set/collector vs name selection, response → map);
  no live network in tests.
- `viewer.js` + `background.js`: manual verification — load the unpacked
  extension, click the toolbar icon, paste a real Draftmancer MTGO log, and step
  through (booster, wheel panel at the wheel, deck curve, keyboard nav). The
  existing live-draft e2e harness is unchanged.

## Out of scope (v1, YAGNI)

- Editing/deck-building from the replay (it is read-only).
- Reading the log directly from draftmancer.com (file upload / paste only).
- Persisting loaded logs across sessions.
- Bot/other-player perspectives (the log is the owner's perspective only).
- Offline card-image caching beyond the in-memory per-session cache.
