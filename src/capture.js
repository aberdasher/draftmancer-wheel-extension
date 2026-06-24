// Accumulates the player's draft from the live socket events the content script
// already receives, into the same shape buildReplay consumes (plus real
// uniqueIDs). Pure: no chrome, no Date — the caller stamps capturedAt.
function createDraftCapture() {
  let picks = [];
  let current = null; // { boosterNumber, pickNumber, booster }

  function mapCard(c) {
    const card = { name: c.name, uniqueID: c.uniqueID };
    if (c.set) card.set = c.set;
    if (c.collector_number) card.collector = c.collector_number;
    return card;
  }

  function onDraftState(payload) {
    if (!payload || !Array.isArray(payload.booster) || payload.booster.length === 0) return;
    if (payload.boosterNumber === 0 && payload.pickNumber === 0) picks = []; // new draft
    current = { boosterNumber: payload.boosterNumber, pickNumber: payload.pickNumber, booster: payload.booster };
  }

  function onPickCard(payload) {
    if (!current || !payload) return getDraft();
    const indices = Array.isArray(payload.pickedCards) ? payload.pickedCards.slice() : [];
    picks.push({
      packNum: current.boosterNumber + 1,
      pickNum: current.pickNumber + 1,
      cards: current.booster.map(mapCard),
      pickedIndices: indices,
    });
    return getDraft();
  }

  function getDraft() {
    return { player: null, picks: picks.slice() };
  }

  return { onDraftState, onPickCard, getDraft };
}

if (typeof module !== "undefined" && module.exports) module.exports = { createDraftCapture };
if (typeof globalThis !== "undefined") globalThis.createDraftCapture = createDraftCapture;
