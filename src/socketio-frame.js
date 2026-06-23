// Parses a socket.io v4 text frame into { event, args } for EVENT packets only.
// Frame shape: "4" (engine.io MESSAGE) + "2" (socket.io EVENT) + optional
// "/namespace," + optional numeric ack id + JSON array [event, ...args].
function parseSocketIOFrame(data) {
  if (typeof data !== "string" || data.length < 2) return null;
  // Engine.io MESSAGE is "4"; socket.io EVENT is "2" => prefix "42".
  if (data[0] !== "4" || data[1] !== "2") return null;
  let i = 2;
  // Optional namespace: "/...," up to the first comma.
  if (data[i] === "/") {
    const comma = data.indexOf(",", i);
    if (comma === -1) return null;
    i = comma + 1;
  }
  // Optional numeric ack id.
  while (i < data.length && data[i] >= "0" && data[i] <= "9") i++;
  const payload = data.slice(i);
  if (payload.length === 0 || payload[0] !== "[") return null;
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (_e) {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0] !== "string") return null;
  return { event: parsed[0], args: parsed.slice(1) };
}

if (typeof module !== "undefined" && module.exports) module.exports = { parseSocketIOFrame };
if (typeof globalThis !== "undefined") globalThis.parseSocketIOFrame = parseSocketIOFrame;
