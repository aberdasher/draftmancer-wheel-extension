// Pure rolling-list helpers for captured drafts (newest first, capped). Keyed by
// draftId so update-vs-prepend is decided by content, not by call timing.
function upsertCurrent(list, draft, cap) {
  const max = typeof cap === "number" ? cap : 3;
  const safe = Array.isArray(list) ? list : [];
  let next;
  if (safe.length && safe[0] && safe[0].draftId === draft.draftId) {
    next = [draft, ...safe.slice(1)]; // update the current draft in place
  } else {
    next = [draft, ...safe.filter((x) => !x || x.draftId !== draft.draftId)]; // new draft: prepend, dedupe
  }
  return next.slice(0, max);
}

function findById(list, draftId) {
  return (Array.isArray(list) ? list : []).find((x) => x && x.draftId === draftId);
}

const DraftHistory = { upsertCurrent, findById };
if (typeof module !== "undefined" && module.exports) module.exports = DraftHistory;
if (typeof globalThis !== "undefined") globalThis.DraftHistory = DraftHistory;
