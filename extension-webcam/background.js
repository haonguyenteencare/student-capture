const API = "http://localhost:8787";
const sessions = new Map();
let serverOnline = true; // Trạng thái server, mặc định là online

// ─── Session ──────────────────────────────────────────────────────────────────
const getSession = (tabId, url) => {
  if (!sessions.has(tabId)) {
    let meetingId = "unknown";
    try {
      meetingId = new URL(url).pathname.split("/").filter(Boolean)[0] || "unknown";
    } catch {}

    sessions.set(tabId, {
      sessionId: `session-${Date.now()}-tab-${tabId}`,
      meetingId,
      studentId: `anon-${tabId}`,
    });
  }
  return sessions.get(tabId);
};

// ─── IndexedDB Buffer ────────────────────────────────────────────────────────
const DB_NAME = "meet-poc-buffer";
const DB_VERSION = 1;

const openDB = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore("chunks", { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });

const saveToBuffer = async (data) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("chunks", "readwrite");
    tx.objectStore("chunks").add({ ...data, savedAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
};

const flushBuffer = async () => {
  const db = await openDB();

  const all = await new Promise((resolve, reject) => {
    const tx = db.transaction("chunks", "readonly");
    const req = tx.objectStore("chunks").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (all.length === 0) return;

  for (const chunk of all) {
    try {
      const res = await fetch(`${API}/api/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Xóa khỏi buffer sau khi upload thành công
      await new Promise((resolve) => {
        const tx = db.transaction("chunks", "readwrite");
        tx.objectStore("chunks").delete(chunk.id);
        tx.oncomplete = resolve;
      });
    } catch {
      break; // Vẫn mất mạng hoặc server lỗi, thử lại lần sau
    }
  }
};

// ─── Message Handler ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "session-ended") {
    if (sender.tab?.id) sessions.delete(sender.tab.id);
    reply({ ok: true });
    return false;
  }

  if (msg.type !== "poc-event") return false;

  const tabId = sender.tab?.id;
  if (!tabId) { reply({ ok: false }); return false; }

  const session = getSession(tabId, msg.event.pageUrl || sender.tab.url || "https://meet.google.com/");
  const chunk = {
    ...session,
    type: msg.event.type,
    payload: msg.event.payload,
    at: msg.event.at,
  };

  // Lưu vào IndexedDB trước, rồi thử flush ngay
  saveToBuffer(chunk)
    .then(flushBuffer)
    .catch(() => {}); // Chunk vẫn còn trong DB, flush sau

  reply({ ok: true });
  return false;
});

// ─── Kiểm tra server & thông báo khi mất kết nối ───────────────────────────
const checkServerAndNotify = async () => {
  try {
    await fetch(`${API}/api/ping`, { method: "GET", signal: AbortSignal.timeout(3000) });
    if (!serverOnline) {
      serverOnline = true;
      chrome.notifications.create("server-back", {
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "✅ Kết nối đã phục hồi",
        message: "Server đã hoạt động trở lại. Dữ liệu tồn đọng sẽ được gửi lên ngay.",
        priority: 1,
      });
      flushBuffer();
    }
  } catch {
    if (serverOnline) {
      serverOnline = false;
      chrome.notifications.create("server-down", {
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "⚠️ Mất kết nối server!",
        message: "Đừng tắt Google Meet. Dữ liệu đang được lưu tạm, sẽ gửi lên khi có mạng trở lại.",
        priority: 2,
      });
    }
  }
};

// Retry flush + kiểm tra server mỗi 10 giây
setInterval(() => {
  flushBuffer();
  checkServerAndNotify();
}, 10000);
