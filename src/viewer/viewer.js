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
  let viewedDraftId = null; // draftId of the history entry currently open
  let currentSideboard = []; // uniqueIDs in the open draft's sideboard
  let tableReads = {}; // seatName -> Set of guessed WUBRG color letters ("Read the Table")

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
        uniqueID: c.uniqueID,
        cmc: d ? d.cmc : 0,
        colors: d ? d.colors : [],
        typeLine: d ? d.typeLine : "",
        manaCost: d ? d.manaCost : "",
        producedMana: d ? d.producedMana : [],
        oracleText: d ? d.oracleText : "",
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

  function renderStats(maindeckEnriched, sideboardCount) {
    const el = $("dmw-stats");
    el.innerHTML = "";
    const s = DeckStats.computeStats(maindeckEnriched);

    const block = (headText, subLines) => {
      const b = document.createElement("div");
      b.className = "dmw-stat-block";
      const h = document.createElement("div");
      h.className = "dmw-stat-head";
      h.textContent = headText;
      b.appendChild(h);
      for (const line of subLines) {
        const d = document.createElement("div");
        d.className = "dmw-stat-sub";
        d.textContent = line;
        b.appendChild(d);
      }
      return b;
    };

    el.appendChild(
      block(`Maindeck: ${s.total}`, [
        `${s.creatures} creatures · ${s.spells} spells · ${s.lands} lands`,
        sideboardCount > 0 ? `Sideboard: ${sideboardCount}` : "",
      ].filter(Boolean))
    );

    const pipLine = ["W", "U", "B", "R", "G"].filter((c) => s.pips[c] > 0).map((c) => `${c} ${s.pips[c]}`).join(" · ");
    el.appendChild(block("Color pips", [pipLine || "—"]));

    const srcColors = Object.keys(s.sources);
    const srcSub = srcColors.length
      ? srcColors.map((c) => `${c}: ${s.sources[c].max} (${s.sources[c].top.map((t) => `${t.name} ${t.sources}`).join(", ")})`)
      : ["—"];
    el.appendChild(block("Sources needed (40-card)", srcSub));

    const report = ManaReport.manaReportLines(maindeckEnriched, s);
    el.appendChild(block(`Mana (lands): ${report.lands}`, report.lines));

    const typeLine = Object.keys(s.types).filter((t) => s.types[t] > 0).map((t) => `${t} ${s.types[t]}`).join(" · ");
    el.appendChild(block("Types", [typeLine || "—"]));
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

  // --- "Read the Table" panel ---------------------------------------------
  // Other seats' cards never go through Scryfall (only the viewer's own log
  // is fetched), so DMW_TABLE picks/keyCards carry their own img/cmc/type —
  // build elements straight from those embedded fields instead of dataFor/cardEl.
  function tableCardEl(card) {
    const div = document.createElement("div");
    div.className = "dmw-card";
    if (card.img) {
      const img = document.createElement("img");
      img.src = card.img;
      img.alt = card.name;
      img.loading = "lazy";
      div.appendChild(img);
    } else {
      const span = document.createElement("span");
      span.className = "dmw-cardname";
      span.textContent = card.name || "";
      div.appendChild(span);
    }
    return div;
  }

  function guessSetFor(name) {
    if (!tableReads[name]) tableReads[name] = new Set();
    return tableReads[name];
  }

  function renderTableGuessBody() {
    const body = $("dmw-table-body");
    body.innerHTML = "";
    const seats = (window.DMW_TABLE && window.DMW_TABLE.seats) || [];
    seats.forEach((seat) => {
      const row = document.createElement("div");
      row.className = "dmw-seat-row";
      const name = document.createElement("span");
      name.className = "dmw-seat-name";
      name.textContent = seat.name;
      row.appendChild(name);
      const toggles = document.createElement("span");
      toggles.className = "dmw-color-toggles";
      const set = guessSetFor(seat.name);
      TableRead.COLORS.forEach((col) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "dmw-color-btn dmw-color-" + col;
        btn.textContent = col;
        btn.classList.toggle("dmw-active", set.has(col));
        btn.addEventListener("click", () => {
          if (set.has(col)) set.delete(col);
          else set.add(col);
          btn.classList.toggle("dmw-active", set.has(col));
        });
        toggles.appendChild(btn);
      });
      row.appendChild(toggles);
      body.appendChild(row);
    });
  }

  // Nonzero WUBRG counts, formatted "7G · 3R · 1U" (count desc, WUBRG tiebreak).
  function formatColorCounts(counts) {
    return TableRead.COLORS.map((c) => ({ c, n: counts[c] || 0 }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || TableRead.COLORS.indexOf(a.c) - TableRead.COLORS.indexOf(b.c))
      .map((x) => `${x.n}${x.c}`)
      .join(" · ");
  }

  function renderTablePool(seatName, pool) {
    const el = $("dmw-table-pool");
    el.innerHTML = "";
    el.hidden = false;
    const head = document.createElement("div");
    head.className = "dmw-col-head";
    head.textContent = `${seatName}'s pool (${pool.length})`;
    el.appendChild(head);
    const cols = document.createElement("div");
    cols.className = "dmw-cols";
    // columnize only reads name/cmc/colors/typeLine to group+sort; carry `img`
    // through unused by it so tableCardEl can still render the embedded art.
    const enriched = pool.map((c) => ({ name: c.name, cmc: c.cmc, colors: c.colors || [], typeLine: c.type || "", img: c.img }));
    DeckLayout.columnize(enriched, "cmc").forEach((col) => {
      const colEl = document.createElement("div");
      colEl.className = "dmw-col";
      const h = document.createElement("div");
      h.className = "dmw-col-head";
      h.textContent = `${col.label} (${col.cards.length})`;
      colEl.appendChild(h);
      const stack = document.createElement("div");
      stack.className = "dmw-stack";
      col.cards.forEach((c) => stack.appendChild(tableCardEl(c)));
      colEl.appendChild(stack);
      cols.appendChild(colEl);
    });
    el.appendChild(cols);
  }

  function renderTableReveal() {
    if (!replay) return;
    const step = replay.steps[stepIndex];
    const body = $("dmw-table-body");
    body.innerHTML = "";
    $("dmw-table-pool").hidden = true;
    $("dmw-table-pool").innerHTML = "";
    const seats = (window.DMW_TABLE && window.DMW_TABLE.seats) || [];
    seats.forEach((seat) => {
      const s = TableRead.seatStateThrough(seat, step.packNum, step.pickNum, 4);
      const row = document.createElement("div");
      row.className = "dmw-seat-row dmw-seat-reveal";

      const head = document.createElement("div");
      head.className = "dmw-seat-reveal-head";
      const name = document.createElement("span");
      name.className = "dmw-seat-name";
      name.textContent = seat.name;
      head.appendChild(name);

      const guessSet = tableReads[seat.name] || new Set();
      const guessText = TableRead.COLORS.filter((c) => guessSet.has(c)).join("") || "—";
      const guess = document.createElement("span");
      guess.className = "dmw-seat-guess";
      guess.textContent = `guess: ${guessText}`;
      head.appendChild(guess);

      const actual = document.createElement("span");
      actual.className = "dmw-seat-actual";
      actual.textContent = formatColorCounts(s.colorCounts) || "—";
      head.appendChild(actual);

      row.appendChild(head);

      const keyRow = document.createElement("div");
      keyRow.className = "dmw-grid dmw-seat-keycards";
      s.keyCards.forEach((c) => keyRow.appendChild(tableCardEl(c)));
      row.appendChild(keyRow);

      const poolBtn = document.createElement("button");
      poolBtn.type = "button";
      poolBtn.className = "dmw-seat-pool-btn";
      poolBtn.textContent = "see pool ▸";
      poolBtn.addEventListener("click", () => renderTablePool(seat.name, s.pool));
      row.appendChild(poolBtn);

      body.appendChild(row);
    });
  }

  function closeTablePanel() {
    $("dmw-table-toggle").hidden = false;
    $("dmw-table-reveal").hidden = true;
    $("dmw-table-close").hidden = true;
    $("dmw-table-body").hidden = true;
    $("dmw-table-body").innerHTML = "";
    $("dmw-table-pool").hidden = true;
    $("dmw-table-pool").innerHTML = "";
  }

  function openTablePanel() {
    $("dmw-table-toggle").hidden = true;
    $("dmw-table-reveal").hidden = false;
    $("dmw-table-close").hidden = false;
    $("dmw-table-body").hidden = false;
    renderTableGuessBody();
  }

  function updateTableVisibility() {
    const hasTable =
      window.DMW_TABLE && Array.isArray(window.DMW_TABLE.seats) && window.DMW_TABLE.seats.length > 0;
    $("dmw-table-section").hidden = !hasTable;
  }

  function renderStep() {
    const step = replay.steps[stepIndex];
    updateTableVisibility();
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

    const sideSet = new Set(currentSideboard);
    const maindeck = step.deckSoFar.filter((c) => !sideSet.has(c.uniqueID));
    $("dmw-deck-title").textContent = `Your deck so far (${maindeck.length})`;
    renderStats(enrichDeck(maindeck), step.deckSoFar.length - maindeck.length);
    renderDeck(maindeck);
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
    viewedDraftId = null;
    currentSideboard = []; // external pasted logs have no sideboard data
    stepIndex = 0;
    revealed = false;
    cardData = new Map();
    tableReads = {};
    closeTablePanel();
    $("dmw-landing").hidden = true;
    $("dmw-replay").hidden = false;
    renderStep();
    await loadCardData();
    renderStep();
  }

  function openDraft(draftId) {
    $("dmw-error").textContent = "";
    const area = storageLocal();
    if (!area) {
      $("dmw-error").textContent = "Storage unavailable.";
      return;
    }
    area.get("dmwDrafts", async (data) => {
      const list = Array.isArray(data.dmwDrafts) ? data.dmwDrafts : [];
      const draft = DraftHistory.findById(list, draftId);
      if (!draft || !draft.picks || draft.picks.length === 0) {
        $("dmw-error").textContent = "That draft is no longer available.";
        refreshHistory();
        return;
      }
      viewedDraftId = draftId;
      currentSideboard = Array.isArray(draft.sideboard) ? draft.sideboard : [];
      following = !!(list[0] && list[0].draftId === draftId); // only the current (newest) draft live-follows
      replay = buildReplay(draft);
      stepIndex = replay.steps.length - 1; // jump to the latest pick
      revealed = false;
      cardData = new Map();
      tableReads = {};
      closeTablePanel();
      $("dmw-landing").hidden = true;
      $("dmw-replay").hidden = false;
      renderStep();
      await loadCardData();
      renderStep();
    });
  }

  function onDraftsChanged(changes, area) {
    if (area !== "local" || !changes.dmwDrafts) return;
    refreshHistory(); // keep the landing list current as drafts are captured
    if (!following || !replay || viewedDraftId == null) return;
    const list = changes.dmwDrafts.newValue;
    if (!Array.isArray(list) || list.length === 0) return;
    if (!list[0] || list[0].draftId !== viewedDraftId) {
      following = false; // a newer draft started — the one we're viewing is now archived
      return;
    }
    const draft = list[0];
    if (!draft.picks || draft.picks.length === 0) return;
    currentSideboard = Array.isArray(draft.sideboard) ? draft.sideboard : [];
    const wasAtEnd = stepIndex === replay.steps.length - 1;
    replay = buildReplay(draft);
    stepIndex = wasAtEnd ? replay.steps.length - 1 : Math.min(stepIndex, replay.steps.length - 1);
    renderStep();
    loadCardData().then(renderStep);
  }

  function refreshHistory() {
    const container = $("dmw-history");
    const area = storageLocal();
    if (!area) {
      container.textContent = "Storage unavailable.";
      return;
    }
    area.get("dmwDrafts", (data) => {
      const list = Array.isArray(data.dmwDrafts) ? data.dmwDrafts : [];
      container.innerHTML = "";
      if (list.length === 0) {
        const empty = document.createElement("div");
        empty.className = "dmw-empty";
        empty.textContent = "No captured drafts yet — draft on draftmancer.com first.";
        container.appendChild(empty);
        return;
      }
      list.forEach((draft, i) => {
        const row = document.createElement("button");
        row.className = "dmw-history-row";
        const when = new Date(draft.capturedAt || 0).toLocaleString();
        const n = (draft.picks && draft.picks.length) || 0;
        row.textContent = `${i === 0 ? "● current — " : ""}${when} · ${n} picks`;
        row.addEventListener("click", () => openDraft(draft.draftId));
        container.appendChild(row);
      });
    });
  }

  // When opened via the sidebar's "Open replay" button (viewer.html?open=current),
  // jump straight to the newest captured draft instead of the landing list.
  function maybeAutoOpen() {
    let params;
    try {
      params = new URLSearchParams(location.search);
    } catch (_e) {
      return;
    }
    if (params.get("open") !== "current") return;
    const area = storageLocal();
    if (!area) return;
    area.get("dmwDrafts", (data) => {
      const list = Array.isArray(data.dmwDrafts) ? data.dmwDrafts : [];
      if (list.length && list[0] && list[0].draftId != null) openDraft(list[0].draftId);
    });
  }

  function init() {
    try {
      const v = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().version;
      if (v) $("dmw-version").textContent = "v" + v;
    } catch (_e) {
      /* ignore */
    }
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
    refreshHistory();
    const area = (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) || null;
    if (area) chrome.storage.onChanged.addListener(onDraftsChanged);
    $("dmw-back").addEventListener("click", () => {
      following = false; // returning to the list stops live-follow
      viewedDraftId = null;
      $("dmw-replay").hidden = true;
      $("dmw-landing").hidden = false;
      refreshHistory();
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
    $("dmw-table-toggle").addEventListener("click", openTablePanel);
    $("dmw-table-reveal").addEventListener("click", renderTableReveal);
    $("dmw-table-close").addEventListener("click", closeTablePanel);
    maybeAutoOpen();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
