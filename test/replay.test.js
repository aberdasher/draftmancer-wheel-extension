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
