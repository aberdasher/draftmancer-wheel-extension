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

- Requires Chrome 111 or newer (the extension uses a MAIN-world content script to observe the WebSocket before the app connects, which requires Chrome 111+).
- Standard booster draft only. Other modes (Winston, Grid, etc.) are ignored.
- draftmancer.com only.
- If you reload the page mid-draft, picks made before the reload are not tracked.
- If the connection ever falls back to socket.io long-polling (instead of
  WebSocket), the sidebar will show nothing.

## Development

Run the unit tests for the pure logic (frame parsing + wheel matching):

    npm test
