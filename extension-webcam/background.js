importScripts("msgpack.min.js");

const API_BASE_URL = "ws://localhost:8787";
const UPLOAD_INTERVAL_AUDIO_MS = 5000;
const UPLOAD_INTERVAL_VIDEO_MS = 15000;
const MAX_BATCH_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const sessions = new Map();

const RECORDED_TYPES = new Set([
  "hook-installed",
  "get-user-media-called",
  "stream-captured",
  "video-frame",
  "audio-samples",
  "audio-recording",
  "media-recorder-started",
  "media-recording",
  "media-recording-error",
  "media-recorder-error",
  "media-recorder-unsupported",
  "video-frame-error",
  "audio-unsupported",
  "video-unsupported",
]);

const uuid = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const makeSessionId = (tabId) => {
  const now = new Date();
  const timestamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");

  return `meet-raw-data-${timestamp}-tab-${tabId}`;
};

const sanitizeSegment = (value, fallback) => {
  const sanitized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);

  return sanitized || fallback;
};

const getStoredStudentId = async () => {
  const current = await chrome.storage.local.get({ studentId: null });

  if (current.studentId) {
    return current.studentId;
  }

  const studentId = `anon-${uuid()}`;

  await chrome.storage.local.set({ studentId });

  return studentId;
};

const parseMeetingId = (pageUrl) => {
  try {
    const url = new URL(pageUrl);
    const pathSegment = url.pathname.split("/").filter(Boolean)[0];

    if (url.hostname === "meet.google.com" && pathSegment) {
      return sanitizeSegment(pathSegment, "unknown-meeting");
    }
  } catch {
    return "unknown-meeting";
  }

  return "unknown-meeting";
};

const getSession = async (tabId, pageUrl) => {
  if (!sessions.has(tabId)) {
    const studentId = await getStoredStudentId();
    const sessionId = makeSessionId(tabId);

    sessions.set(tabId, {
      id: sessionId,
      sessionId,
      studentId,
      meetingId: parseMeetingId(pageUrl),
      startedAt: new Date().toISOString(),
      endedAt: null,
      pageUrl,
      formatVersion: 1,
      notes: [
        "PoC capture file. Video frames are sampled RGBA previews, not continuous full raw video.",
        "Audio samples are sampled Float32 preview chunks, not continuous full PCM recording.",
      ],
      eventCount: 0,
      upload: {
        apiBaseUrl: API_BASE_URL,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastError: null,
        uploadedEventCount: 0,
      },
    });
  }

  const session = sessions.get(tabId);

  if (pageUrl) {
    session.pageUrl = pageUrl;
    session.meetingId = parseMeetingId(pageUrl);
  }

  return session;
};

const getPayloadForUpload = (event) => {
  if (event.type !== "audio-samples") {
    return event;
  }

  return {
    ...event,
    payload: {
      ...event.payload,
      samples: undefined,
    },
  };
};

const downloadJson = async (session) => {
  if (!session || session.eventCount === 0) {
    return { ok: false, reason: "No captured events for this tab yet." };
  }

  const endedAt = new Date().toISOString();
  const payload = {
    ...session,
    endedAt,
    exportedAt: endedAt,
  };
  const json = JSON.stringify(payload, null, 2);
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;

  await chrome.downloads.download({
    url: dataUrl,
    filename: `${session.id}-metadata.json`,
    saveAs: false,
  });

  return { ok: true, filename: `${session.id}-metadata.json`, eventCount: session.eventCount };
};

const queueUpload = async (tabId, event) => {
  const eventId = `event_${tabId}_${Date.now()}_${uuid()}`;
  await chrome.storage.local.set({ [eventId]: event });
};

let ws = null;
let offlineQueue = [];
let pingInterval = null;
let wsRetryDelay = 5000;     // Bắt đầu 5s
const WS_MAX_RETRY = 60000; // Tối đa 60s

const ensureWsConnection = () => {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  
  ws = new WebSocket(API_BASE_URL);
  
  ws.onopen = () => {
    console.log("WebSocket connected");
    wsRetryDelay = 5000; // Reset delay khi kết nối thành công
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("ping");
    }, 20000);
    
    while (offlineQueue.length > 0) {
      const payload = offlineQueue.shift();
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(MessagePack.encode(payload));
        } catch (e) {
          console.error("Failed to encode/send queued payload", e);
        }
      } else {
        offlineQueue.unshift(payload);
        break;
      }
    }
  };
  
  ws.onclose = () => {
    if (pingInterval) clearInterval(pingInterval);
    // Exponential backoff: 5s → 10s → 20s → ... → 60s
    setTimeout(ensureWsConnection, wsRetryDelay);
    wsRetryDelay = Math.min(wsRetryDelay * 2, WS_MAX_RETRY);
  };
  
  ws.onerror = () => {
    // Lỗi đã được xử lý ở onclose, không cần log lại để tránh spam
  };
};

ensureWsConnection();

const activeUploads = new Set();

