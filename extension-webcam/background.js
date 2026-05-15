importScripts("env.js");
const API = ENV.API_URL;

const DB_NAME = "meet-poc-buffer";
const DB_VERSION = 2; // Upgraded to v2 for index
const MAX_CONCURRENT = 3;
const MAX_RETRIES = 4;
const BACKOFF_BASE = 1000; // ms

// --- Helper Functions ---
const sleep = ms => new Promise(r => setTimeout(r, ms));

const openDB = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      let store;
      if (e.oldVersion < 1) {
        store = db.createObjectStore("chunks", { keyPath: "id", autoIncrement: true });
      } else {
        store = req.transaction.objectStore("chunks");
      }
      if (e.oldVersion < 2) {
        store.createIndex("status", "status");
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });

// AbortSignal.timeout polyfill wrapper for older MV3 Service Workers
const fetchWithTimeout = async (resource, options = {}) => {
  const { timeout = 60000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(resource, {
    ...options,
    signal: controller.signal  
  });
  clearTimeout(id);
  return response;
};

// --- Controlled Upload Queue ---
class ChunkUploadQueue {
  constructor() {
    this.active = 0;
    this.dbPromise = openDB();
    this.initPromise = this.init();
  }

  async init() {
    const db = await this.dbPromise;
    await this.recoverStuckChunks(db);
  }

  async recoverStuckChunks(db) {
    return new Promise((resolve) => {
      const tx = db.transaction("chunks", "readwrite");
      const store = tx.objectStore("chunks");
      const req = store.openCursor();
      let recoveredCount = 0;
      
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const chunk = cursor.value;
          // Recover chunks that were uploading before crash, or old v1 chunks without status
          if (chunk.status === "uploading" || !chunk.status) {
            chunk.status = "pending";
            cursor.update(chunk);
            recoveredCount++;
          }
          cursor.continue();
        } else {
          if (recoveredCount > 0) console.log(`Recovered ${recoveredCount} stuck chunks`);
          resolve();
        }
      };
      req.onerror = () => resolve();
    });
  }

  async enqueue(chunkData) {
    await this.initPromise;
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("chunks", "readwrite");
      tx.objectStore("chunks").add({ 
        ...chunkData, 
        savedAt: Date.now(),
        status: "pending",
        retries: 0
      });
      tx.oncomplete = () => {
        this.drain();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async drain() {
    await this.initPromise;
    if (this.active >= MAX_CONCURRENT) return;
    
    const db = await this.dbPromise;
    
    // Get pending chunks to fill slots
    const pendingChunks = await new Promise((resolve) => {
      const tx = db.transaction("chunks", "readonly");
      const index = tx.objectStore("chunks").index("status");
      const req = index.openCursor(IDBKeyRange.only("pending"));
      const results = [];
      
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && results.length < (MAX_CONCURRENT - this.active)) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => resolve([]);
    });

    if (pendingChunks.length === 0) return;

    // Lock chunks immediately so other drain loops don't grab them
    await new Promise((resolve) => {
      const tx = db.transaction("chunks", "readwrite");
      const store = tx.objectStore("chunks");
      pendingChunks.forEach(chunk => {
        chunk.status = "uploading";
        store.put(chunk);
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); 
    });

    // Start uploads concurrently
    for (const chunk of pendingChunks) {
      this.active++;
      this.uploadChunk(chunk).catch(console.error); // fire and forget
    }
  }

  async uploadChunk(chunk) {
    const db = await this.dbPromise;
    try {
      await this.uploadWithRetry(chunk, chunk.retries || 0);

      // Success -> delete from DB
      await new Promise((resolve) => {
        const tx = db.transaction("chunks", "readwrite");
        tx.objectStore("chunks").delete(chunk.id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (err) {
      // Failed permanently after retries -> mark as failed
      console.error(`Chunk ${chunk.id} failed permanently`, err);
      await new Promise((resolve) => {
        const tx = db.transaction("chunks", "readwrite");
        chunk.status = "failed";
        tx.objectStore("chunks").put(chunk);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } finally {
      this.active--;
      this.drain(); // Trigger next items in queue
    }
  }

  async uploadWithRetry(chunk, attempt) {
    try {
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

      // Lấy Signed URLs từ server (max 60s timeout)
      const res = await fetchWithTimeout(`${API}/api/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meta),
        timeout: 60000 
      });
      if (!res.ok) {
        let reason = "Unknown Server Error";
        try {
          const errBody = await res.json();
          if (errBody.reason) reason = errBody.reason;
        } catch (e) {}
        throw new Error(`HTTP ${res.status} - ${reason}`);
      }
      const { signedUrls } = await res.json();
      console.log(`[Queue] Chunk ${chunk.id} signedUrls keys:`, Object.keys(signedUrls));

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

      // Upload file nhị phân (max 60s timeout)
      const uploads = [];
      const putFile = async (urlObj, blob) => {
        if (urlObj.alreadyExists) return; 
        const upRes = await fetchWithTimeout(urlObj.signedUrl, { 
          method: "PUT", 
          body: blob, 
          headers: { "Content-Type": blob.type },
          timeout: 60000 
        });
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

    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;

      const delay = BACKOFF_BASE * (2 ** attempt) + Math.random() * 500;
      console.warn(`Retry chunk ${chunk.id} attempt ${attempt + 1} after ${Math.round(delay)}ms`);
      await sleep(delay);

      chunk.retries = attempt + 1;
      const db = await this.dbPromise;
      await new Promise((resolve) => {
        const tx = db.transaction("chunks", "readwrite");
        tx.objectStore("chunks").put(chunk);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });

      return this.uploadWithRetry(chunk, attempt + 1);
    }
  }
}

// Khởi tạo Global Queue
const uploadQueue = new ChunkUploadQueue();
uploadQueue.drain(); // Kick off whenever SW starts

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "session-ended") {
    reply({ ok: true });
    return false;
  }

  if (msg.type !== "poc-event") return false;

  const tabId = sender.tab?.id;
  if (!tabId) { reply({ ok: false }); return false; }

  const chunkPayload = {
    sessionId: msg.event.sessionId,
    meetingId: msg.event.meetingId,
    studentId: `anon-${tabId}`,
    type: msg.event.type,
    payload: msg.event.payload,
    at: msg.event.at,
    uniqueId: Math.random().toString(36).substring(2, 10),
  };

  uploadQueue.enqueue(chunkPayload).catch(() => {});

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
  uploadQueue.drain();
});

// Retry/drain mỗi 10 giây để đảm bảo queue luôn chạy
setInterval(() => uploadQueue.drain(), 10000);
