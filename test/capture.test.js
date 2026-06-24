const test = require("node:test");
const assert = require("node:assert");
const { createDraftCapture } = require("../src/capture.js");

const liveCard = (name, uniqueID, set, collector) => {
  const c = { name, uniqueID };
  if (set !== undefined) c.set = set;
  if (collector !== undefined) c.collector_number = collector;
  return c;
};

test("records a pick mapping live booster cards (collector_number -> collector, keeps uniqueID)", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [liveCard("Shock", 11, "m21", "159"), liveCard("Opt", 12)] });
  cap.onPickCard({ pickedCards: [0] });
  assert.deepStrictEqual(cap.getDraft(), {
    player: null,
    picks: [
      {
        packNum: 1,
        pickNum: 1,
        cards: [
          { name: "Shock", set: "m21", collector: "159", uniqueID: 11 },
          { name: "Opt", uniqueID: 12 },
        ],
        pickedIndices: [0],
      },
    ],
  });
});

test("omits empty set/collector", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [liveCard("Bear", 5, "", "")] });
  cap.onPickCard({ pickedCards: [0] });
  assert.deepStrictEqual(cap.getDraft().picks[0].cards[0], { name: "Bear", uniqueID: 5 });
});

test("accumulates multiple picks with pack/pick numbers", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [liveCard("A", 1)] });
  cap.onPickCard({ pickedCards: [0] });
  cap.onDraftState({ boosterNumber: 0, pickNumber: 1, booster: [liveCard("B", 2)] });
  cap.onPickCard({ pickedCards: [0] });
  cap.onDraftState({ boosterNumber: 1, pickNumber: 0, booster: [liveCard("C", 3)] });
  cap.onPickCard({ pickedCards: [0] });
  assert.deepStrictEqual(
    cap.getDraft().picks.map((p) => [p.packNum, p.pickNum, p.cards[0].name]),
    [[1, 1, "A"], [1, 2, "B"], [2, 1, "C"]]
  );
});

test("resets on a new draft (boosterNumber 0, pickNumber 0)", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [liveCard("A", 1)] });
  cap.onPickCard({ pickedCards: [0] });
  cap.onDraftState({ boosterNumber: 0, pickNumber: 1, booster: [liveCard("B", 2)] });
  cap.onPickCard({ pickedCards: [0] });
  // a brand-new draft starts
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [liveCard("Z", 9)] });
  cap.onPickCard({ pickedCards: [0] });
  assert.deepStrictEqual(cap.getDraft().picks.map((p) => p.cards[0].name), ["Z"]);
});

test("pack 2 pick 1 (boosterNumber 1, pickNumber 0) does NOT reset", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [liveCard("A", 1)] });
  cap.onPickCard({ pickedCards: [0] });
  cap.onDraftState({ boosterNumber: 1, pickNumber: 0, booster: [liveCard("B", 2)] });
  cap.onPickCard({ pickedCards: [0] });
  assert.strictEqual(cap.getDraft().picks.length, 2);
});

test("onPickCard before any booster is a safe no-op", () => {
  const cap = createDraftCapture();
  assert.deepStrictEqual(cap.onPickCard({ pickedCards: [0] }), { player: null, picks: [] });
});

test("ignores draftState with an empty/absent booster", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [] });
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0 });
  assert.deepStrictEqual(cap.getDraft(), { player: null, picks: [] });
});

test("records burnedIndices when burnedCards present, omits when absent", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [{ name: "A", uniqueID: 1 }, { name: "B", uniqueID: 2 }, { name: "C", uniqueID: 3 }] });
  cap.onPickCard({ pickedCards: [0], burnedCards: [1] });
  cap.onDraftState({ boosterNumber: 0, pickNumber: 1, booster: [{ name: "D", uniqueID: 4 }] });
  cap.onPickCard({ pickedCards: [0] }); // no burns
  const picks = cap.getDraft().picks;
  assert.deepStrictEqual(picks[0].pickedIndices, [0]);
  assert.deepStrictEqual(picks[0].burnedIndices, [1]);
  assert.strictEqual("burnedIndices" in picks[1], false);
});
