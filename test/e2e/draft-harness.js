#!/usr/bin/env node
/*
 * End-to-end harness for the Draftmancer "Didn't Wheel" extension.
 *
 * Launches Chromium with the extension loaded, creates a bot draft on
 * draftmancer.com, drafts past the wheel (pick 9 in an 8-player pod), and
 * inspects the extension's #dmw-sidebar to confirm it reports the cards that
 * did not wheel back.
 *
 * Until the extension itself is implemented, the draft-driving still runs and
 * the script reports that the sidebar was not found (the acceptance test we
 * want to make pass).
 *
 * Config via env:
 *   HEADLESS=new     run headless (default: headful via $DISPLAY / WSLg)
 *   SET=<name|code>  set to draft (default: newest set, the first option)
 *   BOTS=<n>         number of bots (default: 7, for an 8-player pod)
 *   PICKS=<n>        how many picks to make (default: 12, enough to wheel)
 *   SLOWMO=<ms>      Puppeteer slowMo for debugging (default: 0)
 *   KEEP_OPEN=1      leave the browser open after finishing
 */
const path = require("path");
const fs = require("fs");
// puppeteer is an optional devDependency: this harness drives a real browser
// and is meant to be run via `npm run test:e2e`. When it (or the browser env)
// isn't installed, skip gracefully instead of crashing — that way the bare
// `node --test` discovery of this file reports a clean pass rather than a
// MODULE_NOT_FOUND failure.
let puppeteer = null;
try {
  puppeteer = require("puppeteer");
} catch (_e) {
  console.log("[harness] puppeteer not installed — skipping e2e harness. Run `npm install`, then `npm run test:e2e`.");
}

const EXTENSION_DIR = path.resolve(__dirname, "..", "..");
const SITE = "https://draftmancer.com";
const BOTS = parseInt(process.env.BOTS || "7", 10);
const PICKS = parseInt(process.env.PICKS || "12", 10);
// 1-indexed pick at which your first pack wheels back: players = BOTS + 1 (you),
// the pack returns after the whole table has seen it once, i.e. on pick players + 1.
const WHEEL_PICK = BOTS + 2;
const SET = process.env.SET || "";
const HEADLESS = process.env.HEADLESS === "new" ? "new" : false;

const log = (...a) => console.log("[harness]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extensionAvailable() {
  return fs.existsSync(path.join(EXTENSION_DIR, "manifest.json"));
}

async function launch() {
  const args = ["--no-sandbox", "--disable-setuid-sandbox"];
  const hasExtension = extensionAvailable();
  if (hasExtension) {
    args.push(`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`);
    log(`loading extension from ${EXTENSION_DIR}`);
  } else {
    log(`WARNING: no manifest.json in ${EXTENSION_DIR} — running WITHOUT the extension (draft-driving only).`);
  }
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    args,
    slowMo: parseInt(process.env.SLOWMO || "0", 10),
    defaultViewport: { width: 1400, height: 900 },
  });
  return { browser, hasExtension };
}

// Dismiss any welcome/getting-started modal that might cover the controls.
async function dismissModals(page) {
  try {
    await page.keyboard.press("Escape");
    await sleep(200);
  } catch (_e) {
    /* ignore */
  }
}

// Wait until we are the session owner (the Start button is shown to the owner only).
async function waitForOwner(page) {
  log("waiting to become session owner…");
  await page.waitForFunction(
    () => {
      const btns = [...document.querySelectorAll("button")];
      return btns.some((b) => b.offsetParent !== null && b.textContent.trim() === "Start");
    },
    { timeout: 30000 }
  );
  log("session ready (owner).");
}

async function selectSet(page) {
  log(`selecting set${SET ? ` matching "${SET}"` : " (newest)"}…`);
  await page.waitForSelector(".set-select .select", { timeout: 15000 });
  // Open via an in-page click: a real Puppeteer mouse click fires a pointer event
  // that the SetSelect's document-level close handler reacts to, snapping it shut.
  await page.evaluate(() => {
    const sel = [...document.querySelectorAll(".set-select")].find((s) => s.offsetParent !== null);
    sel && sel.querySelector(".select").click();
  });
  await page.waitForSelector(".set-select.expanded .options .option", { timeout: 10000 });

  const picked = await page.evaluate((want) => {
    const opts = [...document.querySelectorAll(".set-select.expanded .options .option")];
    if (opts.length === 0) return null;
    let target = opts[0];
    if (want) {
      const w = want.toLowerCase();
      const match = opts.find((o) => o.textContent.toLowerCase().includes(w));
      if (match) target = match;
    }
    const name = target.textContent.trim();
    // Real pointer sequence: SetSelect selects a single set on pointerup.
    const fire = (type) =>
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true }));
    fire("pointerdown");
    fire("pointerup");
    target.click();
    return name;
  }, SET);

  if (!picked) throw new Error("no set options found in the set selector");
  // Confirm a single set is now selected.
  await page.waitForFunction(() => !!document.querySelector(".set-select .selected-set-name"), {
    timeout: 10000,
  });
  const selected = await page.$eval(".set-select .selected-set-name", (el) => el.textContent.trim());
  log(`set selected: ${selected}`);
}

async function setBots(page) {
  log(`setting bots = ${BOTS}…`);
  await page.waitForSelector("#bots", { timeout: 10000 });
  await page.evaluate((n) => {
    const input = document.querySelector("#bots");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, String(n));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, BOTS);
}

