const test = require("node:test");
const assert = require("node:assert");
const { fetchTargets } = require("../src/viewer/mana-sources.js");

const sortedTypes = (r) => [...r.types].sort();

test("fetchTargets: 'a Mountain or Plains card' → named types, not basics-only", () => {
  const r = fetchTargets("{T}, Pay 1 life, Sacrifice this land: Search your library for a Mountain or Plains card, put it onto the battlefield, then shuffle.");
  assert.deepStrictEqual(sortedTypes(r), ["Mountain", "Plains"]);
  assert.strictEqual(r.basicsOnly, false);
});

test("fetchTargets: 'a basic land card' → all five types, basics-only", () => {
  const r = fetchTargets("{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.");
  assert.deepStrictEqual(sortedTypes(r), ["Forest", "Island", "Mountain", "Plains", "Swamp"]);
  assert.strictEqual(r.basicsOnly, true);
});

test("fetchTargets: 'a basic Mountain' → Mountain only, basics-only", () => {
  const r = fetchTargets("Search your library for a basic Mountain card, put it onto the battlefield, then shuffle.");
  assert.deepStrictEqual(sortedTypes(r), ["Mountain"]);
  assert.strictEqual(r.basicsOnly, true);
});

test("fetchTargets: two-type ramp search is not basics-only", () => {
  const r = fetchTargets("{2}, {T}, Sacrifice this land: Search your library for a Forest card and a Plains card, put them onto the battlefield tapped, then shuffle.");
  assert.deepStrictEqual(sortedTypes(r), ["Forest", "Plains"]);
  assert.strictEqual(r.basicsOnly, false);
});

test("fetchTargets: non-fetch text → empty", () => {
  const r = fetchTargets("({T}: Add {W} or {U}.)");
  assert.strictEqual(r.types.size, 0);
  assert.strictEqual(r.basicsOnly, false);
});

const { landColors } = require("../src/viewer/mana-sources.js");

const sortedColors = (set) => [...set].sort();
const L = (name, typeLine, producedMana, oracleText) => ({ name, typeLine, producedMana: producedMana || [], oracleText: oracleText || "" });

const FOREST = L("Forest", "Basic Land — Forest", ["G"]);
const HALLOWED = L("Hallowed Fountain", "Land — Plains Island", ["W", "U"], "({T}: Add {W} or {U}.)");
const BRUSHLAND = L("Brushland", "Land", ["C", "G", "W"], "{T}: Add {C}. / {T}: Add {G} or {W}.");
const ARID_MESA = L("Arid Mesa", "Land", [], "Search your library for a Mountain or Plains card, put it onto the battlefield, then shuffle.");
const EVOLVING = L("Evolving Wilds", "Land", [], "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.");
const KROSAN = L("Krosan Verge", "Land", ["C"], "{T}: Add {C}. / {2}, {T}, Sacrifice this land: Search your library for a Forest card and a Plains card, put them onto the battlefield tapped, then shuffle.");

test("landColors: basic → its color", () => {
  assert.deepStrictEqual(sortedColors(landColors(FOREST, [FOREST])), ["G"]);
});

test("landColors: dual → both colors", () => {
  assert.deepStrictEqual(sortedColors(landColors(HALLOWED, [HALLOWED])), ["U", "W"]);
});

test("landColors: painland drops colorless C", () => {
  assert.deepStrictEqual(sortedColors(landColors(BRUSHLAND, [BRUSHLAND])), ["G", "W"]);
});

test("landColors: nonbasic fetch alone → named-type base colors", () => {
  assert.deepStrictEqual(sortedColors(landColors(ARID_MESA, [ARID_MESA])), ["R", "W"]);
});

test("landColors: nonbasic fetch extends off a pool dual (Arid Mesa + Hallowed Fountain → R W U)", () => {
  const pool = [ARID_MESA, HALLOWED];
  assert.deepStrictEqual(sortedColors(landColors(ARID_MESA, pool)), ["R", "U", "W"]);
});

test("landColors: basics-only fetch does NOT extend off pool duals", () => {
  const pool = [EVOLVING, HALLOWED];
  assert.deepStrictEqual(sortedColors(landColors(EVOLVING, pool)), ["B", "G", "R", "U", "W"]);
});

test("landColors: ramp search (Krosan Verge) → named base colors, C ignored", () => {
  assert.deepStrictEqual(sortedColors(landColors(KROSAN, [KROSAN])), ["G", "W"]);
});

test("landColors: colorless-only utility land → empty", () => {
  const wastes = L("Wastes", "Basic Land", ["C"], "{T}: Add {C}.");
  assert.deepStrictEqual(sortedColors(landColors(wastes, [wastes])), []);
});

const { computeManaBase } = require("../src/viewer/mana-sources.js");

test("computeManaBase: counts sources, counts duplicates, totals lands", () => {
  const pool = [
    L("Forest", "Basic Land — Forest", ["G"]),
    L("Forest", "Basic Land — Forest", ["G"]),
    HALLOWED,
    L("Lightning Bolt", "Instant", [], ""), // non-land, ignored
  ];
  const mb = computeManaBase(pool);
  assert.strictEqual(mb.lands, 3);
  assert.strictEqual(mb.counts.G, 2);
  assert.strictEqual(mb.counts.W, 1);
  assert.strictEqual(mb.counts.U, 1);
  assert.strictEqual(mb.counts.B, 0);
});

test("computeManaBase: lists fetches with their reachable colors (pool-aware)", () => {
  const mb = computeManaBase([ARID_MESA, HALLOWED]);
  assert.deepStrictEqual(mb.fetches, [{ name: "Arid Mesa", colors: ["W", "U", "R"] }]);
  // Arid Mesa counts toward R, W, and (via Hallowed Fountain) U
  assert.strictEqual(mb.counts.R, 1);
  assert.strictEqual(mb.counts.W, 2); // Hallowed Fountain + Arid Mesa
  assert.strictEqual(mb.counts.U, 2); // Hallowed Fountain + Arid Mesa
});

const { compareToDemand } = require("../src/viewer/mana-sources.js");

test("compareToDemand: rows over the supply∪demand union with shortfalls", () => {
  const manaBase = { counts: { W: 6, U: 3, B: 0, R: 1, G: 0 }, lands: 9, fetches: [] };
  const deckStats = { sources: { W: { max: 11 }, U: { max: 6 }, R: { max: 1 } } };
  assert.deepStrictEqual(compareToDemand(manaBase, deckStats), [
    { color: "W", have: 6, need: 11, short: 5 },
    { color: "U", have: 3, need: 6, short: 3 },
    { color: "R", have: 1, need: 1, short: 0 },
  ]);
});

test("compareToDemand: supply with no demand shows need 0, no shortfall; skips empty colors", () => {
  const manaBase = { counts: { W: 0, U: 0, B: 2, R: 0, G: 0 }, lands: 2, fetches: [] };
  const deckStats = { sources: {} };
  assert.deepStrictEqual(compareToDemand(manaBase, deckStats), [
    { color: "B", have: 2, need: 0, short: 0 },
  ]);
});

test("compareToDemand: demand with no supply is fully short", () => {
  const manaBase = { counts: { W: 0, U: 0, B: 0, R: 0, G: 0 }, lands: 0, fetches: [] };
  const deckStats = { sources: { U: { max: 6 } } };
  assert.deepStrictEqual(compareToDemand(manaBase, deckStats), [
    { color: "U", have: 0, need: 6, short: 6 },
  ]);
});
