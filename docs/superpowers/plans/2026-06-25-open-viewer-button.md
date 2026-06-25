# One-Click "Open Replay" Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Open replay ↗" button to the live sidebar on draftmancer.com that opens the viewer directly on the current draft.

**Architecture:** The sidebar button messages the background service worker (content scripts can't open tabs), which opens `viewer.html?open=current`; the viewer auto-opens the newest captured draft when that query param is present.

**Tech Stack:** Vanilla JS, Manifest V3, `chrome.runtime` messaging. No new dependencies, no unit-testable pure logic (browser glue verified by `node --check` + e2e).

## Global Constraints

- All viewer/sidebar DOM ids/classes are `dmw-` prefixed.
- The button's click/message is wrapped so it can never break the live "didn't wheel" sidebar.
- The toolbar `chrome.action.onClicked` handler is unchanged (opens `viewer.html` with no query → landing/history list).
- No new permission (`chrome.tabs` is usable from the background worker without `tabs` permission for `tabs.create`; `chrome.runtime` messaging needs no permission). No change to capture/stats logic.

---

### Task 1: Sidebar button + background message → open viewer tab

**Files:**
- Modify: `background.js` (add a `chrome.runtime.onMessage` listener)
- Modify: `src/content.js` (add the button in `ensureSidebar`)
- Modify: `src/sidebar.css` (button styling)

**Interfaces:**
- Consumes: nothing new.
- Produces: clicking the sidebar's `#dmw-open-replay` button opens a new tab at `viewer.html?open=current` (the viewer's auto-open is Task 2).

Browser glue verified by `node --check` + e2e (no unit test).

- [ ] **Step 1: Add the message listener to `background.js`**

The file currently is:

```js
// Opens the replay viewer in a new tab when the toolbar icon is clicked.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
});
```

Add a message listener below it:

```js
// Opens the replay viewer in a new tab when the toolbar icon is clicked.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
});

// The sidebar's "Open replay" button (content script) asks us to open the viewer
// on the current draft, since content scripts cannot open tabs themselves.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "openViewer") {
    chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html?open=current") });
  }
});
```

- [ ] **Step 2: Add the button in `src/content.js`'s `ensureSidebar`**

`ensureSidebar` currently builds the sidebar as `root` → `header` → `body`. NOTE: `render()` overwrites `header.textContent` and `body.innerHTML` on every update, so the button must be a direct child of `root` (a sibling of header/body), not inside them. The current function is:

```js
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
```

Change it to also append an "Open replay" button between the header and body:

```js
  function ensureSidebar() {
    if (root) return;
    root = document.createElement("div");
    root.id = "dmw-sidebar";
    header = document.createElement("div");
    header.className = "dmw-header";
    header.addEventListener("click", () => root.classList.toggle("dmw-collapsed"));
    const openBtn = document.createElement("button");
    openBtn.id = "dmw-open-replay";
    openBtn.textContent = "Open replay ↗";
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      try {
        chrome.runtime.sendMessage({ type: "openViewer" });
      } catch (_e) {
        /* never break the sidebar */
      }
    });
    body = document.createElement("div");
    body.className = "dmw-body";
    root.appendChild(header);
    root.appendChild(openBtn);
    root.appendChild(body);
    document.body.appendChild(root);
  }
```

- [ ] **Step 3: Style the button in `src/sidebar.css`**

Append:

```css
#dmw-open-replay {
  display: block;
  width: 100%;
  box-sizing: border-box;
  background: #2a6;
  color: #fff;
  border: 0;
  padding: 5px 8px;
  font-size: 12px;
  cursor: pointer;
}
#dmw-sidebar.dmw-collapsed #dmw-open-replay {
  display: none;
}
```

- [ ] **Step 4: Verify**

Run: `node --check background.js && node --check src/content.js`
Expected: exit 0.

Run: `npm test`
Expected: PASS — existing unit tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add background.js src/content.js src/sidebar.css
git commit -m "feat: sidebar 'Open replay' button opens the viewer via the background worker"
```

---

### Task 2: Viewer auto-opens the current draft on `?open=current`

**Files:**
- Modify: `src/viewer/viewer.js` (`init`)

**Interfaces:**
- Consumes: `storageLocal()`, `openDraft(draftId)`, `dmwDrafts` (existing in viewer.js).
- Produces: when the viewer page URL has `?open=current` and a draft is captured, it auto-opens `dmwDrafts[0]` (the newest) at the latest pick; otherwise the landing/history list shows as before.

Browser glue verified by `node --check` + e2e.

- [ ] **Step 1: Add `maybeAutoOpen` and call it from `init` in `src/viewer/viewer.js`**

Add this function (e.g. just above `function init()`):

```js
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
```

Then call it at the end of `init()`. The end of `init()` currently registers the split checkbox listener:

```js
    $("dmw-split").addEventListener("change", (e) => {
      splitCreatures = e.target.checked;
      Prefs.savePref("splitCreatures", splitCreatures);
      if (replay) renderStep();
    });
  }
```

Add the `maybeAutoOpen();` call as the last statement inside `init()` (after that listener, before the closing brace):

```js
    $("dmw-split").addEventListener("change", (e) => {
      splitCreatures = e.target.checked;
      Prefs.savePref("splitCreatures", splitCreatures);
      if (replay) renderStep();
    });
    maybeAutoOpen();
  }
```

- [ ] **Step 2: Verify**

Run: `node --check src/viewer/viewer.js`
Expected: exit 0.

Run: `npm test`
Expected: PASS — unit tests unaffected.

- [ ] **Step 3: End-to-end verification (controller-run)** (record results)

1. Reload the unpacked extension. Seed a draft (draft on draftmancer.com, or inject one into `chrome.storage.local.dmwDrafts`).
2. Load `viewer.html?open=current` — it should auto-open the newest draft at the latest pick (not the landing list).
3. Load `viewer.html` (no param) — it should show the landing/history list as before.
4. On draftmancer.com, click the sidebar's **"Open replay ↗"** button — a new tab opens directly on the current draft.
5. With no captured draft, `viewer.html?open=current` should land on the (empty) history list without error.

- [ ] **Step 4: Commit**

```bash
git add src/viewer/viewer.js
git commit -m "feat: viewer auto-opens the current draft on ?open=current"
```

---

## Notes for the implementer

- This feature is browser glue only — no pure logic to unit-test; the Task-2 e2e checklist is the verification.
- The button is a child of `root` (not `header`/`body`) because `render()` overwrites those; keep it there.
- Keep the `dmw-` prefix on the new id; do not change the capture, stats, history, or other modules.
