// Persisted viewer preferences (chrome.storage.local). mergePrefs is pure and
// validated; loadPrefs/savePref are thin browser-only wrappers that degrade to
// defaults / no-op when chrome.storage is unavailable.
const DEFAULTS = { hidePick: true, deckSort: "cmc", splitCreatures: false };

function mergePrefs(stored, defaults) {
  const base = defaults || DEFAULTS;
  const out = { hidePick: base.hidePick, deckSort: base.deckSort, splitCreatures: base.splitCreatures };
  if (stored && typeof stored === "object") {
    if (typeof stored.hidePick === "boolean") out.hidePick = stored.hidePick;
    if (stored.deckSort === "cmc" || stored.deckSort === "color") out.deckSort = stored.deckSort;
    if (typeof stored.splitCreatures === "boolean") out.splitCreatures = stored.splitCreatures;
  }
  return out;
}

function storageArea() {
  return (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) || null;
}

function loadPrefs(callback) {
  const area = storageArea();
  if (!area) {
    callback(mergePrefs(null));
    return;
  }
  area.get("dmwPrefs", (data) => callback(mergePrefs(data && data.dmwPrefs)));
}

function savePref(key, value) {
  const area = storageArea();
  if (!area) return;
  area.get("dmwPrefs", (data) => {
    const merged = mergePrefs(data && data.dmwPrefs);
    // Re-validate the candidate so an invalid/unknown (key, value) never lands in
    // storage (mergePrefs drops bad types and unknown keys).
    area.set({ dmwPrefs: mergePrefs({ ...merged, [key]: value }) });
  });
}

const Prefs = { DEFAULTS, mergePrefs, loadPrefs, savePref };
if (typeof module !== "undefined" && module.exports) module.exports = Prefs;
if (typeof globalThis !== "undefined") globalThis.Prefs = Prefs;
