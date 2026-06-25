// Isolated content-script world. Listens for draft events forwarded by the
// MAIN-world injector (src/inject.js, loaded at document_start), runs the wheel
// tracker, and renders the sidebar.
(function () {
  // Wheel tracker (createWheelTracker is a content-script global from wheel-core.js).
  const tracker = createWheelTracker();

  // Draft capture (createDraftCapture is a content-script global from capture.js).
  const capture = createDraftCapture();
  let sawCleanStart = false;
  let currentDraftId = null;
  function persistDraft() {
    try {
      const area = (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) || null;
      if (!area) return;
      const entry = Object.assign({ draftId: currentDraftId, capturedAt: Date.now() }, capture.getDraft());
      area.get(["dmwDrafts", "dmwLastDraft"], (data) => {
        try {
          let list = Array.isArray(data.dmwDrafts) ? data.dmwDrafts : [];
          // one-time migration: seed the list from a legacy single-slot capture
          if (list.length === 0 && data.dmwLastDraft && data.dmwLastDraft.picks && data.dmwLastDraft.picks.length) {
            const legacy = data.dmwLastDraft;
            list = [Object.assign({ draftId: legacy.capturedAt || 0 }, legacy)];
          }
          area.set({ dmwDrafts: DraftHistory.upsertCurrent(list, entry, 3) });
        } catch (_e) {
          /* never break the sidebar (async callback) */
        }
      });
    } catch (_e) {
      /* never break the sidebar */
    }
  }

  // 3. Sidebar.
  let root = null;
  let body = null;
  let header = null;

  function ensureSidebar() {
    if (root) return;
    root = document.createElement("div");
    root.id = "dmw-sidebar";
    header = document.createElement("div");
    header.className = "dmw-header";
    header.addEventListener("click", () => root.classList.toggle("dmw-collapsed"));
    body = document.createElement("div");
    body.className = "dmw-body";
    root.appendChild(header);
    root.appendChild(body);
    document.body.appendChild(root);
  }

  function imageUrl(card) {
    const u = card.image_uris || {};
    return u.en || Object.values(u)[0] || "";
  }

  function render(result) {
    ensureSidebar();
    if (!result || result.active === false) {
      header.textContent = "Didn't Wheel";
      body.innerHTML = '<div class="dmw-empty">Waiting for a pack…</div>';
      return;
    }
    if (!result.isWheel) {
      header.textContent = "Pack " + (result.boosterNumber + 1) + " — first pass";
      body.innerHTML = '<div class="dmw-empty">First pass — nothing to compare yet.</div>';
      return;
    }
    header.textContent = "Pack " + (result.boosterNumber + 1) + " — didn't wheel (" + result.didntWheel.length + ")";
    if (result.didntWheel.length === 0) {
      body.innerHTML = '<div class="dmw-empty">Everything you passed wheeled back!</div>';
      return;
    }
    const grid = document.createElement("div");
    grid.className = "dmw-grid";
    for (const card of result.didntWheel) {
      const cell = document.createElement("div");
      cell.className = "dmw-card";
      const img = document.createElement("img");
      img.src = imageUrl(card);
      img.alt = card.name || "";
      img.loading = "lazy";
      const label = document.createElement("span");
      label.textContent = card.name || "";
      cell.appendChild(img);
      cell.appendChild(label);
      grid.appendChild(cell);
    }
    body.innerHTML = "";
    body.appendChild(grid);
  }

  // 4. Receive forwarded events.
  window.addEventListener("message", (ev) => {
    if (ev.origin !== window.location.origin) return;
    if (ev.source !== window) return;
    const msg = ev.data;
    if (!msg || msg.source !== "dm-wheel") return;
    if (msg.event === "draftState") {
      render(tracker.handleDraftState(msg.args[0]));
      try {
        const ds = msg.args[0];
        if (ds && ds.boosterNumber === 0 && ds.pickNumber === 0) {
          sawCleanStart = true;
          currentDraftId = Date.now(); // stable id for this draft (start time)
        }
        capture.onDraftState(ds);
      } catch (_e) { /* ignore */ }
    } else if (msg.event === "rejoinDraft") {
      const data = msg.args[0] || {};
      render(tracker.handleRejoin(data.state || {}));
      try {
        capture.onDraftState(data.state || {});
        capture.onRejoinZones(data.pickedCards);
      } catch (_e) { /* ignore */ }
    } else if (msg.event === "pickCard") {
      tracker.handlePickCard(msg.args[0]);
      try { capture.onPickCard(msg.args[0]); if (sawCleanStart) persistDraft(); } catch (_e) { /* ignore */ }
    } else if (msg.event === "moveCard") {
      try { capture.onMoveCard(msg.args[0], msg.args[1]); if (sawCleanStart) persistDraft(); } catch (_e) { /* ignore */ }
    } else if (msg.event === "moveAllToSideboard") {
      try { capture.onMoveAllToSideboard(); if (sawCleanStart) persistDraft(); } catch (_e) { /* ignore */ }
    } else if (msg.event === "swapDeckAndSideboard") {
      try { capture.onSwapDeckAndSideboard(); if (sawCleanStart) persistDraft(); } catch (_e) { /* ignore */ }
    }
  });
})();
