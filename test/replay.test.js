const test = require("node:test");
const assert = require("node:assert");
const { buildReplay } = require("../src/viewer/replay.js");

// Pick 1: open {Alpha,Beta,Gamma}, take Alpha.
// Pick 2: a different pack {Delta,Epsilon}, take Delta (first pass, no wheel).
// Pick 3: original pack wheels back as {Beta} (Gamma was taken by someone else); take Beta.
const parsed = {
  player: "Me",
  players: ["Me", "Other"],
  picks: [
    { packNum: 1, pickNum: 1, cards: [{ name: "Alpha" }, { name: "Beta" }, { name: "Gamma" }], pickedIndices: [0] },
    { packNum: 1, pickNum: 2, cards: [{ name: "Delta" }, { name: "Epsilon" }], pickedIndices: [0] },
    { packNum: 1, pickNum: 3, cards: [{ name: "Beta" }], pickedIndices: [0] },
  ],
};

test("carries the player through", () => {
  assert.strictEqual(buildReplay(parsed).player, "Me");
});

test("first pass has didntWheel null and marks the picked card", () => {
  const { steps } = buildReplay(parsed);
  assert.strictEqual(steps[0].didntWheel, null);
  assert.deepStrictEqual(steps[0].cards.map((c) => c.picked), [true, false, false]);
});

test("deckSoFar reflects only picks made before the current pick", () => {
  const { steps } = buildReplay(parsed);
  assert.deepStrictEqual(steps[0].deckSoFar.map((c) => c.name), []); // nothing drafted entering pick 1
  assert.deepStrictEqual(steps[1].deckSoFar.map((c) => c.name), ["Alpha"]); // only pick 1's card
  assert.deepStrictEqual(steps[2].deckSoFar.map((c) => c.name), ["Alpha", "Delta"]); // picks 1 and 2
});

test("the wheel step reports the card others took, excluding your own picks", () => {
  const { steps } = buildReplay(parsed);
  // At pick 3 the pack (Alpha,Beta,Gamma) returns as {Beta}: Gamma didn't wheel;
  // Alpha is excluded as your own pick; Beta is still present.
  assert.deepStrictEqual(steps[2].didntWheel.map((c) => c.name), ["Gamma"]);
});

test("a common shared between two different first-lap packs does not trigger a false wheel", () => {
  const parsed = {
    player: "Me",
    players: ["Me", "Other"], // podSize 2 → pickNum 2 is still first-lap
    picks: [
      { packNum: 1, pickNum: 1, cards: [{ name: "Alpha" }, { name: "Common" }], pickedIndices: [0] },
      { packNum: 1, pickNum: 2, cards: [{ name: "Beta" }, { name: "Common" }], pickedIndices: [0] },
    ],
  };
  const { steps } = buildReplay(parsed);
  assert.strictEqual(steps[1].didntWheel, null); // different pack, shared "Common" must NOT be a wheel
});

test("uses real uniqueIDs when present (captured drafts), wheel without players", () => {
  // No `players` field; cards carry real uniqueIDs (as captured live).
  const parsed = {
    player: null,
    picks: [
      { packNum: 1, pickNum: 1, cards: [{ name: "A", uniqueID: 1 }, { name: "B", uniqueID: 2 }, { name: "C", uniqueID: 3 }], pickedIndices: [0] },
      { packNum: 1, pickNum: 2, cards: [{ name: "D", uniqueID: 4 }, { name: "E", uniqueID: 5 }], pickedIndices: [0] },
      { packNum: 1, pickNum: 3, cards: [{ name: "B", uniqueID: 2 }], pickedIndices: [0] }, // pack 1 returns; B same uniqueID
    ],
  };
  const { steps } = buildReplay(parsed);
  // At pick 3 the pack (A,B,C) returns as {B}: C didn't wheel; A excluded as own pick.
  assert.deepStrictEqual(steps[2].didntWheel.map((c) => c.name), ["C"]);
});

test("a burned card (captured) is excluded from didntWheel", () => {
  const parsed = {
    player: null,
    picks: [
      { packNum: 1, pickNum: 1, cards: [{ name: "A", uniqueID: 1 }, { name: "B", uniqueID: 2 }, { name: "C", uniqueID: 3 }, { name: "D", uniqueID: 4 }], pickedIndices: [0], burnedIndices: [1] },
      { packNum: 1, pickNum: 2, cards: [{ name: "E", uniqueID: 5 }, { name: "F", uniqueID: 6 }], pickedIndices: [0] },
      { packNum: 1, pickNum: 3, cards: [{ name: "C", uniqueID: 3 }], pickedIndices: [0] }, // pack 1 returns as {C}
    ],
  };
  const { steps } = buildReplay(parsed);
  // pack1 {A,B,C,D} returns as {C}: D didn't wheel; A is own pick; B is own BURN (excluded).
  assert.deepStrictEqual(steps[2].didntWheel.map((c) => c.name), ["D"]);
});

test("deckSoFar cards carry uniqueID when present (for maindeck filtering)", () => {
  const parsed = {
    player: null,
    picks: [
      { packNum: 1, pickNum: 1, cards: [{ name: "A", uniqueID: 7 }, { name: "B", uniqueID: 8 }], pickedIndices: [0] },
      { packNum: 1, pickNum: 2, cards: [{ name: "C", uniqueID: 9 }], pickedIndices: [0] },
    ],
  };
  const { steps } = buildReplay(parsed);
  assert.strictEqual(steps[1].deckSoFar[0].uniqueID, 7); // A, picked at step 0
});
