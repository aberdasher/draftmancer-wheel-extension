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
  if (typeof card.uniqueID === "number") r.uniqueID = card.uniqueID;
  return r;
}

function buildReplay(parsed) {
  const tracker = createTracker();
  const steps = [];
  const deckSoFar = [];
  const idByKey = new Map();
  let nextId = 1;

  const podSize = parsed.players && parsed.players.length ? parsed.players.length : 0;

  for (const p of parsed.picks) {
    // A pack you see at pickNum P is the same physical pack you first saw at
    // ((P-1) % podSize). Keying the synthetic id on this lineage (not just the
    // card name) stops different packs in the same round that share a common
    // card from being mistaken for the same pack. podSize 0 (unknown players) →
    // every pick is its own pack, so no wheels are reported (safe degrade).
    const lineage = podSize > 0 ? (p.pickNum - 1) % podSize : p.pickNum;

    const booster = p.cards.map((c) => {
      let id;
      if (typeof c.uniqueID === "number") {
        id = c.uniqueID; // captured drafts carry real, table-stable uniqueIDs
      } else {
        const key = p.packNum + " " + lineage + " " + c.name;
        id = idByKey.get(key);
        if (id === undefined) {
          id = nextId++;
          idByKey.set(key, id);
        }
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

    // Snapshot the deck as it stood ENTERING this pick (excludes the current
    // selection); the card taken here first appears in the deck at the next step.
    const deckBefore = deckSoFar.slice();
    for (const idx of p.pickedIndices) {
      if (p.cards[idx]) deckSoFar.push(ref(p.cards[idx]));
    }
    tracker.handlePickCard({ pickedCards: p.pickedIndices, burnedCards: p.burnedIndices || [] });

    steps.push({ packNum: p.packNum, pickNum: p.pickNum, cards, didntWheel, deckSoFar: deckBefore });
  }

  return { player: parsed.player, steps };
}

if (typeof module !== "undefined" && module.exports) module.exports = { buildReplay };
if (typeof globalThis !== "undefined") globalThis.buildReplay = buildReplay;
