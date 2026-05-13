(() => {
  const MAX_EVENTS = 80;

  const script = document.createElement('script');
  script.textContent = `window.TEENCARE_WORKLET_URL = '${chrome.runtime.getURL("audio-processor.js")}';`;
  (document.head || document.documentElement).appendChild(script);
  script.remove();

  const updateStorage = async (event) => {
    await chrome.runtime.sendMessage({ type: "raw-data-event", event });

    // Ngừng ghi log heavy events vào storage cho UI
    if (event.type.startsWith("audio-") || event.type.startsWith("video-") || event.type.startsWith("media-")) {
      return;
    }

    const current = await chrome.storage.local.get({ events: [] });
    const events = [event, ...current.events].slice(0, MAX_EVENTS);
    await chrome.storage.local.set({ events, latestEvent: event });
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    if (!event.data || event.data.source !== "meet-raw-data-poc") {
      return;
    }

    updateStorage({
      type: event.data.type,
      payload: event.data.payload,
      at: event.data.at,
      pageUrl: window.location.href,
    }).catch(() => {});
  });

  window.addEventListener("pagehide", () => {
    chrome.runtime.sendMessage({ type: "session-ended" }).catch(() => {});
  });

  const showOfflineWarning = () => {
    if (document.getElementById('teencare-offline-warning')) return;
    const div = document.createElement('div');
    div.id = 'teencare-offline-warning';
    div.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.85);
      color: white;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: sans-serif;
      backdrop-filter: blur(5px);
    `;
    div.innerHTML = `
      <div style="background: #ef4444; padding: 30px 40px; border-radius: 12px; text-align: center; max-width: 500px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
        <svg style="width: 64px; height: 64px; margin: 0 auto 16px; color: white;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
        <h1 style="margin: 0 0 15px; font-size: 24px; font-weight: bold;">Mất kết nối Internet!</h1>
        <p style="margin: 0 0 25px; font-size: 16px; line-height: 1.5;">Hệ thống đang lưu trữ dữ liệu lớp học tạm thời vào máy của bạn.</p>
        <p style="margin: 0 0 25px; font-size: 18px; line-height: 1.5; font-weight: bold; color: #ffed4a; text-transform: uppercase;">Tuyệt đối không đóng tab này!</p>
        <div style="display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 15px; color: #fca5a5;">
          <span class="spinner" style="width: 18px; height: 18px; border: 2px solid #fca5a5; border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 1s linear infinite;"></span>
          Đang chờ kết nối lại...
        </div>
      </div>
      <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    `;
    document.body.appendChild(div);
  };

  const hideOfflineWarning = () => {
    const div = document.getElementById('teencare-offline-warning');
    if (div) div.remove();
  };

  window.addEventListener('offline', showOfflineWarning);
  window.addEventListener('online', hideOfflineWarning);

  if (!navigator.onLine) {
    showOfflineWarning();
  }
})();
