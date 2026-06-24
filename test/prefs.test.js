const test = require("node:test");
const assert = require("node:assert");
const { DEFAULTS, mergePrefs } = require("../src/viewer/prefs.js");

test("DEFAULTS has the expected first-run values", () => {
  assert.deepStrictEqual(DEFAULTS, { hidePick: true, deckSort: "cmc", splitCreatures: false });
});

test("mergePrefs returns defaults for null/empty/non-object stored", () => {
  assert.deepStrictEqual(mergePrefs(null), DEFAULTS);
  assert.deepStrictEqual(mergePrefs(undefined), DEFAULTS);
  assert.deepStrictEqual(mergePrefs({}), DEFAULTS);
  assert.deepStrictEqual(mergePrefs("nope"), DEFAULTS);
});

test("mergePrefs returns a new object, not the DEFAULTS reference", () => {
  const r = mergePrefs(null);
  assert.notStrictEqual(r, DEFAULTS);
  r.hidePick = false;
  assert.strictEqual(DEFAULTS.hidePick, true); // DEFAULTS not mutated
});

test("mergePrefs applies a partial valid override, keeping the rest default", () => {
  assert.deepStrictEqual(mergePrefs({ hidePick: false }), { hidePick: false, deckSort: "cmc", splitCreatures: false });
  assert.deepStrictEqual(mergePrefs({ deckSort: "color" }), { hidePick: true, deckSort: "color", splitCreatures: false });
  assert.deepStrictEqual(mergePrefs({ splitCreatures: true }), { hidePick: true, deckSort: "cmc", splitCreatures: true });
});

test("mergePrefs rejects invalid types/values in favor of defaults", () => {
  assert.deepStrictEqual(
    mergePrefs({ hidePick: "yes", deckSort: "rarity", splitCreatures: 1 }),
    DEFAULTS
  );
});

test("mergePrefs ignores unknown keys", () => {
  const r = mergePrefs({ foo: 123, deckSort: "color" });
  assert.deepStrictEqual(r, { hidePick: true, deckSort: "color", splitCreatures: false });
  assert.strictEqual("foo" in r, false);
});

test("mergePrefs applies a fully valid stored object", () => {
  assert.deepStrictEqual(
    mergePrefs({ hidePick: false, deckSort: "color", splitCreatures: true }),
    { hidePick: false, deckSort: "color", splitCreatures: true }
  );
});
