// Builds a per-pick replay model from a parsed draft log. Reuses wheel-core's
// uniqueID-based matcher by synthesizing a stable id per (packNum, cardName) so
// the same physical card matches itself as the pack wheels back. Across pack
// rounds ids differ (packNum differs). Caveat: two distinct physical copies of
// the same name within one pack round collide — rare, at worst a slight
// mis-attribution of a duplicate common in the wheel panel.
// Named distinctly from wheel-core's global `createWheelTracker`: on the viewer
// page these files load as classic scripts sharing one global scope, so a
// top-level `const createWheelTracker` here would redeclare that global and throw.
const createTracker =
  typeof require === "function"
    ? require("../wheel-core.js").createWheelTracker
    : globalThis.createWheelTracker;

function ref(card) {
  const r = { name: card.name };
  if (card.set) r.set = card.set;
  if (card.collector) r.collector = card.collector;
  return r;
}

function buildReplay(parsed) {
  const tracker = createTracker();
  const steps = [];
  const deckSoFar = [];
  const idByKey = new Map();
  let nextId = 1;

  for (const p of parsed.picks) {
    const booster = p.cards.map((c) => {
      const key = p.packNum + " " + c.name;
      let id = idByKey.get(key);
      if (id === undefined) {
        id = nextId++;
        idByKey.set(key, id);
      }
      const item = { uniqueID: id, name: c.name };
      if (c.set) item.set = c.set;
      if (c.collector) item.collector = c.collector;
      return item;
    });

    const result = tracker.handleDraftState({
      booster,
      boosterNumber: p.packNum - 1,
      pickNumber: p.pickNum - 1,
    });
    const didntWheel = result && result.isWheel ? result.didntWheel.map(ref) : null;

    const cards = p.cards.map((c, idx) => {
      const r = ref(c);
      r.picked = p.pickedIndices.includes(idx);
      return r;
    });

    for (const idx of p.pickedIndices) {
      if (p.cards[idx]) deckSoFar.push(ref(p.cards[idx]));
    }
    tracker.handlePickCard({ pickedCards: p.pickedIndices });

    steps.push({ packNum: p.packNum, pickNum: p.pickNum, cards, didntWheel, deckSoFar: deckSoFar.slice() });
  }

  return { player: parsed.player, steps };
}

if (typeof module !== "undefined" && module.exports) module.exports = { buildReplay };
if (typeof globalThis !== "undefined") globalThis.buildReplay = buildReplay;
