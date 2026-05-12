const API_BASE_URL = "http://localhost:8787";
const UPLOAD_INTERVAL_MS = 5000;

const sessions = new Map();
const pendingUploads = new Map();

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
      events: [],
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

const getPayloadForExport = (event) => event;

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
  if (!session || session.events.length === 0) {
    return { ok: false, reason: "No captured events for this tab yet." };
  }

  const endedAt = new Date().toISOString();
  const payload = {
    ...session,
    endedAt,
    exportedAt: endedAt,
    eventCount: session.events.length,
  };
  const json = JSON.stringify(payload, null, 2);
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;

  await chrome.downloads.download({
    url: dataUrl,
    filename: `${session.id}.json`,
    saveAs: false,
  });

  return { ok: true, filename: `${session.id}.json`, eventCount: session.events.length };
};

const uploadBatch = async (tabId) => {
  const pending = pendingUploads.get(tabId) || [];

  if (pending.length === 0) {
    return;
  }

  const session = sessions.get(tabId);

  if (!session) {
    return;
  }

  const batch = pending.splice(0, pending.length);

  session.upload.lastAttemptAt = new Date().toISOString();

  try {
    const response = await fetch(`${API_BASE_URL}/api/capture/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        meetingId: session.meetingId,
        studentId: session.studentId,
        sessionId: session.sessionId,
        pageUrl: session.pageUrl,
        userAgent: navigator.userAgent,
        events: batch.map(getPayloadForUpload),
      }),
    });

    if (!response.ok) {
      throw new Error(`API responded ${response.status}`);
    }

    const result = await response.json();

    session.upload.lastSuccessAt = new Date().toISOString();
    session.upload.lastError = null;
    session.upload.uploadedEventCount += result.savedEventCount || batch.length;
  } catch (error) {
    pending.unshift(...batch);
    session.upload.lastError = error.message;
  }
};

const queueUpload = (tabId, event) => {
  if (!pendingUploads.has(tabId)) {
    pendingUploads.set(tabId, []);
  }

  pendingUploads.get(tabId).push(event);
};

setInterval(() => {
  for (const tabId of pendingUploads.keys()) {
    uploadBatch(tabId);
  }
}, UPLOAD_INTERVAL_MS);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "raw-data-event" && sender.tab?.id !== undefined) {
    if (!RECORDED_TYPES.has(message.event.type)) {
      sendResponse({ ok: true, recorded: false });
      return false;
    }

    getSession(sender.tab.id, message.event.pageUrl)
      .then((session) => {
        const event = {
          ...message.event,
          meetingId: session.meetingId,
          studentId: session.studentId,
          sessionId: session.sessionId,
        };

        session.events.push(getPayloadForExport(event));
        queueUpload(sender.tab.id, event);
        sendResponse({
          ok: true,
          recorded: true,
          eventCount: session.events.length,
          queuedUploadCount: pendingUploads.get(sender.tab.id)?.length || 0,
          meetingId: session.meetingId,
          studentId: session.studentId,
          sessionId: session.sessionId,
        });
      })
      .catch((error) => sendResponse({ ok: false, reason: error.message }));

    return true;
  }

  if (message?.type === "export-session") {
    const session = sessions.get(message.tabId);

    downloadJson(session)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, reason: error.message }));

    return true;
  }

  if (message?.type === "flush-upload") {
    uploadBatch(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, reason: error.message }));

    return true;
  }

  if (message?.type === "session-ended" && sender.tab?.id !== undefined) {
    const session = sessions.get(sender.tab.id);

    if (session && session.events.length > 0) {
      session.endedAt = new Date().toISOString();
      uploadBatch(sender.tab.id).catch(() => {});
      downloadJson(session).catch(() => {});
    }

    sendResponse({ ok: true });
    return false;
  }

  return false;
});
