# Replay: Hide-My-Pick + Deck-So-Far Timing — Design

**Date:** 2026-06-24
**Status:** Approved design, pre-implementation

## Purpose

Two refinements to the draft-log replay viewer that turn it into a self-quiz tool:

1. **"Deck so far" should reflect only picks made *before* the current pick** — i.e.
   the pool you held *entering* this pick, not including the card you take here.
2. **An option to hide which card you actually picked**, with a button to reveal it
   on the current pick — so you can guess "what would I take here?" before checking.

## Change A — deck-so-far excludes the current pick (`src/viewer/replay.js`)

In `buildReplay`, snapshot each step's `deckSoFar` **before** accumulating that
pick's selection. Result: `steps[k].deckSoFar` is the cards drafted at picks
`0..k-1`. The first pick (step 0) shows an empty deck; a card taken at pick k
first appears in the deck at step k+1.

- Implementation: capture `deckSoFar.slice()` into the step **before** the loop
  that pushes the current pick's cards into `deckSoFar`.
- This does NOT change the "didn't wheel" computation. The order
  `handleDraftState` → capture `didntWheel` → `handlePickCard` is preserved, and a
  wheel result never contains the current booster's still-present cards regardless.
- The `replay.js` unit tests' `deckSoFar` assertions are updated to the new
  semantics: step0 `[]`, step1 `["Alpha"]`, step2 `["Alpha","Delta"]`.

## Change B — "Hide my pick" toggle + "Reveal pick" button (`viewer.js`, `viewer.html`, `viewer.css`)

- A **"Hide my pick"** checkbox in the replay header. Default **off** (current
  behavior: the picked card is highlighted).
- Viewer state gains `hidePick` (boolean, from the checkbox) and `revealed`
  (boolean, per current step). `revealed` resets to `false` on any navigation
  (prev/next) and whenever the checkbox is toggled.
- The booster's pick highlight (`.dmw-picked`) is applied to the picked card only
  when `!hidePick || revealed`.
- A **"Reveal pick"** button in the header, visible only when `hidePick` is on and
  the current step is not yet `revealed`. Clicking sets `revealed = true` and
  re-renders (highlighting the picked card) without advancing the step.
- Because Change A removes the current pick from `deckSoFar`, hiding the highlight
  fully conceals the choice until the user reveals it or advances to the next pick.

All new DOM ids/classes remain `dmw-` prefixed. No new modules; no manifest change.

## Testing

- `src/viewer/replay.js`: update the TDD unit tests to assert the new
  `deckSoFar`-excludes-current-pick semantics (and that `didntWheel` is unchanged).
- Viewer UI (`viewer.js`): manual verification plus the Puppeteer e2e harness —
  with "Hide my pick" on, the booster shows no highlight; "Reveal pick" lights up
  the taken card without advancing; the deck-so-far excludes the current pick;
  navigating resets the reveal.

## Out of scope (YAGNI)

- Persisting the toggle across sessions.
- Hiding/altering the "didn't wheel" panel (it concerns other players' picks, not
  yours, so it does not reveal your choice).
- Any change to the live "didn't wheel" content-script feature.
