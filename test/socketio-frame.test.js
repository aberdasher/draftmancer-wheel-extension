const test = require("node:test");
const assert = require("node:assert");
const { parseSocketIOFrame } = require("../src/socketio-frame.js");

test("parses a plain default-namespace EVENT frame", () => {
  const r = parseSocketIOFrame('42["draftState",{"boosterNumber":0,"pickNumber":0}]');
  assert.deepStrictEqual(r, { event: "draftState", args: [{ boosterNumber: 0, pickNumber: 0 }] });
});

test("parses an EVENT frame carrying an ack id", () => {
  const r = parseSocketIOFrame('420["pickCard",{"pickedCards":[2]}]');
  assert.deepStrictEqual(r, { event: "pickCard", args: [{ pickedCards: [2] }] });
});

test("parses an EVENT frame with an explicit namespace and ack id", () => {
  const r = parseSocketIOFrame('42/draft,7["draftState",{"pickNumber":3}]');
  assert.deepStrictEqual(r, { event: "draftState", args: [{ pickNumber: 3 }] });
});

test("parses an EVENT frame with multiple args", () => {
  const r = parseSocketIOFrame('42["foo",1,"two",{"k":3}]');
  assert.deepStrictEqual(r, { event: "foo", args: [1, "two", { k: 3 }] });
});

test("returns null for engine.io ping/pong frames", () => {
  assert.strictEqual(parseSocketIOFrame("2"), null);
  assert.strictEqual(parseSocketIOFrame("3"), null);
});

test("returns null for non-event socket.io message frames (CONNECT=40)", () => {
  assert.strictEqual(parseSocketIOFrame("40"), null);
});

test("returns null for binary-event frames (45...) ", () => {
  assert.strictEqual(parseSocketIOFrame('451-["x",{}]'), null);
});

test("returns null for non-string and unparseable input", () => {
  assert.strictEqual(parseSocketIOFrame(123), null);
  assert.strictEqual(parseSocketIOFrame("42not-json"), null);
  assert.strictEqual(parseSocketIOFrame(""), null);
});
