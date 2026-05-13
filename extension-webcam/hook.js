(() => {
  const marker = "__meetRawDataPocHooked";

  if (window[marker]) {
    return;
  }

  window[marker] = true;

  const state = {
    streamCount: 0,
    tracks: new Map(),
  };

  const post = (type, payload = {}) => {
    window.postMessage(
      {
        source: "meet-raw-data-poc",
        type,
        payload,
        at: Date.now(),
      },
      "*",
    );
  };

  const summarizeTrack = (track) => ({
    id: track.id,
    kind: track.kind,
    label: track.label,
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
    settings: typeof track.getSettings === "function" ? track.getSettings() : {},
  });

  const makeChecksum = (bytes) => {
    let checksum = 2166136261;
    const limit = Math.min(bytes.length, 8192);

    for (let index = 0; index < limit; index += 1) {
      checksum ^= bytes[index];
      checksum = Math.imul(checksum, 16777619);
    }

    return (checksum >>> 0).toString(16).padStart(8, "0");
  };

  const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.addEventListener("load", () => resolve(reader.result));
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsDataURL(blob);
    });

  const makeThumbnailDataUrl = async (rgbaBytes, width, height) => {
    if (!("OffscreenCanvas" in window) || !("ImageData" in window)) {
      return null;
    }

    const sourceCanvas = new OffscreenCanvas(width, height);
    const sourceContext = sourceCanvas.getContext("2d");

    sourceContext.putImageData(
      new ImageData(new Uint8ClampedArray(rgbaBytes), width, height),
      0,
      0,
    );

    const blob = await sourceCanvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });

    return blobToDataUrl(blob);
  };

  const startMediaRecorder = (stream, streamId) => {
    if (!("MediaRecorder" in window)) {
      post("media-recorder-unsupported", {
        streamId,
        reason: "MediaRecorder is not available",
      });
      return;
    }

    const clonedTracks = stream.getTracks().map((track) => track.clone());
    const recordingStream = new MediaStream(clonedTracks);
    const supportedTypes = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "audio/webm;codecs=opus",
      "audio/webm",
    ];
    const mimeType =
      supportedTypes.find((type) => MediaRecorder.isTypeSupported(type)) || "";

    try {
      const recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);

      recorder.addEventListener("dataavailable", async (event) => {
        if (!event.data || event.data.size === 0) {
          return;
        }

        try {
          post("media-recording", {
            streamId,
            mimeType: recorder.mimeType,
            size: event.data.size,
            hasAudio: recordingStream.getAudioTracks().length > 0,
            hasVideo: recordingStream.getVideoTracks().length > 0,
            dataUrl: await blobToDataUrl(event.data),
          });
        } catch (error) {
          post("media-recording-error", {
            streamId,
            message: error.message,
          });
        }
      });

      recorder.start(5000);

      for (const track of stream.getTracks()) {
        track.addEventListener(
          "ended",
          () => {
            if (recorder.state !== "inactive") {
              recorder.stop();
            }

            for (const clonedTrack of clonedTracks) {
              clonedTrack.stop();
            }
          },
          { once: true },
        );
      }

      post("media-recorder-started", {
        streamId,
        mimeType: recorder.mimeType,
        hasAudio: recordingStream.getAudioTracks().length > 0,
        hasVideo: recordingStream.getVideoTracks().length > 0,
      });
    } catch (error) {
      post("media-recorder-error", {
        streamId,
        message: error.message,
      });
    }
  };

  const readVideoFrames = async (track, streamId) => {
    if (!("MediaStreamTrackProcessor" in window) || !("VideoFrame" in window)) {
      post("video-unsupported", {
        track: summarizeTrack(track),
        reason: "MediaStreamTrackProcessor or VideoFrame is not available",
      });
      return;
    }

    const sampleTrack = track.clone();
    const processor = new MediaStreamTrackProcessor({ track: sampleTrack });
    const reader = processor.readable.getReader();
    let lastSentAt = 0;
    let lastRawSentAt = 0;
    let frameCount = 0;

    state.tracks.set(sampleTrack.id, sampleTrack);

    track.addEventListener("ended", () => {
      sampleTrack.stop();
      reader.cancel().catch(() => {});
    });

    try {
      while (sampleTrack.readyState === "live") {
        const { done, value: frame } = await reader.read();

        if (done || !frame) {
          break;
        }

        frameCount += 1;
        const now = performance.now();

        try {
          if (now - lastSentAt >= 3000) {
            lastSentAt = now;

            try {
              const copyOptions = { format: "RGBA" };
              const allocationSize = frame.allocationSize(copyOptions);
              const buffer = new Uint8Array(allocationSize);
              const layout = await frame.copyTo(buffer, copyOptions);
              const thumbnailDataUrl = await makeThumbnailDataUrl(
                buffer,
                frame.displayWidth,
                frame.displayHeight,
              );
              const includeRawFrame = now - lastRawSentAt >= 10000;

              if (includeRawFrame) {
                lastRawSentAt = now;
              }

              post("video-frame", {
                streamId,
                frameCount,
                rawSource: "VideoFrame.copyTo(RGBA)",
                sourceFormat: frame.format,
                copiedFormat: "RGBA",
                track: summarizeTrack(track),
                codedWidth: frame.codedWidth,
                codedHeight: frame.codedHeight,
                displayWidth: frame.displayWidth,
                displayHeight: frame.displayHeight,
                duration: frame.duration,
                format: frame.format,
                timestamp: frame.timestamp,
                allocationSize,
                copiedBytes: buffer.byteLength,
                checksum: makeChecksum(buffer),
                firstBytes: Array.from(buffer.slice(0, 24)),
                thumbnailDataUrl,
                rgbaDataUrl: includeRawFrame
                  ? await blobToDataUrl(new Blob([buffer], { type: "application/octet-stream" }))
                  : null,
                layout,
              });
            } catch (error) {
              try {
                const bitmap = await createImageBitmap(frame);
                const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                const context = canvas.getContext("2d", { willReadFrequently: true });

                context.drawImage(bitmap, 0, 0);

                const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
                const buffer = imageData.data;
                const allocationSize = buffer.byteLength;
                const thumbnailDataUrl = await makeThumbnailDataUrl(
                  buffer,
                  bitmap.width,
                  bitmap.height,
                );
                const includeRawFrame = now - lastRawSentAt >= 10000;

                if (includeRawFrame) {
                  lastRawSentAt = now;
                }

                post("video-frame", {
                  streamId,
                  frameCount,
                  rawSource: "canvas.getImageData(RGBA)",
                  sourceFormat: frame.format,
                  copiedFormat: "RGBA",
                  copyToError: error.message,
                  track: summarizeTrack(track),
                  codedWidth: frame.codedWidth,
                  codedHeight: frame.codedHeight,
                  displayWidth: frame.displayWidth,
                  displayHeight: frame.displayHeight,
                  duration: frame.duration,
                  format: "RGBA",
                  timestamp: frame.timestamp,
                  allocationSize,
                  copiedBytes: allocationSize,
                  checksum: makeChecksum(buffer),
                  firstBytes: Array.from(buffer.slice(0, 24)),
                  thumbnailDataUrl,
                  rgbaDataUrl: includeRawFrame
                    ? await blobToDataUrl(new Blob([buffer], { type: "application/octet-stream" }))
                    : null,
                });

                bitmap.close();
              } catch (fallbackError) {
                post("video-frame-error", {
                  streamId,
                  track: summarizeTrack(track),
                  message: error.message,
                  fallbackMessage: fallbackError.message,
                });
              }
            }
          }
        } finally {
          frame.close();
        }
      }
    } catch (error) {
      post("video-reader-error", {
        streamId,
        track: summarizeTrack(track),
        message: error.message,
      });
    }
  };

  // Helper: encode uint8 → base64 an toàn qua postMessage boundary
  const uint8ToBase64 = (uint8) => {
    let binaryString = "";
    for (let i = 0; i < uint8.byteLength; i++) {
      binaryString += String.fromCharCode(uint8[i]);
    }
    return btoa(binaryString);
  };

  const readAudioSamples = async (stream, track, streamId) => {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextCtor) {
      post("audio-unsupported", {
        track: summarizeTrack(track),
        reason: "AudioContext is not available",
      });
      return;
    }

    // WORKAROUND CHROME BUG: remote WebRTC stream trả về im lặng nếu không được
    // gắn vào thẻ <audio> đang phát. Tạo audio ẩn để "mồi".
    const dummyAudio = new Audio();
    dummyAudio.srcObject = stream;
    dummyAudio.muted = true;
    dummyAudio.play().catch(() => {});

    const audioContext = new AudioContextCtor();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    let previewIntervalId = null;
    let useWorklet = false;

    // Thử dùng AudioWorklet trước
    if (window.TEENCARE_WORKLET_URL) {
      try {
        await audioContext.audioWorklet.addModule(window.TEENCARE_WORKLET_URL);
        useWorklet = true;
        console.log("[MeetRawData] AudioWorklet loaded OK");
      } catch (err) {
        console.warn("[MeetRawData] AudioWorklet failed, falling back to ScriptProcessor:", err.message);
      }
    } else {
      console.warn("[MeetRawData] TEENCARE_WORKLET_URL not set, using ScriptProcessor fallback");
    }

    const cleanup = () => {
      if (previewIntervalId !== null) window.clearInterval(previewIntervalId);
      analyser.disconnect();
      source.disconnect();
      if (dummyAudio.srcObject) {
        dummyAudio.pause();
        dummyAudio.srcObject = null;
      }
      audioContext.close().catch(() => {});
    };

    track.addEventListener("ended", cleanup, { once: true });

    if (useWorklet) {
      // --- NHÁNH WORKLET ---
      const processor = new AudioWorkletNode(audioContext, "audio-processor");
      source.connect(processor);
      processor.connect(audioContext.destination);

      processor.port.onmessage = (event) => {
        const int16Buffer = event.data;
        const base64 = uint8ToBase64(new Uint8Array(int16Buffer));

        post("audio-recording", {
          streamId,
          track: summarizeTrack(track),
          sampleRate: 16000,
          channels: 1,
          sampleCount: int16Buffer.byteLength / 2,
          encoding: "i16le",
          dataBase64: base64,
        });
      };
    } else {
      // --- NHÁNH FALLBACK: ScriptProcessorNode ---
      const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      const nativeRate = audioContext.sampleRate;
      const ratio = nativeRate / 16000;
      let lastSampleIndex = 0;
      const chunkDurationSamples = 16000 * 5; // 5 giây @16kHz
      const downsampled = [];

      scriptProcessor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < input.length; i++) {
          lastSampleIndex += 1;
          if (lastSampleIndex >= ratio) {
            lastSampleIndex -= ratio;
            const s = input[i];
            const int16 = s < 0 ? s * 0x8000 : s * 0x7FFF;
            downsampled.push(int16);
          }
        }

        if (downsampled.length >= chunkDurationSamples) {
          const chunk = downsampled.splice(0, chunkDurationSamples);
          const int16Arr = new Int16Array(chunk);
          const base64 = uint8ToBase64(new Uint8Array(int16Arr.buffer));

          post("audio-recording", {
            streamId,
            track: summarizeTrack(track),
            sampleRate: 16000,
            channels: 1,
            sampleCount: chunk.length,
            encoding: "i16le",
            dataBase64: base64,
          });
        }
      };
    }

    // Preview audio level (chung cho cả 2 nhánh)
    previewIntervalId = window.setInterval(() => {
      const dataArray = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(dataArray);
      let peak = 0;
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const val = Math.abs(dataArray[i]);
        if (val > peak) peak = val;
        sumSquares += val * val;
      }
      post("audio-samples", {
        streamId,
        track: summarizeTrack(track),
        sampleRate: audioContext.sampleRate,
        channels: 1,
        sampleCount: 0,
        rms: Number(Math.sqrt(sumSquares / dataArray.length).toFixed(6)),
        peak: Number(peak.toFixed(6)),
        firstSamples: Array.from(dataArray.slice(0, 24)).map((n) => Number(n.toFixed(6))),
      });
    }, 1000);
  };

  const inspectStream = (stream, constraints) => {
    const streamId = `local-${++state.streamCount}`;

    post("stream-captured", {
      streamId,
      constraints,
      tracks: stream.getTracks().map(summarizeTrack),
    });

    startMediaRecorder(stream, streamId);

    for (const track of stream.getVideoTracks()) {
      readVideoFrames(track, streamId);
    }

    for (const track of stream.getAudioTracks()) {
      readAudioSamples(stream, track, streamId);
    }
  };

  const mediaDevices = navigator.mediaDevices;

  if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
    post("hook-error", { message: "navigator.mediaDevices.getUserMedia is not available" });
    return;
  }

  const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);

  mediaDevices.getUserMedia = async (...args) => {
    // Ép trình duyệt bật chế độ lọc tiếng ồn phần cứng/trình duyệt
    let constraints = args[0] || {};
    if (constraints.audio) {
      if (typeof constraints.audio === 'boolean') {
        constraints.audio = { noiseSuppression: true, echoCancellation: true, autoGainControl: true };
      } else if (typeof constraints.audio === 'object') {
        constraints.audio.noiseSuppression = true;
        constraints.audio.echoCancellation = true;
        constraints.audio.autoGainControl = true;
      }
    }

    post("get-user-media-called", { constraints });
    const stream = await originalGetUserMedia(constraints);
    inspectStream(stream, constraints);
    return stream;
  };

  const captureMentorAudio = () => {
    const OrigPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (!OrigPeerConnection) return;

    console.log("[MeetRawData] Hooking RTCPeerConnection constructor...");

    const hookedTracks = new WeakSet();

    window.RTCPeerConnection = new Proxy(OrigPeerConnection, {
      construct(target, args) {
        const pc = new target(...args);
        
        pc.addEventListener("track", (event) => {
          if (event.track.kind === "audio") {
            if (hookedTracks.has(event.track)) return;
            hookedTracks.add(event.track);

            const streamId = `remote-${++state.streamCount}`;
            const stream = event.streams[0] || new MediaStream([event.track]);
            
            console.log(`[MeetRawData] Remote audio track detected! streamId: ${streamId}`, event.track);

            post("stream-captured", {
              streamId,
              constraints: { remote: true },
              tracks: stream.getTracks().map(summarizeTrack),
            });
            
            startMediaRecorder(stream, streamId);
            readAudioSamples(stream, event.track, streamId);
          }
        });
        
        return pc;
      }
    });

    if (window.webkitRTCPeerConnection) {
      window.webkitRTCPeerConnection = window.RTCPeerConnection;
    }
  };

  // Thực thi ngay lập tức thay vì đợi DOMContentLoaded để không bỏ lỡ các PC khởi tạo sớm
  captureMentorAudio();

  post("hook-installed", {
    userAgent: navigator.userAgent,
    hasMediaStreamTrackProcessor: "MediaStreamTrackProcessor" in window,
    hasVideoFrame: "VideoFrame" in window,
    hasAudioContext: Boolean(window.AudioContext || window.webkitAudioContext),
  });
})();
