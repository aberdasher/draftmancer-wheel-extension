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
