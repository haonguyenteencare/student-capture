importScripts("env.js");
const API = ENV.API_URL;
const sessions = new Map();

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
      // 1. Chuẩn bị metadata
      const meta = {
        sessionId: chunk.sessionId,
        meetingId: chunk.meetingId,
        studentId: chunk.studentId,
        type: chunk.type,
        at: chunk.at,
        streamId: chunk.payload.streamId,
      };

      if (chunk.type === "video-frame") {
        meta.hasWebp = !!chunk.payload.webpDataUrl;
        meta.hasThumb = !!chunk.payload.thumbDataUrl;
      }

      // 2. Lấy Signed URLs từ server (chỉ gửi metadata bé tí)
      const res = await fetch(`${API}/api/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meta),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { signedUrls } = await res.json();

      // 3. Helper chuyển Base64 thành Blob
      const b64toBlob = (b64DataURI, fallbackType) => {
        let b64 = b64DataURI;
        let type = fallbackType;
        if (b64DataURI.startsWith("data:")) {
          const parts = b64DataURI.split(",");
          type = parts[0].split(":")[1].split(";")[0];
          b64 = parts[1];
        }
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for(let i=0; i<bin.length; i++) u8[i] = bin.charCodeAt(i);
        return new Blob([u8], { type });
      };

      // 4. Upload file nhị phân bằng PUT request thẳng lên Supabase
      const uploads = [];
      const putFile = async (urlObj, blob) => {
        const upRes = await fetch(urlObj.signedUrl, { method: "PUT", body: blob, headers: { "Content-Type": blob.type } });
        if (!upRes.ok) throw new Error(`Upload to Supabase failed: ${upRes.status}`);
      };

      if (chunk.type === "audio-chunk" && signedUrls.f32) {
        uploads.push(putFile(signedUrls.f32, b64toBlob(chunk.payload.dataBase64, "application/octet-stream")));
        const jsonBlob = new Blob([JSON.stringify({ 
          sampleRate: chunk.payload.sampleRate, 
          sampleCount: chunk.payload.sampleCount, 
          encoding: chunk.payload.encoding 
        })], { type: "application/json" });
        uploads.push(putFile(signedUrls.json, jsonBlob));
      } 
      else if (chunk.type === "video-frame") {
        if (signedUrls.webp && chunk.payload.webpDataUrl) {
          uploads.push(putFile(signedUrls.webp, b64toBlob(chunk.payload.webpDataUrl, "image/webp")));
        }
        if (signedUrls.thumb && chunk.payload.thumbDataUrl) {
          uploads.push(putFile(signedUrls.thumb, b64toBlob(chunk.payload.thumbDataUrl, "image/jpeg")));
        }
      }
      else if (chunk.type === "webm-chunk" && signedUrls.webm) {
        uploads.push(putFile(signedUrls.webm, b64toBlob(chunk.payload.dataBase64, chunk.payload.mimeType || "video/webm")));
      }

      await Promise.all(uploads);

      // 5. Xóa khỏi buffer sau khi upload thành công TẤT CẢ các file của chunk
      await new Promise((resolve) => {
        const tx = db.transaction("chunks", "readwrite");
        tx.objectStore("chunks").delete(chunk.id);
        tx.oncomplete = resolve;
      });
    } catch (e) {
      console.error("Flush error:", e);
      break; // Mất mạng hoặc server lỗi, dừng flush và thử lại lần sau
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

// ─── Detect WiFi / mạng bị cắt ──────────────────────────────────────────────
const ICON_URL = chrome.runtime.getURL("notification-icon.png");

self.addEventListener("offline", () => {
  chrome.notifications.create("net-down", {
    type: "basic",
    iconUrl: ICON_URL,
    title: "⚠️ Mất kết nối mạng!",
    message: "Đừng tắt Google Meet. Dữ liệu đang được lưu tạm trong máy, sẽ gửi lên khi có mạng trở lại.",
    priority: 2,
  });
});

self.addEventListener("online", () => {
  chrome.notifications.create("net-back", {
    type: "basic",
    iconUrl: ICON_URL,
    title: "✅ Đã có mạng trở lại",
    message: "Đang gửi dữ liệu tồn đọng lên server...",
    priority: 1,
  });
  flushBuffer();
});

// Retry flush mỗi 10 giây
setInterval(flushBuffer, 10000);

