// Wires the viewer page: input -> parse -> build replay -> fetch card data ->
// render booster / didn't-wheel / deck-curve with prev/next + arrow-key nav.
(function () {
  let replay = null; // { player, steps }
  let stepIndex = 0;
  let cardData = new Map(); // nameLowercased -> { imageUrl, cmc, colors, typeLine, name }
  let hidePick = Prefs.DEFAULTS.hidePick; // "Hide my pick" (persisted)
  let revealed = false; // whether the current step's pick has been revealed
  let deckSort = Prefs.DEFAULTS.deckSort; // "cmc" | "color" (persisted)
  let splitCreatures = Prefs.DEFAULTS.splitCreatures; // (persisted)
  let following = false; // viewer is tracking the live-captured draft

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

  function storageLocal() {
    return (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) || null;
  }

  // Fetch Scryfall data only for cards not already cached, merging into cardData.
  async function loadCardData() {
    const all = [];
    for (const s of replay.steps) for (const c of s.cards) all.push(c);
    const missing = Scryfall.filterUnknown(all, cardData);
    if (missing.length === 0) {
      $("dmw-notice").textContent = "";
      return;
    }
    $("dmw-notice").textContent = "Loading card images…";
    try {
      const more = await Scryfall.fetchCardData(missing);
      for (const [k, v] of more) cardData.set(k, v);
      $("dmw-notice").textContent = "";
    } catch (e) {
      $("dmw-notice").textContent = "Card images unavailable (Scryfall fetch failed) — showing names.";
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
    following = false; // loading an external log exits follow mode
    stepIndex = 0;
    revealed = false;
    cardData = new Map();
    $("dmw-landing").hidden = true;
    $("dmw-replay").hidden = false;
    renderStep();
    await loadCardData();
    renderStep();
  }

  function loadLastDraft() {
    $("dmw-error").textContent = "";
    const area = storageLocal();
    if (!area) {
      $("dmw-error").textContent = "Storage unavailable.";
      return;
    }
    area.get("dmwLastDraft", async (data) => {
      const draft = data && data.dmwLastDraft;
      if (!draft || !draft.picks || draft.picks.length === 0) {
        $("dmw-error").textContent = "No saved draft yet — draft on draftmancer.com first.";
        return;
      }
      following = true;
      replay = buildReplay(draft);
      stepIndex = replay.steps.length - 1; // jump to the latest pick
      revealed = false;
      cardData = new Map();
      $("dmw-landing").hidden = true;
      $("dmw-replay").hidden = false;
      renderStep();
      await loadCardData();
      renderStep();
    });
  }

  function onLastDraftChanged(changes, area) {
    if (area !== "local" || !changes.dmwLastDraft || !following || !replay) return;
    const draft = changes.dmwLastDraft.newValue;
    if (!draft || !draft.picks || draft.picks.length === 0) return;
    const wasAtEnd = stepIndex === replay.steps.length - 1;
    replay = buildReplay(draft);
    stepIndex = wasAtEnd ? replay.steps.length - 1 : Math.min(stepIndex, replay.steps.length - 1);
    renderStep();
    loadCardData().then(renderStep);
  }

  function refreshLastDraftButton() {
    const btn = $("dmw-load-last");
    const area = storageLocal();
    if (!area) {
      btn.disabled = true;
      btn.textContent = "Load my last draft (unavailable)";
      return;
    }
    area.get("dmwLastDraft", (data) => {
      const d = data && data.dmwLastDraft;
      if (d && d.picks && d.picks.length) {
        const when = new Date(d.capturedAt || 0).toLocaleString();
        btn.disabled = false;
        btn.textContent = `Load my last draft — ${when} · ${d.picks.length} picks`;
      } else {
        btn.disabled = true;
        btn.textContent = "Load my last draft (none captured yet)";
      }
    });
  }

  function init() {
    Prefs.loadPrefs((prefs) => {
      hidePick = prefs.hidePick;
      deckSort = prefs.deckSort;
      splitCreatures = prefs.splitCreatures;
      $("dmw-hidepick").checked = hidePick;
      $("dmw-split").checked = splitCreatures;
      $("dmw-sort-cmc").classList.toggle("dmw-active", deckSort === "cmc");
      $("dmw-sort-color").classList.toggle("dmw-active", deckSort === "color");
      if (replay) renderStep();
    });
    $("dmw-load").addEventListener("click", () => {
      const file = $("dmw-file").files[0];
      if (file) file.text().then(load).catch((e) => ($("dmw-error").textContent = e.message));
      else load($("dmw-paste").value || "");
    });
    $("dmw-load-last").addEventListener("click", loadLastDraft);
    refreshLastDraftButton();
    const area = (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) || null;
    if (area) chrome.storage.onChanged.addListener(onLastDraftChanged);
    $("dmw-prev").addEventListener("click", () => go(-1));
    $("dmw-next").addEventListener("click", () => go(1));
    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    });
    $("dmw-hidepick").addEventListener("change", (e) => {
      hidePick = e.target.checked;
      revealed = false; // re-hide on toggle
      Prefs.savePref("hidePick", hidePick);
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
      Prefs.savePref("deckSort", mode);
      if (replay) renderStep();
    }
    $("dmw-sort-cmc").addEventListener("click", () => setSort("cmc"));
    $("dmw-sort-color").addEventListener("click", () => setSort("color"));
    $("dmw-split").addEventListener("change", (e) => {
      splitCreatures = e.target.checked;
      Prefs.savePref("splitCreatures", splitCreatures);
      if (replay) renderStep();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
