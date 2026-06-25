// Pure deck-stats over enriched cards { name, cmc, colors, typeLine, manaCost }.
// Embeds Frank Karsten's 40-card "colored sources needed" table.
const KARSTEN = {
  1: { 1: 9, 2: 9, 3: 8, 4: 7, 5: 6, 6: 6 },
  2: { 2: 14, 3: 12, 4: 11, 5: 10, 6: 9, 7: 8 },
  3: { 3: 16, 4: 14, 5: 13, 6: 11, 7: 10 },
  4: { 4: 17, 5: 15 },
};
const COLORS = ["W", "U", "B", "R", "G"];

function cmcOf(c) {
  return typeof c.cmc === "number" && !Number.isNaN(c.cmc) ? c.cmc : 0;
}

function isLand(c) {
  return /land/i.test(c.typeLine || "");
}

function primaryType(typeLine) {
  const t = typeLine || "";
  if (/creature/i.test(t)) return "Creature";
  if (/land/i.test(t)) return "Land";
  if (/planeswalker/i.test(t)) return "Planeswalker";
  if (/instant/i.test(t)) return "Instant";
  if (/sorcery/i.test(t)) return "Sorcery";
  if (/enchantment/i.test(t)) return "Enchantment";
  if (/artifact/i.test(t)) return "Artifact";
  return "Other";
}

function pipsOfColor(manaCost, color) {
  return ((manaCost || "").match(new RegExp(color, "g")) || []).length;
}

function sourcesForCard(pips, cmc) {
  if (pips <= 0) return 0;
  const row = KARSTEN[Math.min(pips, 4)];
  const keys = Object.keys(row).map(Number);
  const lo = Math.min(...keys);
  const hi = Math.max(...keys);
  const c = Math.max(lo, Math.min(cmc, hi));
  return row[c];
}

function computeStats(cards) {
  const list = Array.isArray(cards) ? cards : [];
  let creatures = 0;
  let spells = 0;
  let lands = 0;
  const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const types = { Creature: 0, Instant: 0, Sorcery: 0, Artifact: 0, Enchantment: 0, Planeswalker: 0, Land: 0 };
  const byColor = { W: [], U: [], B: [], R: [], G: [] };

  for (const c of list) {
    const land = isLand(c);
    if (land) lands++;
    else if (/creature/i.test(c.typeLine || "")) creatures++;
    else spells++;

    const pt = primaryType(c.typeLine);
    if (types[pt] != null) types[pt]++;

    for (const color of COLORS) {
      const n = pipsOfColor(c.manaCost, color);
      if (n > 0) {
        pips[color] += n;
        if (!land) byColor[color].push({ name: c.name, sources: sourcesForCard(n, cmcOf(c)) });
      }
    }
  }

  const sources = {};
  for (const color of COLORS) {
    const arr = byColor[color].slice().sort((a, b) => b.sources - a.sources || a.name.localeCompare(b.name));
    if (arr.length) sources[color] = { max: arr[0].sources, top: arr.slice(0, 3) };
  }

  return { total: list.length, creatures, spells, lands, sources, pips, types };
}

const DeckStats = { computeStats };
if (typeof module !== "undefined" && module.exports) module.exports = DeckStats;
if (typeof globalThis !== "undefined") globalThis.DeckStats = DeckStats;
