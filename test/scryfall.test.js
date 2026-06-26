const test = require("node:test");
const assert = require("node:assert");
const Scryfall = require("../src/viewer/scryfall.js");
const { buildIdentifiers, chunk, toCardData, fetchCardData } = Scryfall;

test("buildIdentifiers dedupes by name and prefers set+collector", () => {
  const ids = buildIdentifiers([
    { name: "Shock" },
    { name: "Opt", set: "IKO", collector: "55" },
    { name: "Shock" },
  ]);
  assert.deepStrictEqual(ids, [{ name: "Shock" }, { set: "iko", collector_number: "55" }]);
});

test("chunk splits into batches of the given size", () => {
  assert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("toCardData reads image_uris, falling back to the first face", () => {
  assert.deepStrictEqual(
    toCardData({ name: "A", cmc: 3, image_uris: { normal: "a.jpg" }, type_line: "Creature", colors: ["G"] }),
    { name: "A", imageUrl: "a.jpg", cmc: 3, colors: ["G"], typeLine: "Creature", manaCost: "", producedMana: [], oracleText: "" }
  );
  const dfc = toCardData({
    name: "B // C",
    cmc: 2,
    card_faces: [{ image_uris: { normal: "b.jpg" }, colors: ["U"] }],
    type_line: "Sorcery",
  });
  assert.strictEqual(dfc.imageUrl, "b.jpg");
  assert.deepStrictEqual(dfc.colors, ["U"]);
});

test("toCardData reads produced_mana and oracle_text, falling back to the first face", () => {
  const land = toCardData({
    name: "Hallowed Fountain",
    type_line: "Land — Plains Island",
    produced_mana: ["W", "U"],
    oracle_text: "({T}: Add {W} or {U}.)",
  });
  assert.deepStrictEqual(land.producedMana, ["W", "U"]);
  assert.match(land.oracleText, /Add \{W\}/);

  // Real modal-DFC lands carry produced_mana at the TOP level (oracle_text is
  // per-face), so top-level wins:
  const mdfc = toCardData({
    name: "Sea Gate Restoration // Sea Gate, Reborn",
    type_line: "Sorcery // Land",
    produced_mana: ["U"],
    card_faces: [{ oracle_text: "Draw cards." }, { oracle_text: "{T}: Add {U}." }],
  });
  assert.deepStrictEqual(mdfc.producedMana, ["U"]);

  // When the top level lacks these, fall back to the first face:
  const faceFallback = toCardData({
    name: "Facey",
    type_line: "Land",
    card_faces: [{ produced_mana: ["G"], oracle_text: "{T}: Add {G}." }],
  });
  assert.deepStrictEqual(faceFallback.producedMana, ["G"]);
  assert.strictEqual(faceFallback.oracleText, "{T}: Add {G}.");
});

test("toCardData defaults a missing cmc to 0 and missing image to empty string", () => {
  const d = toCardData({ name: "X" });
  assert.strictEqual(d.cmc, 0);
  assert.strictEqual(d.imageUrl, "");
});

test("fetchCardData POSTs identifiers and returns a map keyed by lowercased name", async () => {
  const calls = [];
  const stubFetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    const data = JSON.parse(opts.body).identifiers.map((id) => ({
      name: id.name,
      cmc: 1,
      image_uris: { normal: id.name + ".jpg" },
      type_line: "Instant",
      colors: [],
    }));
    return { ok: true, json: async () => ({ data, not_found: [] }) };
  };
  const map = await fetchCardData([{ name: "Shock" }, { name: "Opt" }], stubFetch);
  assert.strictEqual(calls[0].url, "https://api.scryfall.com/cards/collection");
  assert.deepStrictEqual(calls[0].body.identifiers, [{ name: "Shock" }, { name: "Opt" }]);
  assert.strictEqual(map.get("shock").imageUrl, "Shock.jpg");
  assert.strictEqual(map.get("opt").cmc, 1);
});

test("fetchCardData throws on a non-ok response", async () => {
  const stubFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(() => fetchCardData([{ name: "Shock" }], stubFetch), /503/);
});

test("returns partial results when one batch fails but another succeeds", async () => {
  const cards = Array.from({ length: 76 }, (_, i) => ({ name: "Card" + i }));
  let call = 0;
  const stubFetch = async (url, opts) => {
    call++;
    if (call === 1) return { ok: false, status: 503, json: async () => ({}) }; // first 75-card batch fails
    const data = JSON.parse(opts.body).identifiers.map((id) => ({
      name: id.name, cmc: 1, image_uris: { normal: id.name + ".jpg" }, type_line: "Instant", colors: [],
    }));
    return { ok: true, json: async () => ({ data, not_found: [] }) };
  };
  const map = await fetchCardData(cards, stubFetch);
  assert.strictEqual(map.size, 1);        // only the second (1-card) batch succeeded
  assert.strictEqual(map.has("card75"), true);
});

test("filterUnknown returns only cards whose lowercased name is not in known", () => {
  const known = new Set(["shock"]);
  const out = Scryfall.filterUnknown([{ name: "Shock" }, { name: "Opt" }, { name: "shock" }], known);
  assert.deepStrictEqual(out.map((c) => c.name), ["Opt"]);
});

test("filterUnknown works with a Map keyed by lowercased name", () => {
  const known = new Map([["opt", { name: "Opt" }]]);
  const out = Scryfall.filterUnknown([{ name: "Opt" }, { name: "Bolt" }], known);
  assert.deepStrictEqual(out.map((c) => c.name), ["Bolt"]);
});

test("toCardData includes manaCost from mana_cost or the first face", () => {
  assert.strictEqual(toCardData({ name: "A", mana_cost: "{1}{W}" }).manaCost, "{1}{W}");
  assert.strictEqual(
    toCardData({ name: "B // C", card_faces: [{ mana_cost: "{U}", image_uris: { normal: "b.jpg" } }] }).manaCost,
    "{U}"
  );
  assert.strictEqual(toCardData({ name: "X" }).manaCost, "");
});
