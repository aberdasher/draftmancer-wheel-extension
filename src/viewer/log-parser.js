// Parses a Draftmancer MTGO / MagicProTools draft log (one player's perspective)
// into structured picks. Each "Pack X pick Y:" block lists every card in that
// booster in order, with "--> " marking the card(s) the owner picked.
function parseDraftLog(text) {
  if (typeof text !== "string") throw new Error("Draft log must be text.");
  const lines = text.split(/\r?\n/);

  let player = null;
  const players = [];
  let inPlayers = false;
  const picks = [];
  let current = null;

  const headerRe = /^Pack (\d+) pick (\d+):/;
  // Card line: "--> Name" or "    Name", with optional trailing " (SET) collector".
  const cardRe = /^(?:-->|\s{2,})\s*(.*?)(?: \(([^()]+)\) (\S+))?\s*$/;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (/^Players:/.test(line)) {
      inPlayers = true;
      continue;
    }
    const header = line.match(headerRe);
    if (header) {
      inPlayers = false;
      current = { packNum: parseInt(header[1], 10), pickNum: parseInt(header[2], 10), cards: [], pickedIndices: [] };
      picks.push(current);
      continue;
    }
    if (inPlayers) {
      const pm = line.match(/^(?:-->|\s{2,})\s*(.*\S)/);
      if (pm) {
        players.push(pm[1]);
        if (/^-->/.test(line) && player === null) player = pm[1];
      }
      continue;
    }
    if (current) {
      if (line.trim() === "" || /^-{3,}/.test(line)) {
        // blank line or "------ banner ------" ends the current block
        current = null;
        continue;
      }
      const c = line.match(cardRe);
      if (!c) continue;
      const picked = /^-->/.test(line);
      const card = { name: c[1].trim() };
      if (c[2] && c[3]) {
        card.set = c[2];
        card.collector = c[3];
      }
      if (picked) current.pickedIndices.push(current.cards.length);
      current.cards.push(card);
    }
  }

  if (picks.length === 0) {
    throw new Error("No 'Pack X pick Y' blocks found — is this a Draftmancer MTGO/MagicProTools draft log?");
  }
  return { player, players, picks };
}

if (typeof module !== "undefined" && module.exports) module.exports = { parseDraftLog };
if (typeof globalThis !== "undefined") globalThis.parseDraftLog = parseDraftLog;