const uploadBatch = async (tabId, filterTypes = "all") => {
  const lockKey = `${tabId}_${filterTypes}`;
  if (activeUploads.has(lockKey)) {
    return;
  }
  activeUploads.add(lockKey);

  try {
    const storage = await chrome.storage.local.get(null);
    const eventKeys = Object.keys(storage).filter((key) => key.startsWith(`event_${tabId}_`));

    if (eventKeys.length === 0) return;

    const events = [];
    const keysToDelete = [];
    let currentBatchSize = 0;
    let remainingKeysOfSameFilterType = 0;

    for (const key of eventKeys) {
      const event = storage[key];
      const isVideoOrMedia = event.type.startsWith("video-") || event.type.startsWith("media-");

      if (filterTypes === "audio" && isVideoOrMedia) continue;
      if (filterTypes === "video" && !isVideoOrMedia) continue;

      const payload = getPayloadForUpload(event);
      // Giả định mỗi event trung bình tốn size bytes để tránh buffer quá bự
      const itemSize = payload.dataBase64 ? payload.dataBase64.length : 1000;

      if (currentBatchSize + itemSize > MAX_BATCH_SIZE_BYTES && events.length > 0) {
        remainingKeysOfSameFilterType++;
        continue;
      }

      events.push(payload);
      keysToDelete.push(key);
      currentBatchSize += itemSize;
    }

    if (events.length === 0) return;

    let session = sessions.get(tabId);
    if (!session) {
      session = {
        meetingId: events[0].meetingId,
        studentId: events[0].studentId,
        sessionId: events[0].sessionId,
        pageUrl: events[0].pageUrl,
        upload: { uploadedEventCount: 0 },
      };
    }

    if (session.upload) {
      session.upload.lastAttemptAt = new Date().toISOString();
    }

    const wsPayload = {
      meetingId: session.meetingId,
      studentId: session.studentId,
      sessionId: session.sessionId,
      pageUrl: session.pageUrl,
      userAgent: navigator.userAgent,
      events: events,
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(MessagePack.encode(wsPayload));
    } else {
      offlineQueue.push(wsPayload);
    }

    await chrome.storage.local.remove(keysToDelete);

    if (session.upload) {
      session.upload.lastSuccessAt = new Date().toISOString();
      session.upload.lastError = null;
      session.upload.uploadedEventCount += events.length;
    }

    if (remainingKeysOfSameFilterType > 0) {
      setTimeout(() => uploadBatch(tabId, filterTypes), 100);
    }
  } catch (error) {
    console.error("Upload Error:", error);
    let session = sessions.get(tabId);
    if (session && session.upload) {
      session.upload.lastError = error.message;
    }
  } finally {
    activeUploads.delete(lockKey);
  }
};

// Interval luồng Audio (nhanh, nhẹ)
setInterval(async () => {
  const storage = await chrome.storage.local.get(null);
  const tabIds = new Set(
    Object.keys(storage)
      .filter((k) => k.startsWith("event_"))
      .map((k) => parseInt(k.split("_")[1], 10))
  );

  for (const tabId of tabIds) {
    if (!isNaN(tabId)) uploadBatch(tabId, "audio");
  }
}, UPLOAD_INTERVAL_AUDIO_MS);

// Interval luồng Video (chậm, nặng)
setInterval(async () => {
  const storage = await chrome.storage.local.get(null);
  const tabIds = new Set(
    Object.keys(storage)
      .filter((k) => k.startsWith("event_"))
      .map((k) => parseInt(k.split("_")[1], 10))
  );

  for (const tabId of tabIds) {
    if (!isNaN(tabId)) uploadBatch(tabId, "video");
  }
}, UPLOAD_INTERVAL_VIDEO_MS);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "identity-updated") {
    for (const session of sessions.values()) {
      session.studentId = message.studentId;
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "raw-data-event" && sender.tab?.id !== undefined) {
    if (!RECORDED_TYPES.has(message.event.type)) {
      sendResponse({ ok: true, recorded: false });
      return false;
    }

    getSession(sender.tab.id, message.event.pageUrl)
      .then(async (session) => {
        const event = {
          ...message.event,
          meetingId: session.meetingId,
          studentId: session.studentId,
          sessionId: session.sessionId,
        };

        session.eventCount = (session.eventCount || 0) + 1;
        await queueUpload(sender.tab.id, event);
        sendResponse({
          ok: true,
          recorded: true,
          eventCount: session.eventCount,
          meetingId: session.meetingId,
          studentId: session.studentId,
          sessionId: session.sessionId,
        });
      })
      .catch((error) => sendResponse({ ok: false, reason: error.message }));

    return true; // Keep the message channel open for async response
  }

  if (message?.type === "export-session") {
    const session = sessions.get(message.tabId);

    downloadJson(session)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, reason: error.message }));

    return true;
  }

  if (message?.type === "flush-upload") {
    // Flush tất cả
    uploadBatch(message.tabId, "all")
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, reason: error.message }));

    return true;
  }

  if (message?.type === "session-ended" && sender.tab?.id !== undefined) {
    const session = sessions.get(sender.tab.id);

    if (session && session.eventCount > 0) {
      session.endedAt = new Date().toISOString();
      uploadBatch(sender.tab.id, "all").catch(() => {});
      downloadJson(session).catch(() => {});
    }

    sendResponse({ ok: true });
    return false;
  }

  return false;
});
