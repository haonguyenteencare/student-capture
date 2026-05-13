(() => {
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "meet-poc") return;
    chrome.runtime.sendMessage({ type: "poc-event", event: e.data }).catch(() => {});
  });

  window.addEventListener("pagehide", () =>
    chrome.runtime.sendMessage({ type: "session-ended" }).catch(() => {}),
  );
})();
