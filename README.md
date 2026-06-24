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

Run the unit tests for the pure logic (frame parsing + wheel matching):

    npm test

## Draft Log Replay viewer

Click the extension's toolbar icon to open the replay viewer in a new tab. Upload
or paste a Draftmancer draft log exported in **MTGO / MagicProTools** format, then
step through your draft pick by pick with the on-screen buttons or the ← / →
arrow keys. Each step shows:

- the booster you faced, with your pick highlighted,
- which cards did not wheel back when a pack returns to you,
- your deck so far, grouped into mana-curve columns.

Card images and data are fetched from Scryfall, so the viewer needs an internet
connection. Requires Chrome 111+.

Note: the log identifies cards by name, so two different physical copies of the
same card name within a single booster can't be told apart — at worst this slightly
mis-attributes a duplicate common in the "didn't wheel" panel.
