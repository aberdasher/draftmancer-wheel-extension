// Wires the viewer page: input -> parse -> build replay -> fetch card data ->
// render booster / didn't-wheel / deck-curve with prev/next + arrow-key nav.
(function () {
  let replay = null; // { player, steps }
  let stepIndex = 0;
  let cardData = new Map(); // nameLowercased -> { imageUrl, cmc, colors, typeLine, name }
  let hidePick = false; // "Hide my pick" toggle
  let revealed = false; // whether the current step's pick has been revealed
  let deckSort = "cmc"; // "cmc" | "color"
  let splitCreatures = false;

  const $ = (id) => document.getElementById(id);

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

  // Merge a deck card ref with its Scryfall data so DeckLayout can group it.
  function enrichDeck(deck) {
    return deck.map((c) => {
      const d = dataFor(c.name);
      return {
        name: c.name,
        set: c.set,
        collector: c.collector,
        cmc: d ? d.cmc : 0,
        colors: d ? d.colors : [],
        typeLine: d ? d.typeLine : "",
      };
    });
  }

  function renderColumns(container, cards) {
    for (const col of DeckLayout.columnize(cards, deckSort)) {
      const colEl = document.createElement("div");
      colEl.className = "dmw-col";
      const head = document.createElement("div");
      head.className = "dmw-col-head";
      head.textContent = `${col.label} (${col.cards.length})`;
      colEl.appendChild(head);
      const stack = document.createElement("div");
      stack.className = "dmw-stack";
      col.cards.forEach((c) => stack.appendChild(cardEl(c, false)));
      colEl.appendChild(stack);
      container.appendChild(colEl);
    }
  }

  function renderDeck(deck) {
    const enriched = enrichDeck(deck);
    const root = $("dmw-deck");
    root.innerHTML = "";
    if (splitCreatures) {
      const { creatures, others } = DeckLayout.splitByCreature(enriched);
      for (const [label, group] of [["Creatures", creatures], ["Non-creatures", others]]) {
        const row = document.createElement("div");
        row.className = "dmw-deck-row";
        const h = document.createElement("div");
        h.className = "dmw-row-head";
        h.textContent = `${label} (${group.length})`;
        row.appendChild(h);
        const cols = document.createElement("div");
        cols.className = "dmw-cols";
        renderColumns(cols, group);
        row.appendChild(cols);
        root.appendChild(row);
      }
    } else {
      const cols = document.createElement("div");
      cols.className = "dmw-cols";
      renderColumns(cols, enriched);
      root.appendChild(cols);
    }
  }

  function renderStep() {
    const step = replay.steps[stepIndex];
    $("dmw-position").textContent = `Pack ${step.packNum} · Pick ${step.pickNum} (${stepIndex + 1}/${replay.steps.length})`;
    $("dmw-prev").disabled = stepIndex === 0;
    $("dmw-next").disabled = stepIndex === replay.steps.length - 1;

    const showPick = !hidePick || revealed;
    const booster = $("dmw-booster");
    booster.innerHTML = "";
    step.cards.forEach((c) => booster.appendChild(cardEl(c, c.picked && showPick)));
    $("dmw-reveal").hidden = !(hidePick && !revealed);

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
    renderDeck(step.deckSoFar);
  }

  function go(delta) {
    if (!replay) return;
    const n = Math.min(replay.steps.length - 1, Math.max(0, stepIndex + delta));
    if (n !== stepIndex) {
      stepIndex = n;
      revealed = false;
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
    revealed = false;
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
      if (file) file.text().then(load).catch((e) => ($("dmw-error").textContent = e.message));
      else load($("dmw-paste").value || "");
    });
    $("dmw-prev").addEventListener("click", () => go(-1));
    $("dmw-next").addEventListener("click", () => go(1));
    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    });
    $("dmw-hidepick").addEventListener("change", (e) => {
      hidePick = e.target.checked;
      revealed = false; // re-hide on toggle
      if (replay) renderStep();
    });
    $("dmw-reveal").addEventListener("click", () => {
      if (!replay) return;
      revealed = true;
      renderStep();
    });
    function setSort(mode) {
      deckSort = mode;
      $("dmw-sort-cmc").classList.toggle("dmw-active", mode === "cmc");
      $("dmw-sort-color").classList.toggle("dmw-active", mode === "color");
      if (replay) renderStep();
    }
    $("dmw-sort-cmc").addEventListener("click", () => setSort("cmc"));
    $("dmw-sort-color").addEventListener("click", () => setSort("color"));
    $("dmw-split").addEventListener("change", (e) => {
      splitCreatures = e.target.checked;
      if (replay) renderStep();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
