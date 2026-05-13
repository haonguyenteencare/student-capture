const serverStatusEl = document.getElementById("serverStatus");
const queueCountEl   = document.getElementById("queueCount");

const API = "http://localhost:8787";
const DB_NAME = "meet-poc-buffer";
const DB_VERSION = 1;

// ── Kiểm tra server còn sống không ──────────────────────────────────────────
async function checkServer() {
  try {
    const res = await fetch(`${API}/api/ping`, { method: "GET" });
    if (res.ok || res.status === 404) {
      serverStatusEl.textContent = "✅ Đang hoạt động";
      serverStatusEl.className   = "value active";
    } else {
      throw new Error("not ok");
    }
  } catch {
    serverStatusEl.textContent = "❌ Không kết nối được (localhost:8787)";
    serverStatusEl.className   = "value";
  }
}

// ── Đếm số chunk đang chờ trong IndexedDB ────────────────────────────────────
async function countQueue() {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) =>
        e.target.result.createObjectStore("chunks", { keyPath: "id", autoIncrement: true });
      req.onsuccess  = (e) => resolve(e.target.result);
      req.onerror    = () => reject(req.error);
    });

    const count = await new Promise((resolve, reject) => {
      const tx  = db.transaction("chunks", "readonly");
      const req = tx.objectStore("chunks").count();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });

    queueCountEl.textContent = count;
    queueCountEl.className   = `count${count > 0 ? " has-items" : ""}`;
  } catch {
    queueCountEl.textContent = "?";
  }
}

// ── Refresh ───────────────────────────────────────────────────────────────────
async function refresh() {
  await Promise.all([checkServer(), countQueue()]);
}

refresh();
setInterval(refresh, 3000);
