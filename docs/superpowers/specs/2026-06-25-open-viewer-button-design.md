# One-Click "Open Replay" From Draftmancer — Design

**Date:** 2026-06-25
**Status:** Approved design, pre-implementation
**Stacked on:** `2026-feat/deck-stats` → … → `master`

## Purpose

Let the user jump straight from a live Draftmancer draft to the replay viewer's
**current draft**, instead of opening the toolbar viewer and clicking the history
row.

## Behavior

- The live "didn't wheel" sidebar on draftmancer.com gains a small **"Open replay
  ↗"** button.
- Clicking it opens the viewer in a new tab **directly on the current draft**
  (`dmwDrafts[0]`), jumping to the latest pick — not the landing/history list.
- The **toolbar icon is unchanged**: it opens the viewer to the landing/history
  list (no auto-open).
- If nothing has been captured yet, the deep-link simply lands on the
  landing/history list (no error).

## Mechanism

Content scripts can't open tabs, so the click is routed through the background
service worker:

1. **`content.js`** (sidebar) renders the button and, on click, calls
   `chrome.runtime.sendMessage({ type: "openViewer" })`. Wrapped so a messaging
   failure can never break the sidebar.
2. **`background.js`** adds a `chrome.runtime.onMessage` listener: on
   `{ type: "openViewer" }`, `chrome.tabs.create({ url:
   chrome.runtime.getURL("viewer.html?open=current") })`. The existing
   `chrome.action.onClicked` handler (opens `viewer.html` with no query) stays.
3. **`viewer.js`** on init parses `location.search`; if it contains
   `open=current`, after `refreshHistory()` it reads `dmwDrafts` and, if a draft
   exists, calls `openDraft(dmwDrafts[0].draftId)` to deep-link to the current
   draft. Absent the param (toolbar icon), behavior is unchanged.

## Components / files

- `background.js`: add the `onMessage` listener (`openViewer` → open
  `viewer.html?open=current`).
- `src/content.js`: add an "Open replay ↗" button to the sidebar (in the header
  area), `dmw-`-prefixed, with a click handler that sends the message inside a
  try/catch. The button is created in `ensureSidebar` so it appears with the
  sidebar.
- `src/viewer/viewer.js`: in `init`, detect `?open=current` and auto-open the
  newest captured draft (guarded by storage availability and a non-empty
  `dmwDrafts`).

## Testing

- `content.js` button + `background.js` routing: manual + Puppeteer e2e (the
  message path is browser-only glue).
- `?open=current` auto-open: Puppeteer e2e — load `viewer.html?open=current` with
  a draft seeded in `chrome.storage.local`, confirm it opens that draft at the
  latest pick (vs. `viewer.html` with no param showing the landing list).

## Out of scope (YAGNI)

- A keyboard shortcut.
- Opening a specific (non-current) draft from the page.
- Reusing/focusing an already-open viewer tab (each click opens a new tab).
- Any change to the capture or stats logic.
