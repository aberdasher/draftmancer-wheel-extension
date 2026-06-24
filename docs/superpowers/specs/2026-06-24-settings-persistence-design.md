# Viewer Settings Persistence — Design

**Date:** 2026-06-24
**Status:** Approved design, pre-implementation

## Purpose

Make the replay viewer's three in-page controls remember their state across
sessions, so the user doesn't have to re-set them every time they open the
viewer. No separate options page — the existing controls *are* the settings.

## What persists

Saved whenever the user changes a control, restored when the viewer opens:

- **Hide my pick** — `hidePick` (boolean)
- **Deck sort** — `deckSort` (`"cmc"` | `"color"`)
- **Split creatures** — `splitCreatures` (boolean)

First-run defaults (when nothing is stored yet) stay as they are today:
`hidePick: true`, `deckSort: "cmc"`, `splitCreatures: false`. A stored value
overrides the default; an invalid/unknown stored value is ignored in favor of
the default.

## Storage

`chrome.storage.local` under a single key **`dmwPrefs`** holding
`{ hidePick, deckSort, splitCreatures }`. Local (not `sync`) keeps it simple — no
Chrome-sign-in dependency, no quota concerns; switching to `sync` later is a
one-line change. Requires adding the **`"storage"`** permission to the manifest.
The live content-script feature is unaffected.

## Flow

- **On viewer init:** read `dmwPrefs` asynchronously, merge over the defaults,
  set the `hidePick`/`deckSort`/`splitCreatures` state variables, and reflect them
  in the DOM (the hide-pick checkbox `checked`, the active sort button's
  `dmw-active` class, the split checkbox `checked`) — all before any log is loaded
  (the replay isn't rendered until a log loads, so there is no flash).
- **On control change:** the existing handlers (hide-pick checkbox, the two sort
  buttons, the split checkbox) each write the updated value back into `dmwPrefs`.

## Code shape

### New module `src/viewer/prefs.js`

- **Pure, unit-tested:** `mergePrefs(stored, defaults) => prefs` — returns a new
  object equal to `defaults` with valid values from `stored` applied on top.
  Whitelists the three known keys, validates types/domain (`hidePick`,
  `splitCreatures` must be boolean; `deckSort` must be `"cmc"` or `"color"`),
  and ignores anything else (missing key, wrong type, junk key, `null`/non-object
  `stored`).
- **Browser glue (not unit-tested):** thin async wrappers
  `loadPrefs(callback)` and `savePref(key, value)` over `chrome.storage.local`
  (read/merge the single `dmwPrefs` object). Defensive: if `chrome.storage` is
  unavailable, `loadPrefs` falls back to defaults and `savePref` is a no-op.
- UMD guard exposing `globalThis.Prefs = { DEFAULTS, mergePrefs, loadPrefs, savePref }`
  and the Node `module.exports` equivalent.

### `viewer.js`

- Initialize `hidePick`/`deckSort`/`splitCreatures` from `Prefs.DEFAULTS` (so the
  literals live in one place).
- In `init()`: call `Prefs.loadPrefs((prefs) => { … })` — set the three state
  variables, reflect them in the DOM controls, and if a replay is already loaded,
  re-render (in practice none is loaded yet at init).
- In the three control handlers: after updating the state variable, call
  `Prefs.savePref("hidePick"|"deckSort"|"splitCreatures", value)`.

### `viewer.html`

- Load `src/viewer/prefs.js` before `viewer.js` in the script list.

### `manifest.json`

- Add top-level `"permissions": ["storage"]`. (Existing `content_scripts`,
  `host_permissions`, `action`, `background`, `icons` unchanged.)

## Testing

- `src/viewer/prefs.js`: TDD unit tests for `mergePrefs` — empty/`null` stored →
  defaults; partial override (one key) keeps the others at default; invalid type
  (`deckSort: "rarity"`, `hidePick: "yes"`) rejected to default; unknown keys
  ignored; a fully valid stored object applied.
- Persistence end-to-end: manual + Puppeteer e2e — change controls, reload the
  viewer page, confirm the controls come back in the chosen state (and the
  rendered deck/booster reflect them).

## Out of scope (YAGNI)

- A separate options page.
- New settings (card-size slider, theme).
- `chrome.storage.sync` / cross-device sync.
- Persisting anything else (current pick index, loaded log).
- Any change to the live content-script "didn't wheel" feature.
