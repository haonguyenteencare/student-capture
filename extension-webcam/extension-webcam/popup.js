const eventsElement = document.querySelector("#events");
const statusElement = document.querySelector("#status");
const clearButton = document.querySelector("#clear");
const exportButton = document.querySelector("#export");
const viewerButton = document.querySelector("#viewer");

const summarizeEvent = (event) => {
  if (event.type === "video-frame") {
    return `Video frame ${event.payload.displayWidth}x${event.payload.displayHeight}, ${event.payload.format}, checksum ${event.payload.checksum}`;
  }

  if (event.type === "audio-samples") {
    return `Audio samples ${event.payload.sampleCount} @ ${event.payload.sampleRate}Hz, peak ${event.payload.peak}`;
  }

  if (event.type === "stream-captured") {
    return `Captured ${event.payload.tracks.length} local track(s)`;
  }

  return event.type;
};

const render = async () => {
  const { events = [] } = await chrome.storage.local.get({ events: [] });

  statusElement.textContent = events.length
    ? summarizeEvent(events[0])
    : "Open Google Meet, allow camera/mic, then open this popup again.";

  eventsElement.textContent = "";

  for (const event of events) {
    const row = document.createElement("article");
    row.className = "event";

    const title = document.createElement("div");
    title.className = "event-title";

    const type = document.createElement("span");
    type.textContent = event.type;

    const time = document.createElement("span");
    time.className = "time";
    time.textContent = new Date(event.at).toLocaleTimeString();

    const payload = document.createElement("pre");
    const payloadForDisplay = { ...event.payload };
    const thumbnailDataUrl = payloadForDisplay.thumbnailDataUrl;

    delete payloadForDisplay.thumbnailDataUrl;
    delete payloadForDisplay.dataUrl;
    delete payloadForDisplay.rgbaDataUrl;
    delete payloadForDisplay.samples;

    payload.textContent = JSON.stringify(payloadForDisplay, null, 2);

    title.append(type, time);
    row.append(title);

    if (thumbnailDataUrl) {
      const image = document.createElement("img");
      image.className = "thumbnail";
      image.src = thumbnailDataUrl;
      image.alt = "Video frame preview";
      row.append(image);
    }

    row.append(payload);
    eventsElement.append(row);
  }
};

clearButton.addEventListener("click", async () => {
  await chrome.storage.local.set({ events: [] });
  await render();
});

exportButton.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    statusElement.textContent = "No active Meet tab found.";
    return;
  }

  const result = await chrome.runtime.sendMessage({ type: "export-session", tabId: tab.id });

  statusElement.textContent = result.ok
    ? `Downloaded ${result.filename} with ${result.eventCount} event(s).`
    : `Export failed: ${result.reason}`;
});

viewerButton.addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.events) {
    render().catch(() => {});
  }
});

render().catch(() => {});
