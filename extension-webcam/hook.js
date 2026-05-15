(() => {
  if (window.__meetHooked) return;
  window.__meetHooked = true;

  let streamCount = 0;
  const hookedTracks = new WeakSet();

  const meetingId = () => window.location.pathname.split("/").filter(Boolean)[0] || "unknown";
  const sessionId = `session-${Date.now()}`;

  const post = (type, payload = {}) =>
    window.postMessage({ source: "meet-poc", type, payload, sessionId, meetingId: meetingId(), at: Date.now() }, "*");

  // Hàm kiểm tra xem có đang ở trong phòng họp không (dựa vào URL /abc-defg-hij)
  const isMeetingRoom = () => /^\/[a-zA-Z0-9]{3}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{3}$/.test(window.location.pathname);

  // --- AUDIO: F32 raw, flush mỗi 5 giây ---
  const captureAudio = (stream, track, streamId) => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    // Chrome bug workaround: dummy audio để remote stream không bị câm
    const dummy = new Audio();
    dummy.srcObject = stream;
    dummy.muted = true;
    dummy.play().catch(() => { });

    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    let bucket = [];

    source.connect(processor);
    processor.connect(ctx.destination);

    processor.onaudioprocess = (e) => {
      bucket.push(...e.inputBuffer.getChannelData(0));
    };

    const interval = setInterval(() => {
      if (bucket.length === 0) return;
      const samples = bucket;
      bucket = [];

      if (!isMeetingRoom()) return;

      // Encode F32 → base64
      const f32 = new Float32Array(samples);
      const u8 = new Uint8Array(f32.buffer);
      let bin = "";
      for (let i = 0; i < u8.length; i += 8192) {
        bin += String.fromCharCode(...u8.subarray(i, i + 8192));
      }

      post("audio-chunk", {
        streamId,
        sampleRate: ctx.sampleRate,
        sampleCount: samples.length,
        encoding: "f32le",
        dataBase64: btoa(bin),
      });
    }, 10000);

    track.addEventListener("ended", () => {
      clearInterval(interval);
      processor.disconnect();
      source.disconnect();
      dummy.srcObject = null;
      ctx.close().catch(() => { });
    }, { once: true });
  };

  // --- VIDEO: RGBA raw + JPEG thumbnail, 1 frame / 3 giây ---
  const captureVideo = (track, streamId) => {
    if (!("MediaStreamTrackProcessor" in window)) return;

    const clone = track.clone();
    const processor = new MediaStreamTrackProcessor({ track: clone });
    const reader = processor.readable.getReader();
    let lastSent = 0;

    track.addEventListener("ended", () => {
      clone.stop();
      reader.cancel().catch(() => { });
    }, { once: true });

    (async () => {
      while (clone.readyState === "live") {
        const { done, value: frame } = await reader.read();
        if (done || !frame) break;

        try {
          const now = performance.now();
          if (now - lastSent < 10000) continue;

          // Chỉ lấy frame nếu đang ở trong phòng
          if (!isMeetingRoom()) continue;

          lastSent = now;

          // RGBA raw — giữ nguyên resolution gốc
          const buf = new Uint8Array(frame.allocationSize({ format: "RGBA" }));
          await frame.copyTo(buf, { format: "RGBA" });

          // Thumbnail JPEG full resolution
          const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
          canvas.getContext("2d").putImageData(
            new ImageData(new Uint8ClampedArray(buf), frame.displayWidth, frame.displayHeight),
            0, 0,
          );
          const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
          const thumbDataUrl = await blob.arrayBuffer().then((ab) => {
            let bin = "";
            const u8 = new Uint8Array(ab);
            for (let i = 0; i < u8.length; i += 8192)
              bin += String.fromCharCode(...u8.subarray(i, i + 8192));
            return "data:image/jpeg;base64," + btoa(bin);
          });

          // RGBA → base64
          let bin = "";
          for (let i = 0; i < buf.length; i += 8192)
            bin += String.fromCharCode(...buf.subarray(i, i + 8192));

          post("video-frame", {
            streamId,
            width: frame.displayWidth,
            height: frame.displayHeight,
            rgbaBase64: btoa(bin),
            thumbDataUrl,
          });
        } finally {
          frame.close();
        }
      }
    })();
  };

  // --- WEBM: MediaRecorder, chunk mỗi 5 giây ---
  const captureWebM = (stream, streamId) => {
    if (!("MediaRecorder" in window)) return;

    const mime = ["video/webm;codecs=vp9,opus", "video/webm"].find(
      (t) => MediaRecorder.isTypeSupported(t),
    ) || "";

    const clonedTracks = stream.getTracks().map((t) => t.clone());
    const clonedStream = new MediaStream(clonedTracks);
    const rec = new MediaRecorder(clonedStream, mime ? { mimeType: mime } : {});

    rec.ondataavailable = async (e) => {
      if (!e.data || e.data.size === 0) return;
      if (!isMeetingRoom()) return;

      const ab = await e.data.arrayBuffer();
      let bin = "";
      const u8 = new Uint8Array(ab);
      for (let i = 0; i < u8.length; i += 8192)
        bin += String.fromCharCode(...u8.subarray(i, i + 8192));
      post("webm-chunk", {
        streamId,
        mimeType: rec.mimeType,
        dataBase64: btoa(bin),
      });
    };

    rec.start(10000);

    stream.getTracks().forEach((t) =>
      t.addEventListener("ended", () => {
        if (rec.state !== "inactive") rec.stop();
        clonedTracks.forEach((ct) => ct.stop());
      }, { once: true }),
    );
  };

  // --- HOOK getUserMedia (local: video + audio student) ---
  const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (...args) => {
    const stream = await origGUM(...args);
    const id = `local-${++streamCount}`;

    stream.getAudioTracks().forEach((t) => {
      if (hookedTracks.has(t)) return;
      hookedTracks.add(t);
      captureAudio(stream, t, id);
    });

    stream.getVideoTracks().forEach((t) => {
      if (hookedTracks.has(t)) return;
      hookedTracks.add(t);
      captureVideo(t, id);
      captureWebM(new MediaStream([t]), `${id}-webm`);
    });

    return stream;
  };

  // --- HOOK RTCPeerConnection (remote: audio mentor) ---
  const OrigPC = window.RTCPeerConnection;
  if (OrigPC) {
    window.RTCPeerConnection = new Proxy(OrigPC, {
      construct(Target, args) {
        const pc = new Target(...args);
        pc.addEventListener("track", (e) => {
          if (e.track.kind !== "audio" || hookedTracks.has(e.track)) return;
          hookedTracks.add(e.track);
          const id = `remote-${++streamCount}`;
          const stream = e.streams[0] || new MediaStream([e.track]);
          captureAudio(stream, e.track, id);
        });
        return pc;
      },
    });
  }

  post("hook-ready");
})();
