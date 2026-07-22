const test = require("node:test");
const assert = require("node:assert");
const TR = require("../src/viewer/table-read.js");

const pk = (pack, pick, name, colors, rating, extra = {}) =>
  ({ pack, pick, name, colors, rating, cmc: 0, type: "", img: "", ...extra });

const SEAT = {
  name: "PDunny",
  picks: [
    pk(0, 0, "Minsc & Boo", ["R", "G"], 2.97),
    pk(0, 1, "Arid Mesa", [], 2.43),
    pk(0, 2, "Displacer Kitten", ["U"], 2.04),
    pk(1, 0, "Bloodghast", ["B"], 1.5),
  ],
};

test("picksThrough is inclusive and lexicographic on (pack,pick)", () => {
  assert.deepStrictEqual(TR.picksThrough(SEAT.picks, 0, 1).map((c) => c.name),
    ["Minsc & Boo", "Arid Mesa"]);
  assert.strictEqual(TR.picksThrough(SEAT.picks, 1, 0).length, 4); // includes P2p1
  assert.strictEqual(TR.picksThrough(SEAT.picks, 0, 0).length, 1);
});

test("colorCounts tallies WUBRG across picked cards; colorless/lands add nothing", () => {
  const c = TR.colorCounts(TR.picksThrough(SEAT.picks, 0, 2));
  assert.deepStrictEqual(c, { W: 0, U: 1, B: 0, R: 1, G: 1 }); // Arid Mesa (colors []) adds nothing
});

test("keyCards returns top-n by rating desc, stable by name", () => {
  const k = TR.keyCards(SEAT.picks, 2).map((c) => c.name);
  assert.deepStrictEqual(k, ["Minsc & Boo", "Arid Mesa"]);
});

test("seatStateThrough composes name + counts + keyCards + pool", () => {
  const s = TR.seatStateThrough(SEAT, 0, 1, 3);
  assert.strictEqual(s.name, "PDunny");
  assert.deepStrictEqual(s.colorCounts, { W: 0, U: 0, B: 0, R: 1, G: 1 });
  assert.strictEqual(s.pool.length, 2);
  assert.strictEqual(s.keyCards[0].name, "Minsc & Boo");
});

test("empty pool is handled", () => {
  const s = TR.seatStateThrough({ name: "x", picks: [] }, 0, 0, 3);
  assert.deepStrictEqual(s.colorCounts, { W: 0, U: 0, B: 0, R: 0, G: 0 });
  assert.deepStrictEqual(s.keyCards, []);
});
