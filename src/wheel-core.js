// Tracks boosters seen during a draft and computes which cards did not wheel
// back, using each card's stable numeric uniqueID.
function createWheelTracker() {
  let snapshots = []; // { boosterNumber, pickNumber, ids:Set<number>, cardsById:Map<number,Card> }
  const pickedIds = new Set(); // uniqueIDs you picked or burned (never "didn't wheel")
  let lastBooster = []; // ordered card list of the most recent booster (for index resolution)

  function reset() {
    snapshots = [];
    pickedIds.clear();
    lastBooster = [];
  }

  function ingest(payload) {
    const booster = Array.isArray(payload && payload.booster) ? payload.booster : null;
    const boosterNumber = payload ? payload.boosterNumber : undefined;
    const pickNumber = payload ? payload.pickNumber : undefined;
    if (!booster || booster.length === 0) return { active: false };

    const ids = new Set();
    const cardsById = new Map();
    for (const c of booster) {
      ids.add(c.uniqueID);
      cardsById.set(c.uniqueID, c);
    }

    // Find the most recent prior pass of this same pack: same boosterNumber,
    // lower pickNumber, largest uniqueID overlap with the current booster.
    let best = null;
    let bestOverlap = 0;
    let bestPickNumber = -1;
    for (const s of snapshots) {
      if (s.boosterNumber !== boosterNumber) continue;
      if (s.pickNumber >= pickNumber) continue;
      let overlap = 0;
      for (const id of ids) if (s.ids.has(id)) overlap++;
      if (overlap > bestOverlap || (overlap === bestOverlap && s.pickNumber > bestPickNumber)) {
        bestOverlap = overlap;
        bestPickNumber = s.pickNumber;
        best = s;
      }
    }

    let result;
    if (best && bestOverlap > 0) {
      const didntWheel = [];
      for (const c of best.cardsById.values()) {
        if (!ids.has(c.uniqueID) && !pickedIds.has(c.uniqueID)) didntWheel.push(c);
      }
      result = { active: true, isWheel: true, boosterNumber, pickNumber, didntWheel };
    } else {
      result = { active: true, isWheel: false, boosterNumber, pickNumber };
    }

    snapshots.push({ boosterNumber, pickNumber, ids, cardsById });
    lastBooster = booster;
    return result;
  }

  function handleDraftState(payload) {
    return ingest(payload);
  }

  function handleRejoin(statePayload) {
    return ingest(statePayload);
  }

  function handlePickCard(payload) {
    if (!payload) return;
    const indices = []
      .concat(Array.isArray(payload.pickedCards) ? payload.pickedCards : [])
      .concat(Array.isArray(payload.burnedCards) ? payload.burnedCards : []);
    for (const idx of indices) {
      const c = lastBooster[idx];
      if (c && typeof c.uniqueID === "number") pickedIds.add(c.uniqueID);
    }
  }

  return { handleDraftState, handleRejoin, handlePickCard, reset };
}

if (typeof module !== "undefined" && module.exports) module.exports = { createWheelTracker };
if (typeof globalThis !== "undefined") globalThis.createWheelTracker = createWheelTracker;