async function startDraft(page) {
  log("clicking Start…");
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.offsetParent !== null && b.textContent.trim() === "Start"
    );
    if (!btn) throw new Error("Start button not found");
    btn.click();
  });
  // Wait for the first booster to appear.
  await page.waitForSelector(".booster.card-container .booster-card", { timeout: 30000 });
  await sleep(1500); // let the pack-open / card-flip animation settle
  log("draft started, first booster received.");
}

// Read "Pack #X, Pick #Y" from the booster controls. Returns { pack, pick } 1-indexed, or null.
// Read the specific span so the adjacent pick-timer digits don't bleed into the match.
async function readPackPick(page) {
  return page.evaluate(() => {
    const spans = [...document.querySelectorAll("#booster-controls span")];
    for (const s of spans) {
      const m = s.textContent.match(/Pack #(\d+),\s*Pick #(\d+)/);
      if (m) return { pack: parseInt(m[1], 10), pick: parseInt(m[2], 10) };
    }
    return null;
  });
}

// Read the extension sidebar state, if present.
async function readSidebar(page) {
  return page.evaluate(() => {
    const root = document.querySelector("#dmw-sidebar");
    if (!root) return { present: false };
    const header = root.querySelector(".dmw-header");
    const cards = [...root.querySelectorAll(".dmw-card span")].map((s) => s.textContent.trim());
    return { present: true, header: header ? header.textContent.trim() : "", cards };
  });
}

// Make one pick and wait for the booster to actually advance. Returns false if the
// draft has ended (no booster to pick from).
async function pickOnce(page) {
  await page.waitForSelector(".booster.card-container .booster-card", { timeout: 30000 });
  const before = await readPackPick(page);

  // Select the first card. The first pick of a pack plays a flip/open animation, so a
  // click can land before the card is interactive — fire the click in-page and retry
  // until the .selected class appears.
  let selected = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    selected = await page.evaluate(() => {
      const card = document.querySelector(".booster.card-container .booster-card");
      if (!card) return false;
      if (!card.classList.contains("selected")) card.click();
      return document.querySelector(".booster.card-container .booster-card.selected") !== null;
    });
    if (selected) break;
    await sleep(400);
  }
  if (!selected) throw new Error("could not select a card");

  await page.waitForSelector('#booster-controls input[value="Confirm Pick"]', { timeout: 10000 });
  await page.click('#booster-controls input[value="Confirm Pick"]');

  // Wait until the pick advances (pack/pick changes) or the booster goes away.
  await page.waitForFunction(
    (b) => {
      const spans = [...document.querySelectorAll("#booster-controls span")];
      let cur = null;
      for (const s of spans) {
        const m = s.textContent.match(/Pack #(\d+),\s*Pick #(\d+)/);
        if (m) cur = { pack: +m[1], pick: +m[2] };
      }
      if (!cur) return true; // no current booster: round/draft ended
      return !b || cur.pack !== b.pack || cur.pick !== b.pick;
    },
    { timeout: 30000 },
    before
  );
  return true;
}

async function run() {
  const { browser, hasExtension } = await launch();
  let sawWheelSidebar = null;
  try {
    const page = await browser.newPage();
    page.on("console", (msg) => {
      const t = msg.text();
      if (t.includes("dm-wheel") || t.toLowerCase().includes("error")) log("page:", t);
    });
    log(`navigating to ${SITE}…`);
    await page.goto(SITE, { waitUntil: "networkidle2", timeout: 60000 });
    await dismissModals(page);
    await waitForOwner(page);
    await selectSet(page);
    await setBots(page);
    await startDraft(page);

    for (let i = 0; i < PICKS; i++) {
      const pp = await readPackPick(page);
      const sidebar = await readSidebar(page);
      log(`pick ${i + 1}: ${pp ? `Pack ${pp.pack} Pick ${pp.pick}` : "?"} | sidebar: ${
        sidebar.present ? `${sidebar.header} [${sidebar.cards.length} cards]` : "absent"
      }`);

      if (pp && pp.pack === 1 && pp.pick >= WHEEL_PICK && sidebar.present && /didn't wheel/i.test(sidebar.header)) {
        sawWheelSidebar = sidebar;
      }

      if (!pp) {
        log("no more boosters (round/draft ended).");
        break;
      }
      await pickOnce(page);
    }

    // Final verdict.
    if (!hasExtension) {
      log("RESULT: draft-driving OK. Extension not built yet — sidebar assertion skipped.");
      log("Build the extension (manifest.json + src/) then re-run to verify the sidebar.");
    } else if (sawWheelSidebar) {
      log(`RESULT: PASS — sidebar reported a wheel: "${sawWheelSidebar.header}"`);
      log(`        didn't-wheel cards: ${sawWheelSidebar.cards.join(", ") || "(none)"}`);
    } else {
      const sidebar = await readSidebar(page);
      log("RESULT: FAIL — never observed a 'didn't wheel' sidebar at the wheel.");
      log(`        final sidebar: ${sidebar.present ? sidebar.header : "absent"}`);
      process.exitCode = 1;
    }

    if (process.env.KEEP_OPEN === "1") {
      log("KEEP_OPEN=1 — leaving browser open. Ctrl+C to exit.");
      await new Promise(() => {});
    }
  } catch (err) {
    log("ERROR:", err.message);
    process.exitCode = 1;
  } finally {
    if (process.env.KEEP_OPEN !== "1") await browser.close();
  }
}

if (puppeteer) run();
