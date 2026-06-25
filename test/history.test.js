const test = require("node:test");
const assert = require("node:assert");
const { upsertCurrent, findById } = require("../src/history.js");

const d = (id, picks = 1) => ({ draftId: id, capturedAt: id, player: null, picks: Array(picks).fill({ name: "X", uniqueID: id }) });

test("upsertCurrent prepends a new draft (different draftId) and trims to cap", () => {
  let list = [];
  list = upsertCurrent(list, d(1));
  list = upsertCurrent(list, d(2));
  list = upsertCurrent(list, d(3));
  list = upsertCurrent(list, d(4)); // 4 distinct drafts, cap 3
  assert.deepStrictEqual(list.map((x) => x.draftId), [4, 3, 2]); // newest first, oldest (1) dropped
});

test("upsertCurrent updates the current draft in place when draftId matches front", () => {
  let list = upsertCurrent([], d(1, 1));
  list = upsertCurrent(list, d(1, 5)); // same draftId, more picks
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].picks.length, 5);
});

test("upsertCurrent keeps older entries when updating the current one", () => {
  let list = upsertCurrent(upsertCurrent([], d(1)), d(2, 1)); // [2,1]
  list = upsertCurrent(list, d(2, 3)); // update front (2)
  assert.deepStrictEqual(list.map((x) => x.draftId), [2, 1]);
  assert.strictEqual(list[0].picks.length, 3);
});

test("upsertCurrent dedupes a same-draftId entry that is not at the front", () => {
  const list = [d(2), d(1), d(3)]; // 1 appears in the middle
  const out = upsertCurrent(list, d(1, 9)); // re-surface draft 1
  assert.deepStrictEqual(out.map((x) => x.draftId), [1, 2, 3]);
  assert.strictEqual(out[0].picks.length, 9);
});

test("upsertCurrent tolerates a non-array list and does not mutate input", () => {
  assert.deepStrictEqual(upsertCurrent(undefined, d(1)).map((x) => x.draftId), [1]);
  const input = [d(2)];
  upsertCurrent(input, d(3));
  assert.deepStrictEqual(input.map((x) => x.draftId), [2]); // input unchanged
});

test("findById returns the matching draft or undefined", () => {
  const list = [d(2), d(1)];
  assert.strictEqual(findById(list, 1).draftId, 1);
  assert.strictEqual(findById(list, 9), undefined);
  assert.strictEqual(findById(undefined, 1), undefined);
});
