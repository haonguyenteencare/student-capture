const eventsEl       = document.getElementById("events");
const statusEl       = document.getElementById("status");
const serverStatusEl = document.getElementById("serverStatus"); // null khi disabled
const queueBadgeEl   = document.getElementById("queueBadge");
const offlineWarning = document.getElementById("offline-warning");
const clearBtn       = document.getElementById("clear");
const exportBtn      = document.getElementById("export");        // null khi disabled
const viewerBtn      = document.getElementById("viewer");
const studentIdInput = document.getElementById("studentIdInput");
const saveIdentityBtn= document.getElementById("saveIdentity");
const identityStatus = document.getElementById("identityStatus");

const API      = "http://localhost:8787";
const DB_NAME  = "meet-poc-buffer";
const DB_VERSION = 1;

// ── Online / Offline indicator ────────────────────────────────────────────────
window.addEventListener("offline", () => { offlineWarning.style.display = "flex"; });
window.addEventListener("online",  () => { offlineWarning.style.display = "none"; });
if (!navigator.onLine) offlineWarning.style.display = "flex";

// ── Server ping ───────────────────────────────────────────────────────────────
// ❌ DISABLED: server.js chưa có endpoint GET /api/ping
// async function checkServer() {
//   try {
//     await fetch(`${API}/api/ping`, { signal: AbortSignal.timeout(2000) });
//     serverStatusEl.textContent = "✅ Server đang hoạt động";
//     serverStatusEl.style.color = "#4ade80";
//   } catch {
//     serverStatusEl.textContent = "❌ Server không kết nối được";
//     serverStatusEl.style.color = "#f87171";
//   }
// }

// ── IndexedDB queue count ─────────────────────────────────────────────────────
async function countQueue() {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) =>
        e.target.result.createObjectStore("chunks", { keyPath: "id", autoIncrement: true });
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = () => reject(req.error);
    });
    const count = await new Promise((resolve, reject) => {
      const req = db.transaction("chunks", "readonly").objectStore("chunks").count();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
    if (count > 0) {
      queueBadgeEl.textContent = `${count} chunk chờ gửi`;
      queueBadgeEl.style.display = "inline";
    } else {
      queueBadgeEl.style.display = "none";
    }
  } catch { /* ignore */ }
}

// ── Events từ storage (events nhỏ không có media) ────────────────────────────
const summarizeEvent = (event) => {
  if (event.type === "audio-chunk")  return `Audio chunk — ${event.payload?.sampleCount ?? "?"} samples @ ${event.payload?.sampleRate ?? "?"}Hz`;
  if (event.type === "video-frame")  return `Video frame — ${event.payload?.width}×${event.payload?.height}`;
  if (event.type === "webm-chunk")   return `WebM chunk`;
  if (event.type === "hook-ready")   return "Hook installed ✓";
  return event.type;
};

const renderEvents = async () => {
  const { events = [] } = await chrome.storage.local.get({ events: [] }).catch(() => ({ events: [] }));
  const { studentId }   = await chrome.storage.local.get({ studentId: null }).catch(() => ({}));

  if (studentId) {
    studentIdInput.value = studentId;
    if (studentId.startsWith("anon-")) {
      identityStatus.textContent = "Đang dùng ID ẩn danh. Hãy cập nhật ID thật.";
      identityStatus.style.color = "#fbbf24";
    } else {
      identityStatus.textContent = "Danh tính: " + studentId;
      identityStatus.style.color = "#4ade80";
    }
  }

  statusEl.textContent = events.length
    ? summarizeEvent(events[0])
    : "Mở Google Meet, cho phép camera/mic, rồi mở lại popup này.";

  eventsEl.textContent = "";
  for (const event of events) {
    const row   = document.createElement("article");
    row.className = "event";
    const title = document.createElement("div");
    title.className = "event-title";
    const type  = document.createElement("span");
    type.textContent = event.type;
    const time  = document.createElement("span");
    time.className = "time";
    time.textContent = new Date(event.at).toLocaleTimeString();
    title.append(type, time);
    row.append(title);

    if (event.payload?.thumbDataUrl) {
      const img = document.createElement("img");
      img.className = "thumbnail";
      img.src = event.payload.thumbDataUrl;
      row.append(img);
    }

    const pre = document.createElement("pre");
    const display = { ...event.payload };
    delete display.thumbDataUrl;
    delete display.rgbaBase64;
    delete display.dataBase64;
    pre.textContent = JSON.stringify(display, null, 2);
    row.append(pre);
    eventsEl.append(row);
  }
};

// ── Buttons ───────────────────────────────────────────────────────────────────
clearBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ events: [] }).catch(() => {});
  renderEvents();
});

// ❌ DISABLED: background.js chưa có handler cho message type "export-session"
// exportBtn.addEventListener("click", async () => {
//   const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
//   if (!tab?.id) { statusEl.textContent = "Không tìm thấy tab Meet."; return; }
//   const result = await chrome.runtime.sendMessage({ type: "export-session", tabId: tab.id }).catch(() => ({ ok: false }));
//   statusEl.textContent = result?.ok
//     ? `Đã export: ${result.filename}`
//     : "Export thất bại.";
// });

viewerBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
});

saveIdentityBtn.addEventListener("click", async () => {
  const newId = studentIdInput.value.trim();
  if (!newId) return;
  await chrome.storage.local.set({ studentId: newId }).catch(() => {});
  await chrome.runtime.sendMessage({ type: "identity-updated", studentId: newId }).catch(() => {});
  renderEvents();
});

// ── Refresh ───────────────────────────────────────────────────────────────────
async function refresh() {
  // checkServer() đã bị disabled — server chưa có /api/ping
  await Promise.all([countQueue(), renderEvents()]);
}

refresh();
setInterval(refresh, 3000);
