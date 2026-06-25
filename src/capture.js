// Accumulates the player's draft from the live socket events the content script
// already receives, into the same shape buildReplay consumes (plus real
// uniqueIDs). Pure: no chrome, no Date — the caller stamps capturedAt.
function createDraftCapture() {
  let picks = [];
  let current = null; // { boosterNumber, pickNumber, booster }
  const sideboard = new Set(); // uniqueIDs currently in the sideboard (absence = maindeck)

  function mapCard(c) {
    const card = { name: c.name, uniqueID: c.uniqueID };
    if (c.set) card.set = c.set;
    if (c.collector_number) card.collector = c.collector_number;
    return card;
  }

  function onDraftState(payload) {
    if (!payload || !Array.isArray(payload.booster) || payload.booster.length === 0) return;
    if (payload.boosterNumber === 0 && payload.pickNumber === 0) {
      picks = [];
      sideboard.clear();
    }
    current = { boosterNumber: payload.boosterNumber, pickNumber: payload.pickNumber, booster: payload.booster };
  }

  function onPickCard(payload) {
    if (!current || !payload) return getDraft();
    const indices = Array.isArray(payload.pickedCards) ? payload.pickedCards.slice() : [];
    const burned = Array.isArray(payload.burnedCards) ? payload.burnedCards.slice() : [];
    const pick = {
      packNum: current.boosterNumber + 1,
      pickNum: current.pickNumber + 1,
      cards: current.booster.map(mapCard),
      pickedIndices: indices,
    };
    if (burned.length) pick.burnedIndices = burned; // omit when empty so existing capture tests' exact shapes still hold
    picks.push(pick);
    return getDraft();
  }

  function pickedIds() {
    const ids = [];
    for (const p of picks) {
      for (const idx of p.pickedIndices) {
        const c = p.cards[idx];
        if (c && typeof c.uniqueID === "number") ids.push(c.uniqueID);
      }
    }
    return ids;
  }

  function onMoveCard(uniqueID, zone) {
    if (zone === "side") sideboard.add(uniqueID);
    else sideboard.delete(uniqueID);
  }

  function onMoveAllToSideboard() {
    for (const id of pickedIds()) sideboard.add(id);
  }

  function onSwapDeckAndSideboard() {
    const all = pickedIds();
    const complement = all.filter((id) => !sideboard.has(id));
    sideboard.clear();
    for (const id of complement) sideboard.add(id);
  }

  function onRejoinZones(pickedCards) {
    if (!pickedCards || !Array.isArray(pickedCards.side)) return;
    sideboard.clear();
    for (const c of pickedCards.side) if (c && typeof c.uniqueID === "number") sideboard.add(c.uniqueID);
  }

  function getDraft() {
    const d = { player: null, picks: picks.slice() };
    if (sideboard.size) d.sideboard = [...sideboard];
    return d;
  }

  return { onDraftState, onPickCard, onMoveCard, onMoveAllToSideboard, onSwapDeckAndSideboard, onRejoinZones, getDraft };
}

if (typeof module !== "undefined" && module.exports) module.exports = { createDraftCapture };
if (typeof globalThis !== "undefined") globalThis.createDraftCapture = createDraftCapture;
