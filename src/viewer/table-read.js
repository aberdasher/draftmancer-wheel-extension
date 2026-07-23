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
  const LIFT_MIN = 1.5, WHEEL_MAX = 0.35;
  const SIGNAL_BASE = 1.0, VALUE_W = 0.5, MAIN_FRAC = 0.5, SPLASH_FRAC = 0.2;

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

  function archColors(arch) {
    return (arch || "").split("").filter((ch) => WUBRG.indexOf(ch) !== -1);
  }

  function topSignals(picks, n) {
    return (picks || [])
      .filter((c) => c.arch && (c.lift || 0) >= LIFT_MIN && (c.wheel || 0) <= WHEEL_MAX)
      .slice()
      .sort((a, b) => (b.lift || 0) - (a.lift || 0) || (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name))
      .slice(0, n)
      .map((c) => ({ name: c.name, arch: c.arch, lift: c.lift, colors: c.colors || [], img: c.img, rating: c.rating, cmc: c.cmc, type: c.type }));
  }

  function inferColors(picks) {
    const value = keyCards(picks, 4);
    const signals = topSignals(picks, 4);
    const w = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const s of signals) {
      const mult = SIGNAL_BASE * Math.max(1, s.lift || 1);
      for (const c of archColors(s.arch)) w[c] += mult;
    }
    for (const v of value) {
      for (const c of v.colors || []) if (w[c] !== undefined) w[c] += VALUE_W;
    }
    const maxw = Math.max.apply(null, WUBRG.map((c) => w[c]));
    if (maxw <= 0) return { colors: "", main: [], splash: [] };
    const main = WUBRG.filter((c) => w[c] >= MAIN_FRAC * maxw);
    const splash = WUBRG.filter((c) => w[c] >= SPLASH_FRAC * maxw && w[c] < MAIN_FRAC * maxw);
    return { colors: main.join("") + splash.map((c) => c.toLowerCase()).join(""), main, splash };
  }

  function seatStateThrough(seat, pack, pick, n) {
    const pool = picksThrough(seat.picks, pack, pick);
    return {
      name: seat.name,
      colorCounts: colorCounts(pool),
      keyCards: keyCards(pool, n),
      signals: topSignals(pool, n),
      inferred: inferColors(pool),
      pool,
    };
  }

  function ringLabels(ring) {
    const n = (ring || []).length;
    return (ring || []).map((name, i) => {
      let label;
      if (i === 0) label = "You";
      else if (i <= n / 2) label = "L" + i;
      else label = "R" + (n - i);
      return { name, label, angleDeg: (180 + (i * 360) / n) % 360, isViewer: i === 0 };
    });
  }

  const TableRead = { picksThrough, colorCounts, keyCards, archColors, topSignals, inferColors, seatStateThrough, ringLabels, COLORS: WUBRG };
  if (typeof module !== "undefined" && module.exports) module.exports = TableRead;
  if (typeof globalThis !== "undefined") globalThis.TableRead = TableRead;
})();
