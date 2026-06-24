// Fetches card data + image URLs from Scryfall for the cards in a draft log.
// The log has only names (optionally set+collector), so we resolve them via the
// /cards/collection batch endpoint (<=75 identifiers per request).
function buildIdentifiers(cards) {
  const byName = new Map();
  for (const c of cards) {
    const key = c.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      if (c.set && c.collector) byName.set(key, { set: c.set.toLowerCase(), collector_number: String(c.collector) });
      else byName.set(key, { name: c.name });
    } else if (existing.name && c.set && c.collector) {
      byName.set(key, { set: c.set.toLowerCase(), collector_number: String(c.collector) });
    }
  }
  return [...byName.values()];
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toCardData(card) {
  const face = card.card_faces && card.card_faces[0];
  const imageUrl =
    (card.image_uris && card.image_uris.normal) ||
    (face && face.image_uris && face.image_uris.normal) ||
    "";
  return {
    name: card.name,
    imageUrl,
    cmc: typeof card.cmc === "number" ? card.cmc : 0,
    colors: card.colors || (face && face.colors) || [],
    typeLine: card.type_line || "",
  };
}

async function fetchCardData(cards, fetchImpl) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) throw new Error("No fetch implementation available.");
  const batches = chunk(buildIdentifiers(cards), 75);
  const map = new Map();
  for (let i = 0; i < batches.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 100)); // be gentle on Scryfall
    const res = await f("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: batches[i] }),
    });
    if (!res.ok) throw new Error("Scryfall request failed: " + res.status);
    const json = await res.json();
    for (const card of json.data || []) {
      const data = toCardData(card);
      map.set(data.name.toLowerCase(), data);
    }
  }
  return map;
}

const Scryfall = { buildIdentifiers, chunk, toCardData, fetchCardData };
if (typeof module !== "undefined" && module.exports) module.exports = Scryfall;
if (typeof globalThis !== "undefined") globalThis.Scryfall = Scryfall;
