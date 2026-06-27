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

test("tracks sideboard via moveCard / moveAll / swap and includes it only when non-empty", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [{ name: "A", uniqueID: 1 }, { name: "B", uniqueID: 2 }] });
  cap.onPickCard({ pickedCards: [0] }); // pick A(1)
  cap.onDraftState({ boosterNumber: 0, pickNumber: 1, booster: [{ name: "C", uniqueID: 3 }] });
  cap.onPickCard({ pickedCards: [0] }); // pick C(3)
  assert.strictEqual("sideboard" in cap.getDraft(), false); // none yet

  cap.onMoveCard(1, "side");
  assert.deepStrictEqual(cap.getDraft().sideboard, [1]);
  cap.onMoveCard(1, "main");
  assert.strictEqual("sideboard" in cap.getDraft(), false);

  cap.onMoveAllToSideboard(); // all picked -> side
  assert.deepStrictEqual(cap.getDraft().sideboard.slice().sort(), [1, 3]);
  cap.onSwapDeckAndSideboard(); // complement of {1,3} among picked {1,3} = empty
  assert.strictEqual("sideboard" in cap.getDraft(), false);
});

test("a new draft (0/0) clears the sideboard", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [{ name: "A", uniqueID: 1 }] });
  cap.onPickCard({ pickedCards: [0] });
  cap.onMoveCard(1, "side");
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [{ name: "Z", uniqueID: 9 }] }); // new draft
  assert.strictEqual("sideboard" in cap.getDraft(), false);
});

test("onRejoinZones seeds the sideboard from pickedCards.side", () => {
  const cap = createDraftCapture();
  cap.onRejoinZones({ main: [{ uniqueID: 1 }], side: [{ uniqueID: 2 }, { uniqueID: 3 }] });
  assert.deepStrictEqual(cap.getDraft().sideboard.slice().sort(), [2, 3]);
});

test("getMaindeckCards: picked cards minus sideboard", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [{ name: "A", uniqueID: 1 }, { name: "B", uniqueID: 2 }] });
  cap.onPickCard({ pickedCards: [0] }); // A(1)
  cap.onDraftState({ boosterNumber: 0, pickNumber: 1, booster: [{ name: "C", uniqueID: 3 }] });
  cap.onPickCard({ pickedCards: [0] }); // C(3)
  cap.onMoveCard(3, "side"); // C -> sideboard
  assert.deepStrictEqual(cap.getMaindeckCards(), [{ name: "A", uniqueID: 1 }]);
});

test("getMaindeckCards: empty sideboard returns all picked", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [{ name: "A", uniqueID: 1, set: "m21", collector_number: "1" }] });
  cap.onPickCard({ pickedCards: [0] });
  assert.deepStrictEqual(cap.getMaindeckCards(), [{ name: "A", set: "m21", collector: "1", uniqueID: 1 }]);
});

test("getMaindeckCards: after moveAllToSideboard is empty", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [{ name: "A", uniqueID: 1 }] });
  cap.onPickCard({ pickedCards: [0] });
  cap.onMoveAllToSideboard();
  assert.deepStrictEqual(cap.getMaindeckCards(), []);
});

test("getMaindeckCards: excludes burned cards, reflects rejoin sideboard", () => {
  const cap = createDraftCapture();
  cap.onDraftState({ boosterNumber: 0, pickNumber: 0, booster: [{ name: "A", uniqueID: 1 }, { name: "B", uniqueID: 2 }, { name: "C", uniqueID: 3 }] });
  cap.onPickCard({ pickedCards: [0], burnedCards: [1] }); // pick A, burn B
  cap.onRejoinZones({ main: [{ uniqueID: 1 }], side: [] });
  assert.deepStrictEqual(cap.getMaindeckCards(), [{ name: "A", uniqueID: 1 }]);
});

test("getMaindeckCards: excludes picked cards whose uniqueID is missing or non-numeric", () => {
  const cap = createDraftCapture();
  // booster has one card with a valid numeric uniqueID and one with a string uniqueID
  cap.onDraftState({
    boosterNumber: 0, pickNumber: 0,
    booster: [{ name: "Shock", uniqueID: 11 }, { name: "Opt", uniqueID: "bad-id" }],
  });
  cap.onPickCard({ pickedCards: [0, 1] }); // pick both
  // only the numeric-uniqueID card should appear in the maindeck
  assert.deepStrictEqual(cap.getMaindeckCards(), [{ name: "Shock", uniqueID: 11 }]);
});
