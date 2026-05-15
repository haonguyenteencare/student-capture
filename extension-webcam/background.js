importScripts("env.js");
const API = ENV.API_URL;
// We no longer manage sessions in a Map because Service Workers sleep and lose state.
// Instead, hook.js injects sessionId and meetingId.

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

let isFlushing = false;
const flushBuffer = async () => {
  if (isFlushing) return;
  isFlushing = true;

  try {
    const db = await openDB();

  // Lấy tối đa 5 chunks một lúc để upload song song
  while (true) {
    const chunks = await new Promise((resolve) => {
      const tx = db.transaction("chunks", "readonly");
      const store = tx.objectStore("chunks");
      const req = store.openCursor();
      const results = [];
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && results.length < 5) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => resolve([]);
    });

    if (chunks.length === 0) break;

    await Promise.all(chunks.map(async (chunk) => {
      try {
        // 1. Chuẩn bị metadata
        const meta = {
          sessionId: chunk.sessionId,
          meetingId: chunk.meetingId,
          studentId: chunk.studentId,
          type: chunk.type,
          at: chunk.at,
          streamId: chunk.payload.streamId,
          uniqueId: chunk.uniqueId,
        };

        if (chunk.type === "video-frame") {
          meta.hasWebp = !!chunk.payload.webpDataUrl;
          meta.hasThumb = !!chunk.payload.thumbDataUrl;
          meta.hasRgba = !!chunk.payload.rgbaBase64;
        }

        // 2. Lấy Signed URLs từ server
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

        // 4. Upload file nhị phân
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
          if (signedUrls.rgba && chunk.payload.rgbaBase64) {
            uploads.push(putFile(signedUrls.rgba, b64toBlob(chunk.payload.rgbaBase64, "application/octet-stream")));
          }
        }
        else if (chunk.type === "webm-chunk" && signedUrls.webm) {
          uploads.push(putFile(signedUrls.webm, b64toBlob(chunk.payload.dataBase64, chunk.payload.mimeType || "video/webm")));
        }

        await Promise.all(uploads);

        // 5. Xóa khỏi buffer sau khi upload thành công
        await new Promise((resolveDel) => {
          const deleteTx = db.transaction("chunks", "readwrite");
          const delReq = deleteTx.objectStore("chunks").delete(chunk.id);
          delReq.onsuccess = () => resolveDel();
          delReq.onerror = () => resolveDel();
        });
      } catch (e) {
        console.error("Flush error for chunk:", chunk.id, e.message);
        if (e.message.startsWith("HTTP") || e.message.includes("Supabase failed")) {
          // Xóa chunk lỗi để không nghẽn hàng đợi
          await new Promise((resolveDel) => {
            const deleteTx = db.transaction("chunks", "readwrite");
            const delReq = deleteTx.objectStore("chunks").delete(chunk.id);
            delReq.onsuccess = () => resolveDel();
            delReq.onerror = () => resolveDel();
          });
        }
      }
    }));
  }
} finally {
    isFlushing = false;
  }
};


chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "session-ended") {
    reply({ ok: true });
    return false;
  }

  if (msg.type !== "poc-event") return false;

  const tabId = sender.tab?.id;
  if (!tabId) { reply({ ok: false }); return false; }

  const chunk = {
    sessionId: msg.event.sessionId,
    meetingId: msg.event.meetingId,
    studentId: `anon-${tabId}`,
    type: msg.event.type,
    payload: msg.event.payload,
    at: msg.event.at,
    uniqueId: Math.random().toString(36).substring(2, 10),
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

