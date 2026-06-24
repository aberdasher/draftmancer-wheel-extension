const test = require("node:test");
const assert = require("node:assert");
const { isCreature, splitByCreature, columnize } = require("../src/viewer/deck-layout.js");

const card = (name, cmc, colors, typeLine) => ({ name, cmc, colors, typeLine });

test("isCreature matches Creature type lines (incl. compound), else false", () => {
  assert.strictEqual(isCreature(card("Elf", 1, ["G"], "Creature — Elf")), true);
  assert.strictEqual(isCreature(card("Golem", 4, [], "Artifact Creature — Golem")), true);
  assert.strictEqual(isCreature(card("Bolt", 1, ["R"], "Instant")), false);
  assert.strictEqual(isCreature(card("Forest", 0, [], "Basic Land — Forest")), false);
  assert.strictEqual(isCreature({ name: "Mystery" }), false); // no typeLine
});

test("splitByCreature partitions preserving order", () => {
  const cards = [
    card("Elf", 1, ["G"], "Creature — Elf"),
    card("Bolt", 1, ["R"], "Instant"),
    card("Bear", 2, ["G"], "Creature — Bear"),
  ];
  const { creatures, others } = splitByCreature(cards);
  assert.deepStrictEqual(creatures.map((c) => c.name), ["Elf", "Bear"]);
  assert.deepStrictEqual(others.map((c) => c.name), ["Bolt"]);
});

test("columnize by cmc buckets into 0..6+ with all fixed columns present", () => {
  const cards = [
    card("Opt", 1, ["U"], "Instant"),
    card("Bear", 2, ["G"], "Creature"),
    card("Wrath", 4, ["W"], "Sorcery"),
    card("Dragon", 6, ["R"], "Creature"),
    card("Titan", 7, ["G"], "Creature"),
    card("Mox", 0, [], "Artifact"),
  ];
  const cols = columnize(cards, "cmc");
  assert.deepStrictEqual(cols.map((c) => c.label), ["0", "1", "2", "3", "4", "5", "6+"]);
  assert.deepStrictEqual(cols.find((c) => c.label === "0").cards.map((c) => c.name), ["Mox"]);
  assert.deepStrictEqual(cols.find((c) => c.label === "6+").cards.map((c) => c.name), ["Dragon", "Titan"]); // cmc 6 then 7
  assert.deepStrictEqual(cols.find((c) => c.label === "5").cards, []); // empty column present
});

test("columnize by cmc treats missing cmc as 0", () => {
  const cols = columnize([{ name: "X", colors: [], typeLine: "Instant" }], "cmc");
  assert.deepStrictEqual(cols.find((c) => c.label === "0").cards.map((c) => c.name), ["X"]);
});

test("columnize by color buckets mono/multi/colorless with all fixed columns", () => {
  const cards = [
    card("Plains guy", 2, ["W"], "Creature"),
    card("Merfolk", 1, ["U"], "Creature"),
    card("Hybrid", 3, ["W", "U"], "Creature"),
    card("Golem", 4, [], "Artifact Creature"),
  ];
  const cols = columnize(cards, "color");
  assert.deepStrictEqual(cols.map((c) => c.label), ["W", "U", "B", "R", "G", "Multi", "Colorless"]);
  assert.deepStrictEqual(cols.find((c) => c.label === "W").cards.map((c) => c.name), ["Plains guy"]);
  assert.deepStrictEqual(cols.find((c) => c.label === "Multi").cards.map((c) => c.name), ["Hybrid"]);
  assert.deepStrictEqual(cols.find((c) => c.label === "Colorless").cards.map((c) => c.name), ["Golem"]);
});

test("cards within a column are sorted by cmc then name", () => {
  const cards = [
    card("Zebra", 2, ["G"], "Creature"),
    card("Apple", 2, ["G"], "Creature"),
    card("Ant", 1, ["G"], "Creature"),
  ];
  const col = columnize(cards, "color").find((c) => c.label === "G");
  assert.deepStrictEqual(col.cards.map((c) => c.name), ["Ant", "Apple", "Zebra"]); // cmc1 first, then cmc2 by name
});
