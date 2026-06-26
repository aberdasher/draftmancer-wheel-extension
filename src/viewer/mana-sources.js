// Pure mana-base (supply) analysis over enriched land cards
// { name, typeLine, producedMana, oracleText }. No chrome, DOM, fetch, or Date.
// Named WUBRG (not COLORS) to avoid redeclaring deck-stats.js's top-level
// `const COLORS` — on the viewer page these files share one global scope.
const WUBRG = ["W", "U", "B", "R", "G"];
const BASIC_TYPES = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
const TYPE_TO_COLOR = { Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G" };

// Whole-word match. Case-sensitive: basic type names like "Forest" are capitalized.
function hasWord(text, word) {
  return new RegExp("\\b" + word + "\\b").test(text);
}

// A fresh, zeroed WUBRG tally.
function emptyCounts() {
  return { W: 0, U: 0, B: 0, R: 0, G: 0 };
}

// Parse a fetch/search land's oracle text into the basic land TYPES it can
// retrieve and whether it is restricted to basics. Non-fetch text → empty.
function fetchTargets(oracleText) {
  const text = oracleText || "";
  const types = new Set();
  if (!/search your library/i.test(text)) return { types, basicsOnly: false };
  // "a basic land" with no specific type names every basic.
  if (/\bbasic land\b/i.test(text)) {
    BASIC_TYPES.forEach((t) => types.add(t));
    return { types, basicsOnly: true };
  }
  for (const t of BASIC_TYPES) {
    if (hasWord(text, t)) types.add(t);
  }
  const basicsOnly = types.size > 0 && /\bbasic\b/i.test(text);
  return { types, basicsOnly };
}

// Colored (non-C) subset of producedMana as a Set.
function coloredProduced(card) {
  const out = new Set();
  for (const m of card.producedMana || []) if (WUBRG.includes(m)) out.add(m);
  return out;
}

// The WUBRG colors a single land gives access to, pool-aware for fetches.
// Returns { colors: Set, isFetch } — exposing isFetch lets callers skip
// re-parsing the oracle text, since fetch status falls out of the same
// fetchTargets() call this already makes.
function landColors(card, poolLands) {
  const colors = coloredProduced(card);
  const { types, basicsOnly } = fetchTargets(card.oracleText);
  const isFetch = types.size > 0;
  if (isFetch) {
    for (const t of types) colors.add(TYPE_TO_COLOR[t]); // basics always available
    if (!basicsOnly && Array.isArray(poolLands)) {
      for (const other of poolLands) {
        if (other === card) continue;
        const tl = other.typeLine || "";
        const matches = [...types].some((t) => hasWord(tl, t));
        if (matches) for (const c of coloredProduced(other)) colors.add(c);
      }
    }
  }
  return { colors, isFetch };
}

function isLandCard(card) {
  return /land/i.test(card.typeLine || "");
}

// Aggregate the colored mana supply of the lands in a pool.
function computeManaBase(cards) {
  const lands = (Array.isArray(cards) ? cards : []).filter(isLandCard);
  const counts = emptyCounts();
  const fetches = [];
  for (const land of lands) {
    const { colors, isFetch } = landColors(land, lands);
    for (const c of colors) counts[c]++;
    if (isFetch) {
      fetches.push({ name: land.name, colors: WUBRG.filter((c) => colors.has(c)) });
    }
  }
  return { counts, lands: lands.length, fetches };
}

// Pair supply (computeManaBase) against demand (DeckStats.computeStats.sources),
// one row per color present on either side, in WUBRG order.
function compareToDemand(manaBase, deckStats) {
  const counts = (manaBase && manaBase.counts) || emptyCounts();
  const sources = (deckStats && deckStats.sources) || {};
  const rows = [];
  for (const color of WUBRG) {
    const have = counts[color] || 0;
    const need = (sources[color] && sources[color].max) || 0;
    if (have === 0 && need === 0) continue;
    rows.push({ color, have, need, short: Math.max(0, need - have) });
  }
  return rows;
}

const ManaSources = { fetchTargets, landColors, computeManaBase, compareToDemand };
if (typeof module !== "undefined" && module.exports) module.exports = ManaSources;
if (typeof globalThis !== "undefined") globalThis.ManaSources = ManaSources;
