# Draft History — Design

**Date:** 2026-06-24
**Status:** Approved design, pre-implementation
**Stacked on:** `feat/auto-capture-live-follow` (the capture layer this builds on)

## Purpose

Keep the last few auto-captured drafts (not just the most recent one) and list
them in the viewer so the user can reopen any of them. Builds directly on the
auto-capture layer.

## Storage model

Replace the single `dmwLastDraft` slot with a rolling list under a new
`chrome.storage.local` key **`dmwDrafts`**: an array, **newest first**, **capped
at 3**. Each entry is a captured draft `{ draftId, capturedAt, player, picks }`.

- The **front entry (`dmwDrafts[0]`) is the current draft**, updated incrementally
  on each pick (exactly as `dmwLastDraft` is today).
- When a **new draft starts** (capture reset at pack 1 / pick 1), a fresh entry is
  **prepended** and the list **trimmed to 3** (oldest dropped).
- `draftId` is a stable id assigned at draft start (the start timestamp in ms) so
  the viewer can identify an entry across updates.
- **Migration:** on first write, if a legacy `dmwLastDraft` exists and `dmwDrafts`
  does not, seed `dmwDrafts` with that draft (given a `draftId`) so an existing
  capture is not lost. After migration `dmwLastDraft` is no longer written.

## Capture (content script)

- On a clean start (the `0/0` `draftState` that resets the capture), stamp a new
  `draftId` and **prepend** a new entry to `dmwDrafts`.
- On each pick, **update entry 0 in place** with the latest captured draft.
- Write the trimmed (≤3) list to `chrome.storage.local`. Still wrapped in
  try/catch so it can never break the sidebar; still only persists
  cleanly-started drafts (the `sawCleanStart` gate from the capture feature).

## Viewer

The landing screen's single "Load my last draft" button becomes a **history
list** — up to 3 rows, newest first, each labelled with **date + pick count**;
the top row is marked **"current"** while a draft is live. Clicking a row opens
that draft (by `draftId`).

- **Live-follow** applies only when the opened draft is the **current** (newest)
  entry: it tail-follows as in the capture feature. Opening an **older** draft
  shows it **statically**.
- If a brand-new draft starts while the user is following, the entry they are
  viewing is no longer `dmwDrafts[0]`; following stops and they keep viewing the
  now-archived draft statically (the list re-renders to show the new current).
- Pasting/uploading an external MTGO log still works and is **not** added to
  history.

## Components / files

- **New `src/history.js`** (pure, unit-tested), UMD-exposed as
  `globalThis.DraftHistory` / Node export:
  - `prependDraft(list, draft, cap = 3) => newList` — add a new draft to the front,
    trimmed to `cap`.
  - `updateCurrent(list, draft) => newList` — replace entry 0 (the current draft)
    with `draft`, or prepend if the list is empty.
  - `findById(list, draftId) => draft | undefined`.
  - All return new arrays/objects (no mutation of the input).
- **`src/capture.js`**: assign and expose a `draftId` (stamped on reset); the
  caller decides prepend-vs-update by comparing the current draft's `draftId`.
  (`createDraftCapture` stays pure — the `draftId` value is provided by the caller
  at reset, or the capture exposes whether a new draft just started.)
- **`src/content.js`**: maintain `dmwDrafts` via the `DraftHistory` helpers —
  prepend on a new clean start, update entry 0 on each pick — instead of writing a
  single slot; run the one-time `dmwLastDraft → dmwDrafts` migration.
- **`src/viewer/viewer.js` / `viewer.html`**: render the history list on the
  landing screen; open by `draftId`; set `following` only when the opened draft is
  `dmwDrafts[0]`; on `dmwDrafts` change, refresh the list and (if following the
  current) tail-follow.

## Testing

- `src/history.js`: TDD unit tests — prepend new (trim to 3, oldest dropped),
  update current (replace front; prepend when empty), `findById`, immutability of
  inputs.
- Viewer + capture: manual + Puppeteer e2e — capture two drafts (start one, pick,
  start another, pick); the landing list shows two rows; opening the older row
  shows it statically; opening the current row live-follows new picks.

## Out of scope (YAGNI)

- Manual delete / rename of history entries.
- Keeping more than 3 drafts.
- Set/format labels on rows (we don't capture the set name).
- `chrome.storage.sync` / cross-device sync.
