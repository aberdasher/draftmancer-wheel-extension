// Wires the viewer page: input -> parse -> build replay -> fetch card data ->
// render booster / didn't-wheel / deck-curve with prev/next + arrow-key nav.
(function () {
  let replay = null; // { player, steps }
  let stepIndex = 0;
  let cardData = new Map(); // nameLowercased -> { imageUrl, cmc, colors, typeLine, name }

  const $ = (id) => document.getElementById(id);
  const COLUMNS = ["0", "1", "2", "3", "4", "5", "6+"];

  function dataFor(name) {
    return cardData.get(name.toLowerCase());
  }

  function cardEl(card, picked) {
    const div = document.createElement("div");
    div.className = "dmw-card" + (picked ? " dmw-picked" : "");
    const d = dataFor(card.name);
    if (d && d.imageUrl) {
      const img = document.createElement("img");
      img.src = d.imageUrl;
      img.alt = card.name;
      img.loading = "lazy";
      div.appendChild(img);
    } else {
      const span = document.createElement("span");
      span.className = "dmw-cardname";
      span.textContent = card.name;
      div.appendChild(span);
    }
    return div;
  }

  function columnFor(name) {
    const d = dataFor(name);
    if (!d) return "?";
    if (d.cmc >= 6) return "6+";
    return String(Math.floor(d.cmc));
  }

  function renderCurve(deck) {
    const curve = $("dmw-curve");
    curve.innerHTML = "";
    const cols = {};
    for (const label of COLUMNS) cols[label] = [];
    const unknown = [];
    for (const c of deck) {
      const col = columnFor(c.name);
      if (col === "?") unknown.push(c);
      else cols[col].push(c);
    }
    const labels = unknown.length ? COLUMNS.concat(["?"]) : COLUMNS;
    for (const label of labels) {
      const list = label === "?" ? unknown : cols[label];
      const colEl = document.createElement("div");
      colEl.className = "dmw-col";
      const head = document.createElement("div");
      head.className = "dmw-col-head";
      head.textContent = `${label} (${list.length})`;
      colEl.appendChild(head);
      list.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((c) => colEl.appendChild(cardEl(c, false)));
      curve.appendChild(colEl);
    }
  }

  function renderStep() {
    const step = replay.steps[stepIndex];
    $("dmw-position").textContent = `Pack ${step.packNum} · Pick ${step.pickNum}  (${stepIndex + 1}/${replay.steps.length})`;
    $("dmw-prev").disabled = stepIndex === 0;
    $("dmw-next").disabled = stepIndex === replay.steps.length - 1;

    const booster = $("dmw-booster");
    booster.innerHTML = "";
    step.cards.forEach((c) => booster.appendChild(cardEl(c, c.picked)));

    const ws = $("dmw-wheel-section");
    if (step.didntWheel) {
      ws.hidden = false;
      $("dmw-wheel-title").textContent = step.didntWheel.length
        ? `Didn't wheel (${step.didntWheel.length})`
        : "Didn't wheel (0) — everything you passed wheeled back";
      const w = $("dmw-wheel");
      w.innerHTML = "";
      step.didntWheel.forEach((c) => w.appendChild(cardEl(c, false)));
    } else {
      ws.hidden = true;
    }

    $("dmw-deck-title").textContent = `Your deck so far (${step.deckSoFar.length})`;
    renderCurve(step.deckSoFar);
  }

  function go(delta) {
    if (!replay) return;
    const n = Math.min(replay.steps.length - 1, Math.max(0, stepIndex + delta));
    if (n !== stepIndex) {
      stepIndex = n;
      renderStep();
    }
  }

  async function load(text) {
    $("dmw-error").textContent = "";
    let parsed;
    try {
      parsed = parseDraftLog(text);
      replay = buildReplay(parsed);
    } catch (e) {
      $("dmw-error").textContent = e.message;
      return;
    }
    stepIndex = 0;
    cardData = new Map();
    $("dmw-landing").hidden = true;
    $("dmw-replay").hidden = false;
    renderStep();

    $("dmw-notice").textContent = "Loading card images…";
    const all = [];
    for (const s of replay.steps) for (const c of s.cards) all.push(c);
    try {
      cardData = await Scryfall.fetchCardData(all);
      $("dmw-notice").textContent = "";
    } catch (e) {
      $("dmw-notice").textContent = "Card images unavailable (Scryfall fetch failed) — showing names.";
    }
    renderStep();
  }

  function init() {
    $("dmw-load").addEventListener("click", () => {
      const file = $("dmw-file").files[0];
      if (file) file.text().then(load);
      else load($("dmw-paste").value || "");
    });
    $("dmw-prev").addEventListener("click", () => go(-1));
    $("dmw-next").addEventListener("click", () => go(1));
    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
