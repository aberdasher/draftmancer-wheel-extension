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
pack the first time you saw it but are gone now, excluding your own picks — in a
sidebar. When a pack wheels to you more than once (smaller pods), this is
cumulative: it remembers everything lost since your first sighting, not just
since the previous lap.

## Limitations

- Requires Chrome 111 or newer (the extension uses a MAIN-world content script to observe the WebSocket before the app connects, which requires Chrome 111+).
- Standard booster draft only. Other modes (Winston, Grid, etc.) are ignored.
- draftmancer.com only.
- If you reload the page mid-draft, picks made before the reload are not tracked.
- If the connection ever falls back to socket.io long-polling (instead of
  WebSocket), the sidebar will show nothing.

## Development

Run the unit tests for the pure logic (parsing, wheel matching, replay, deck layout, prefs):

    npm test

Drive a live bot draft on draftmancer.com to exercise the live feature end to end:

    npm run test:e2e

Build a shareable unpacked-extension zip (manifest + src + icons):

    npm run package

## Draft Log Replay viewer

Click the extension's toolbar icon to open the replay viewer in a new tab. Upload
or paste a Draftmancer draft log exported in **MTGO / MagicProTools** format, then
step through your draft pick by pick with the on-screen buttons or the ← / →
arrow keys. Each step shows:

- the booster you faced (your pick is **hidden by default** for self-quizzing —
  toggle **Hide my pick** off, or click **Reveal pick**, to show it),
- which cards did not wheel back when a pack returns to you,
- your deck so far, as **stacked columns** you can sort by **CMC** or **Color**,
  with an optional **Split creatures** toggle (creatures vs non-creatures).

Your sort / split / hide choices persist across sessions. Card images and data
are fetched from Scryfall, so the viewer needs an internet connection. Requires
Chrome 111+.

Note: the log identifies cards by name, so two different physical copies of the
same card name within a single booster can't be told apart — at worst this slightly
mis-attributes a duplicate common in the "didn't wheel" panel. Wheel detection uses
the pod size from the log's player list (as Draftmancer exports it); a hand-edited
or non-standard log with an inaccurate player list may mis-detect wheels.
