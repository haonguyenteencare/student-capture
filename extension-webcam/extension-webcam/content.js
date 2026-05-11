(() => {
  const MAX_EVENTS = 80;

  const updateStorage = async (event) => {
    await chrome.runtime.sendMessage({ type: "raw-data-event", event });

    if (event.type === "media-recording" || event.type === "audio-recording") {
      return;
    }

    const current = await chrome.storage.local.get({ events: [] });
    const eventForStorage = {
      ...event,
      payload: {
        ...event.payload,
      },
    };

    delete eventForStorage.payload.rgbaDataUrl;

    const events = [eventForStorage, ...current.events].slice(0, MAX_EVENTS);
    await chrome.storage.local.set({ events, latestEvent: event });
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    if (!event.data || event.data.source !== "meet-raw-data-poc") {
      return;
    }

    updateStorage({
      type: event.data.type,
      payload: event.data.payload,
      at: event.data.at,
      pageUrl: window.location.href,
    }).catch(() => {});
  });

  window.addEventListener("pagehide", () => {
    chrome.runtime.sendMessage({ type: "session-ended" }).catch(() => {});
  });
})();
