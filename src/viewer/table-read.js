// Pure "read the table" logic: per-seat draft state through a given (pack,pick).
// Operates on the embedded DMW_TABLE seat picks, so it's DOM-free and testable.
//
// Wrapped in an IIFE so none of its internals (WUBRG and the helper functions)
// leak into the top-level scope. The hosted review page concatenates every viewer
// module into a single <script>, and other non-IIFE modules already declare
// top-level names like COLORS/WUBRG — a leaked duplicate here is a redeclaration
// SyntaxError that breaks the WHOLE bundle. Only globalThis.TableRead / exports escape.
(function () {
  const WUBRG = ["W", "U", "B", "R", "G"];

  function picksThrough(picks, pack, pick) {
    return (picks || []).filter(
      (c) => c.pack < pack || (c.pack === pack && c.pick <= pick)
    );
  }

  function colorCounts(picks) {
    const out = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const c of picks || []) {
      for (const col of c.colors || []) {
        if (out[col] !== undefined) out[col] += 1;
      }
    }
    return out;
  }

  function keyCards(picks, n) {
    return (picks || [])
      .slice()
      .sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name))
      .slice(0, n)
      .map((c) => ({ name: c.name, rating: c.rating, colors: c.colors || [], cmc: c.cmc, type: c.type, img: c.img }));
  }

  function seatStateThrough(seat, pack, pick, n) {
    const pool = picksThrough(seat.picks, pack, pick);
    return { name: seat.name, colorCounts: colorCounts(pool), keyCards: keyCards(pool, n), pool };
  }

  const TableRead = { picksThrough, colorCounts, keyCards, seatStateThrough, COLORS: WUBRG };
  if (typeof module !== "undefined" && module.exports) module.exports = TableRead;
  if (typeof globalThis !== "undefined") globalThis.TableRead = TableRead;
})();
