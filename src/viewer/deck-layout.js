// Pure deck-layout helpers for the replay viewer: split creatures from the rest
// and group cards into stacked columns by CMC or color. Operates on enriched
// card objects { name, cmc, colors, typeLine } so it is testable without the DOM.
const CMC_LABELS = ["0", "1", "2", "3", "4", "5", "6+"];
const COLOR_LABELS = ["W", "U", "B", "R", "G", "Multi", "Colorless"];

function isCreature(card) {
  return /creature/i.test((card && card.typeLine) || "");
}

function splitByCreature(cards) {
  const creatures = [];
  const others = [];
  for (const c of cards) (isCreature(c) ? creatures : others).push(c);
  return { creatures, others };
}

function cmcOf(card) {
  return typeof card.cmc === "number" && !Number.isNaN(card.cmc) ? card.cmc : 0;
}

function cmcLabel(card) {
  const v = cmcOf(card);
  return v >= 6 ? "6+" : String(Math.floor(v));
}

function colorLabel(card) {
  const colors = Array.isArray(card.colors) ? card.colors : [];
  if (colors.length > 1) return "Multi";
  if (colors.length === 1) return colors[0];
  return "Colorless";
}

function inColumnOrder(a, b) {
  const d = cmcOf(a) - cmcOf(b);
  return d !== 0 ? d : a.name.localeCompare(b.name);
}

function columnize(cards, mode) {
  const labels = mode === "color" ? COLOR_LABELS : CMC_LABELS;
  const labelOf = mode === "color" ? colorLabel : cmcLabel;
  const buckets = {};
  for (const label of labels) buckets[label] = [];
  for (const c of cards) {
    const label = labelOf(c);
    if (!buckets[label]) buckets[label] = []; // defensive: unexpected color code
    buckets[label].push(c);
  }
  // Fixed labels first (incl. empties), then any unexpected labels appended.
  const ordered = labels.concat(Object.keys(buckets).filter((l) => !labels.includes(l)));
  return ordered.map((label) => ({ label, cards: buckets[label].slice().sort(inColumnOrder) }));
}

const DeckLayout = { isCreature, splitByCreature, columnize };
if (typeof module !== "undefined" && module.exports) module.exports = DeckLayout;
if (typeof globalThis !== "undefined") globalThis.DeckLayout = DeckLayout;
