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
