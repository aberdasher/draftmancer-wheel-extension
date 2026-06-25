const test = require("node:test");
const assert = require("node:assert");
const { computeStats } = require("../src/viewer/deck-stats.js");

const card = (name, cmc, manaCost, typeLine) => ({ name, cmc, manaCost, typeLine, colors: [] });

test("counts creatures / spells / lands and total", () => {
  const s = computeStats([
    card("Elf", 1, "{G}", "Creature — Elf"),
    card("Bolt", 1, "{R}", "Instant"),
    card("Forest", 0, "", "Basic Land — Forest"),
    card("Golem", 4, "{4}", "Artifact Creature — Golem"),
  ]);
  assert.deepStrictEqual([s.total, s.creatures, s.spells, s.lands], [4, 2, 1, 1]);
});

test("type breakdown uses precedence (Creature > Land > … > Artifact)", () => {
  const s = computeStats([
    card("Golem", 4, "{4}", "Artifact Creature — Golem"), // Creature
    card("Manland", 3, "", "Creature Land"), // Creature (creature beats land)
    card("Signet", 2, "{2}", "Artifact"), // Artifact
    card("Wrath", 4, "{2}{W}{W}", "Sorcery"), // Sorcery
  ]);
  assert.strictEqual(s.types.Creature, 2);
  assert.strictEqual(s.types.Artifact, 1);
  assert.strictEqual(s.types.Sorcery, 1);
});

test("color pips count symbols including hybrid, across costs", () => {
  const s = computeStats([
    card("WW", 2, "{1}{W}{W}", "Sorcery"),
    card("Hybrid", 2, "{W/U}", "Instant"),
  ]);
  assert.strictEqual(s.pips.W, 3); // 2 + 1
  assert.strictEqual(s.pips.U, 1); // hybrid
});

test("sources: max per color (Karsten 40-card) + top 3, lands excluded", () => {
  const s = computeStats([
    card("Wrath", 4, "{2}{W}{W}", "Sorcery"), // pips 2, cmc 4 -> 11
    card("Bear", 2, "{1}{W}", "Creature"), // pips 1, cmc 2 -> 9
    card("Angel", 5, "{3}{W}{W}", "Creature"), // pips 2, cmc 5 -> 10
    card("Plains", 0, "", "Basic Land — Plains"), // land excluded
  ]);
  assert.strictEqual(s.sources.W.max, 11); // Wrath is most demanding
  assert.deepStrictEqual(s.sources.W.top.map((t) => [t.name, t.sources]), [
    ["Wrath", 11],
    ["Angel", 10],
    ["Bear", 9],
  ]);
});

test("a gold card counts toward both colors' source requirements", () => {
  const s = computeStats([card("Gold", 2, "{W}{U}", "Creature")]); // pips 1 each, cmc 2 -> 9 each
  assert.strictEqual(s.sources.W.max, 9);
  assert.strictEqual(s.sources.U.max, 9);
});

test("source lookup clamps out-of-range cmc to the row range", () => {
  // pips 1, cmc 9 -> clamp to cmc 6 -> 6
  const s = computeStats([card("Big", 9, "{8}{W}", "Sorcery")]);
  assert.strictEqual(s.sources.W.max, 6);
});

test("empty deck yields zeros and no source colors", () => {
  const s = computeStats([]);
  assert.deepStrictEqual([s.total, s.creatures, s.spells, s.lands], [0, 0, 0, 0]);
  assert.deepStrictEqual(s.sources, {});
});
