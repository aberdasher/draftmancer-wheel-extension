const test = require("node:test");
const assert = require("node:assert");
const { manaReportLines } = require("../src/viewer/mana-report.js");

const L = (name, typeLine, producedMana, oracleText) => ({ name, typeLine, producedMana: producedMana || [], oracleText: oracleText || "" });

test("manaReportLines: rows with shortfalls plus pool-aware fetch line", () => {
  const enriched = [
    L("Hallowed Fountain", "Land — Plains Island", ["W", "U"], "({T}: Add {W} or {U}.)"),
    L("Arid Mesa", "Land", [], "Search your library for a Mountain or Plains card, put it onto the battlefield, then shuffle."),
  ];
  const deckStats = { sources: { W: { max: 11 }, U: { max: 6 } } };
  assert.deepStrictEqual(manaReportLines(enriched, deckStats), {
    lands: 2,
    lines: [
      "W: 2 / 11  ⚠ short 9",
      "U: 2 / 6  ⚠ short 4",
      "R: 1 / 0",
      "fetches:",
      "Arid Mesa → W U R",
    ],
  });
});

test("manaReportLines: empty maindeck → lands 0, em dash, no fetches", () => {
  assert.deepStrictEqual(manaReportLines([], { sources: {} }), { lands: 0, lines: ["—"] });
});
