# Draftmancer "Didn't Wheel" Chrome Extension — Design

**Date:** 2026-06-23
**Status:** Approved design, pre-implementation

## Purpose

A Chrome extension that, during a live booster draft on **draftmancer.com**, shows
in a sidebar which cards from a pack you saw earlier did **not** come back to you
when that pack wheeled around the table (i.e. cards other drafters took).

## Target & constraints

- **Target site:** `https://draftmancer.com` only (the public site). The www host is
  included defensively in the manifest match patterns.
- **Standalone:** lives in its own directory (`/home/rothenell/mtg/draftmancer-wheel-extension/`),
  separate from the Draftmancer source fork, so it survives app updates and avoids
  any merge entanglement with the fork.
- **Manifest V3** Chrome extension.
- **Live only:** the value is shown during the draft, not as a post-draft report.
- **Read-only:** the extension never sends data to the server or mutates draft state;
  it only observes traffic and renders UI.

## Key domain facts (verified against the Draftmancer source)

- The client connects via **socket.io over WebSocket** (transport preference
  `["websocket", "polling"]`; on draftmancer.com this is `wss://`).
- Incoming event **`draftState`** carries the current pack as `DraftSyncData`:
  `{ booster?: UniqueCard[], boosterCount, boosterNumber, pickNumber }`.
- On reconnect, event **`rejoinDraft`** carries `{ state: DraftSyncData, pickedCards }`.
- Every card has a stable numeric **`uniqueID`** that persists as the physical card
  travels around the table. This is the backbone of wheel matching. `uniqueID` is
  **not** exposed in the rendered DOM, which is why we read socket traffic instead of
  scraping the DOM.
- Outgoing event **`pickCard`** carries `{ pickedCards: number[], burnedCards: number[], ... }`
  where `pickedCards`/`burnedCards` are **indices into the currently active booster**,
  not uniqueIDs. They are resolved to uniqueIDs against the last-seen booster.
- Other draft modes (Winston, Grid, Rochester, Rotisserie, Winchester, Housman,
  Solomon, Silent Auction, Minesweeper) use their own events and have no "wheel";
  the extension ignores them by only reacting to `draftState`/`rejoinDraft`.

## The matching algorithm

State held by the content script for the current draft:

- `snapshots`: list of `{ boosterNumber, pickNumber, uniqueIDs: Set<number>, cardsById: Map<number, Card> }`,
  one per `draftState` booster received.
- `pickedUniqueIDs`: `Set<number>` of every card you have picked (and burned),
  accumulated across the draft.
- `lastBooster`: the most recent booster (ordered card list) — used to resolve
  outgoing `pickCard` indices to uniqueIDs.

On each incoming `draftState` with a non-empty `booster`:

1. Build the current booster's `uniqueIDs` set and `cardsById` map.
2. Find its **earlier incarnation**: among prior snapshots with the *same*
   `boosterNumber` and a *lower* `pickNumber`, pick the one whose `uniqueIDs` has the
   largest intersection with the current booster (this is the same physical pack on a
   previous pass — the current cards are a subset of it). If no prior snapshot in this
   `boosterNumber` overlaps, this is a first pass (not a wheel).
3. If an earlier incarnation is found, compute:
   `didntWheel = earlier.uniqueIDs − current.uniqueIDs − pickedUniqueIDs`.
   Resolve each remaining uniqueID to its full card via `earlier.cardsById` for
   rendering. These are the cards others took while the pack circulated.
4. Append the current snapshot to `snapshots`, set `lastBooster`, and update the sidebar.

On each outgoing `pickCard`:

- Resolve `pickedCards` and `burnedCards` indices against `lastBooster`, add the
  resolved uniqueIDs to `pickedUniqueIDs`.

On `rejoinDraft` (reconnect mid-draft):

