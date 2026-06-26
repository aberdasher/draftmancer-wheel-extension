// Pure mana-base (supply) analysis over enriched land cards
// { name, typeLine, producedMana, oracleText }. No chrome, DOM, fetch, or Date.
const COLORS = ["W", "U", "B", "R", "G"];
const BASIC_TYPES = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
const TYPE_TO_COLOR = { Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G" };

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
    if (new RegExp("\\b" + t + "\\b").test(text)) types.add(t);
  }
  const basicsOnly = types.size > 0 && /\bbasic\b/i.test(text);
  return { types, basicsOnly };
}

// Colored (non-C) subset of producedMana as a Set.
function coloredProduced(card) {
  const out = new Set();
  for (const m of card.producedMana || []) if (COLORS.includes(m)) out.add(m);
  return out;
}

// The WUBRG colors a single land gives access to, pool-aware for fetches.
function landColors(card, poolLands) {
  const colors = coloredProduced(card);
  const { types, basicsOnly } = fetchTargets(card.oracleText);
  if (types.size > 0) {
    for (const t of types) colors.add(TYPE_TO_COLOR[t]); // basics always available
    if (!basicsOnly && Array.isArray(poolLands)) {
      for (const other of poolLands) {
        if (other === card) continue;
        const tl = other.typeLine || "";
        const matches = [...types].some((t) => new RegExp("\\b" + t + "\\b").test(tl));
        if (matches) for (const c of coloredProduced(other)) colors.add(c);
      }
    }
  }
  return colors;
}

const ManaSources = { fetchTargets, landColors };
if (typeof module !== "undefined" && module.exports) module.exports = ManaSources;
if (typeof globalThis !== "undefined") globalThis.ManaSources = ManaSources;
