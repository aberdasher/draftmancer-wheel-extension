// Runs in the page's JS world. Wraps WebSocket to observe socket.io frames and
// forwards the relevant draft events to the content script via postMessage.
(function () {
  const FORWARD = new Set(["draftState", "rejoinDraft", "pickCard"]);

  function forward(data) {
    try {
      const parsed = globalThis.parseSocketIOFrame(data);
      if (parsed && FORWARD.has(parsed.event)) {
        window.postMessage({ source: "dm-wheel", event: parsed.event, args: parsed.args }, window.location.origin);
      }
    } catch (_e) {
      /* never throw into page code */
    }
  }

  const NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket) return;

  function WrappedWebSocket(url, protocols) {
    const ws = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);

    ws.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") forward(ev.data);
    });

    const nativeSend = ws.send;
    ws.send = function (data) {
      if (typeof data === "string") forward(data);
      return nativeSend.call(this, data);
    };

    return ws;
  }

  WrappedWebSocket.prototype = NativeWebSocket.prototype;
  WrappedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
  WrappedWebSocket.OPEN = NativeWebSocket.OPEN;
  WrappedWebSocket.CLOSING = NativeWebSocket.CLOSING;
  WrappedWebSocket.CLOSED = NativeWebSocket.CLOSED;

  window.WebSocket = WrappedWebSocket;
})();
