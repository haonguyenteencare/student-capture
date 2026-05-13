const API = "http://localhost:8787";
const sessions = new Map();

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

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "session-ended") {
    if (sender.tab?.id) sessions.delete(sender.tab.id);
    reply({ ok: true });
    return false;
  }

  if (msg.type !== "poc-event") return false;

  const tabId = sender.tab?.id;
  if (!tabId) { reply({ ok: false }); return false; }

  const { event } = msg;
  const session = getSession(tabId, event.pageUrl || sender.tab.url || "https://meet.google.com/");

  fetch(`${API}/api/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...session, type: event.type, payload: event.payload, at: event.at }),
  }).catch(() => {});

  reply({ ok: true });
  return false;
});