- Seed `snapshots`/`lastBooster` from `data.state` so a reload still functions.
  Picks made before the reload are not recoverable and are not tracked (accepted
  limitation — the sidebar simply won't exclude those specific own-picks if they ever
  reappear, which in practice they don't because you keep what you picked).

The algorithm is **player-count agnostic** and works for every pack (1/2/3) and every
wheel automatically, with no assumption about table size.

## Architecture (three pieces)

### 1. `inject.js` — page-context interceptor
Runs in the page's own JS world (injected by the content script via a `<script>` tag
pointing at a web-accessible resource). Responsibilities:

- Wrap the global `WebSocket` constructor so every socket.io connection's incoming
  `message` events and outgoing `send` calls are observed.
- Parse socket.io/engine.io text frames. Event frames look like `42["draftState",{…}]`
  (optionally with a namespace and ack id, e.g. `42/foo,3["event",…]`). Parse only:
  - incoming `draftState` and `rejoinDraft`
  - outgoing `pickCard`
- Forward the parsed payloads to the content script via
  `window.postMessage({ source: "dm-wheel", type, payload }, "*")`.
- Robustness: wrap in try/catch; ignore binary frames and unparseable frames; never
  throw into page code. If the socket ever falls back to polling, no frames are seen
  and the sidebar simply shows nothing (documented degradation, not a crash).

This is the only component coupled to an external contract, and that contract is the
**stable socket.io wire format**, not Vue internals or DOM structure.

### 2. `content.js` — logic + sidebar UI
Runs in the isolated content-script world. Responsibilities:

- Inject `inject.js` into the page on load.
- Listen for `window.postMessage` events from the injector, filtering on
  `source === "dm-wheel"`.
- Maintain the matching state and run the algorithm above.
- Render and update the **sidebar** (see UI section). DOM and styles are namespaced
  (prefixed class names / a single mounted root element) to avoid clashing with the app.

### 3. `manifest.json` — Manifest V3
- `content_scripts.matches`: `["https://draftmancer.com/*", "https://www.draftmancer.com/*"]`,
  `run_at: document_idle` (or `document_start` for the injector if needed to wrap
  `WebSocket` before the app connects — see Open question below).
- `web_accessible_resources`: `inject.js` (and the sidebar CSS if separate),
  scoped to the draftmancer.com matches.
- Minimal permissions: no host permissions beyond the content-script match; no
  network, storage, or tabs permissions required for v1.

## Sidebar UI

- A fixed, toggleable panel docked to one side of the viewport, with a collapse/expand
  control so it can be moved out of the way.
- **Header:** e.g. `Pack 1 — didn't wheel (7)` reflecting the current booster's round
  and the count of cards that did not return.
- **Body:** a grid of the missing cards, each shown with its **image and name**, using
  the Scryfall image URL already present on the card object.
- **First-pass state:** when the current pack has no earlier incarnation, show a neutral
  message (e.g. "First pass — nothing to compare yet").
- **Idle state:** when not in a booster draft (other modes, lobby), the sidebar stays
  hidden or shows an idle message.

## Edge cases

- **Reconnect** (`rejoinDraft`): seed state from `data.state`; pre-reload picks untracked
  (accepted).
- **Non-standard draft modes:** ignored (extension only reacts to `draftState`/`rejoinDraft`).
- **socket.io polling fallback:** sidebar shows nothing rather than breaking.
- **New round:** snapshots are namespaced by `boosterNumber`, so pack 2 never matches a
  pack-1 snapshot.
- **Burned cards** (some formats): treated like picks — added to `pickedUniqueIDs` so they
  are not reported as "didn't wheel."

## Out of scope (v1, YAGNI)

- Post-draft summary / history view.
- Showing *who* took each card (not available to the client during the draft).
- Local-instance support (`http://localhost:*`) — can be added to match patterns later.
- Polling-transport support.
- Configuration/options UI, persistence across page loads.

## Open questions for implementation

- **Injector timing:** confirm whether `document_idle` injection wraps `WebSocket`
  before socket.io connects, or whether the injector must run at `document_start`
  (and/or be registered as its own `content_scripts` entry with `run_at: document_start`)
  to reliably intercept the initial connection. Verify during implementation.
