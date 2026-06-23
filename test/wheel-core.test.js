const test = require("node:test");
const assert = require("node:assert");
const { createWheelTracker } = require("../src/wheel-core.js");

const card = (uniqueID, name) => ({ uniqueID, name, image_uris: { en: name + ".jpg" } });

test("first booster of a round is not a wheel", () => {
  const t = createWheelTracker();
  const r = t.handleDraftState({
    boosterNumber: 0,
    pickNumber: 0,
    booster: [card(1, "A"), card(2, "B"), card(3, "C")],
  });
  assert.deepStrictEqual(r, { active: true, isWheel: false, boosterNumber: 0, pickNumber: 0 });
});

test("empty/absent booster yields inactive result", () => {
  const t = createWheelTracker();
  assert.deepStrictEqual(t.handleDraftState({ boosterNumber: 0, pickNumber: 0, booster: [] }), { active: false });
  assert.deepStrictEqual(t.handleDraftState({ boosterNumber: 0, pickNumber: 1 }), { active: false });
});

test("wheel reports cards others took, excluding your own pick", () => {
  const t = createWheelTracker();
  // First pass: see A,B,C,D at pick 0.
  t.handleDraftState({ boosterNumber: 0, pickNumber: 0, booster: [card(1, "A"), card(2, "B"), card(3, "C"), card(4, "D")] });
  // You pick index 0 (card A) and pass.
  t.handlePickCard({ pickedCards: [0] });
  // Pack wheels back at pick 4 with only B and D left (C was taken by someone else; A is yours).
  const r = t.handleDraftState({ boosterNumber: 0, pickNumber: 4, booster: [card(2, "B"), card(4, "D")] });
  assert.strictEqual(r.active, true);
  assert.strictEqual(r.isWheel, true);
  assert.strictEqual(r.boosterNumber, 0);
  assert.deepStrictEqual(r.didntWheel.map((c) => c.uniqueID), [3]); // only C; A excluded as own pick
  assert.strictEqual(r.didntWheel[0].name, "C");
});

test("burned cards are also excluded from didntWheel", () => {
  const t = createWheelTracker();
  t.handleDraftState({ boosterNumber: 0, pickNumber: 0, booster: [card(1, "A"), card(2, "B"), card(3, "C")] });
  t.handlePickCard({ pickedCards: [0], burnedCards: [1] }); // pick A, burn B
  const r = t.handleDraftState({ boosterNumber: 0, pickNumber: 3, booster: [card(3, "C")] });
  assert.deepStrictEqual(r.didntWheel.map((c) => c.uniqueID), []); // C still here, A+B are own pick/burn
  assert.strictEqual(r.isWheel, true);
});

test("a different boosterNumber never matches a prior round", () => {
  const t = createWheelTracker();
  t.handleDraftState({ boosterNumber: 0, pickNumber: 0, booster: [card(1, "A"), card(2, "B")] });
  const r = t.handleDraftState({ boosterNumber: 1, pickNumber: 0, booster: [card(10, "X"), card(11, "Y")] });
  assert.strictEqual(r.isWheel, false);
});

test("matches the most recent prior pass in a small pod (incremental)", () => {
  const t = createWheelTracker();
  // Pick 0: A,B,C,D,E
  t.handleDraftState({ boosterNumber: 0, pickNumber: 0, booster: [card(1,"A"),card(2,"B"),card(3,"C"),card(4,"D"),card(5,"E")] });
  t.handlePickCard({ pickedCards: [0] }); // take A
  // Pick 4 (second pass): B,C,D,E minus one taken -> B,C,E (D taken)
  t.handleDraftState({ boosterNumber: 0, pickNumber: 4, booster: [card(2,"B"),card(3,"C"),card(5,"E")] });
  t.handlePickCard({ pickedCards: [0] }); // take B
  // Pick 8 (third pass): C,E minus one -> C (E taken since last pass)
  const r = t.handleDraftState({ boosterNumber: 0, pickNumber: 8, booster: [card(3,"C")] });
  // Relative to the pick-4 snapshot: E didn't wheel (B excluded as own pick).
  assert.deepStrictEqual(r.didntWheel.map((c) => c.uniqueID), [5]);
});

test("handleRejoin seeds a snapshot without crashing and is treated as first pass", () => {
  const t = createWheelTracker();
  const r = t.handleRejoin({ boosterNumber: 0, pickNumber: 2, booster: [card(1, "A"), card(2, "B")] });
  assert.deepStrictEqual(r, { active: true, isWheel: false, boosterNumber: 0, pickNumber: 2 });
});

test("reset clears state", () => {
  const t = createWheelTracker();
  t.handleDraftState({ boosterNumber: 0, pickNumber: 0, booster: [card(1, "A")] });
  t.reset();
  const r = t.handleDraftState({ boosterNumber: 0, pickNumber: 4, booster: [card(1, "A")] });
  assert.strictEqual(r.isWheel, false); // prior snapshot was cleared
});
