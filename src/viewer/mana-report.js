// Pure presentation helper: turns an enriched maindeck + DeckStats result into
// the display lines for the "mana base" block. Shared by the replay viewer and
// the live sidebar so both render identically. Depends on ManaSources (loaded
// before this file in the browser; require()'d in node).
const MS = typeof require === "function" ? require("./mana-sources.js") : globalThis.ManaSources;

function manaReportLines(maindeckEnriched, deckStats) {
  const mb = MS.computeManaBase(maindeckEnriched);
  const rows = MS.compareToDemand(mb, deckStats);
  const rowLine = (r) => {
    let status = "";
    if (r.short > 0) status = `  ⚠ short ${r.short}`;
    else if (r.need > 0) status = "  ok";
    return `${r.color}: ${r.have} / ${r.need}${status}`;
  };
  const rowLines = rows.length ? rows.map(rowLine) : ["—"];
  const fetchLines = mb.fetches.map((f) => `${f.name} → ${f.colors.join(" ") || "—"}`);
  const lines = fetchLines.length ? rowLines.concat("fetches:", fetchLines) : rowLines;
  return { lands: mb.lands, lines };
}

const ManaReport = { manaReportLines };
if (typeof module !== "undefined" && module.exports) module.exports = ManaReport;
if (typeof globalThis !== "undefined") globalThis.ManaReport = ManaReport;
