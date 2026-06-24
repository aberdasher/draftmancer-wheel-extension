const test = require("node:test");
const assert = require("node:assert");
const { parseDraftLog } = require("../src/viewer/log-parser.js");

const LOG = `Event #: abc_123
Time: Mon, 01 Jan 2026
Players:
--> Me
    Bot 1

------ TST ------

Pack 1 pick 1:
--> Llanowar Elves
    Shock
    Giant Growth

Pack 1 pick 2:
    Opt (TST) 55
--> Lightning Bolt (TST) 161
`;

test("extracts the log owner from the Players block", () => {
  assert.strictEqual(parseDraftLog(LOG).player, "Me");
});

test("parses pick blocks with plain card lines", () => {
  const { picks } = parseDraftLog(LOG);
  assert.deepStrictEqual(picks[0], {
    packNum: 1,
    pickNum: 1,
    cards: [{ name: "Llanowar Elves" }, { name: "Shock" }, { name: "Giant Growth" }],
    pickedIndices: [0],
  });
});

test("parses set + collector number annotations and the picked index", () => {
  const { picks } = parseDraftLog(LOG);
  assert.deepStrictEqual(picks[1], {
    packNum: 1,
    pickNum: 2,
    cards: [
      { name: "Opt", set: "TST", collector: "55" },
      { name: "Lightning Bolt", set: "TST", collector: "161" },
    ],
    pickedIndices: [1],
  });
});

test("tolerates CRLF line endings", () => {
  const { picks } = parseDraftLog(LOG.replace(/\n/g, "\r\n"));
  assert.strictEqual(picks.length, 2);
  assert.strictEqual(picks[0].cards[0].name, "Llanowar Elves");
});

test("throws a clear error when there are no pick blocks", () => {
  assert.throws(() => parseDraftLog("just some text\nwith no packs"), /Pack .* pick/i);
});

test("collects all players in the Players block plus the owner", () => {
  const { player, players } = parseDraftLog(LOG);
  assert.strictEqual(player, "Me");
  assert.deepStrictEqual(players, ["Me", "Bot 1"]);
});

test("a banner line ends the current pick block even with no blank line before it", () => {
  const log = `Players:
--> Me

Pack 1 pick 1:
--> Shock
    Opt
------ NEXT ------
Pack 2 pick 1:
--> Bolt
    Counterspell
`;
  const { picks } = parseDraftLog(log);
  assert.strictEqual(picks.length, 2);
  // pick 1 keeps only its two cards; nothing leaks across the banner
  assert.deepStrictEqual(picks[0].cards.map((c) => c.name), ["Shock", "Opt"]);
  assert.deepStrictEqual(picks[1].cards.map((c) => c.name), ["Bolt", "Counterspell"]);
});
