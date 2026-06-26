const test = require("node:test");
const assert = require("node:assert");
const manifest = require("../manifest.json");

test("sidebar bundle loads analysis modules before content.js", () => {
  const js = manifest.content_scripts[1].js;
  const need = [
    "src/viewer/scryfall.js",
    "src/viewer/deck-stats.js",
    "src/viewer/mana-sources.js",
    "src/viewer/mana-report.js",
  ];
  const contentIdx = js.indexOf("src/content.js");
  assert.ok(contentIdx >= 0, "content.js present in sidebar bundle");
  for (const m of need) {
    assert.ok(js.includes(m), `${m} missing from sidebar bundle`);
    assert.ok(js.indexOf(m) < contentIdx, `${m} must load before content.js`);
  }
});
