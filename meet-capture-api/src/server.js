import { put } from "@vercel/blob";
import cors from "cors";
import "dotenv/config";
import express from "express";

const port = Number(process.env.PORT || 8787);

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "250mb" }));

const sanitize = (v, fallback) =>
  String(v || "").trim().replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 120) || fallback;

// ─── Health Check ────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Meet Capture API is running",
    storage: "Vercel Blob",
    timestamp: new Date().toISOString(),
  });
});

// ─── POST /api/capture ───────────────────────────────────────────────────────
app.post("/api/capture", async (req, res) => {
  try {
    const { sessionId, meetingId, studentId, type, payload, at } = req.body;

    const baseDir = `captures/${sanitize(meetingId, "unknown-meeting")}/${sanitize(
      studentId,
      "unknown-student",
    )}/${sanitize(sessionId, "unknown-session")}`;

    const ts = at || Date.now();
    const results = {};

    // ── Audio F32 raw ──
    if (type === "audio-chunk") {
      const { streamId, sampleRate, sampleCount, encoding, dataBase64 } = payload;
      const subdir = String(streamId).startsWith("remote") ? "audio/remote" : "audio/local";
      const name = `${ts}-${sanitize(streamId, "stream")}`;
      const pathF32 = `${baseDir}/${subdir}/${name}.f32`;
      const pathJson = `${baseDir}/${subdir}/${name}.json`;

      const [blobF32, blobJson] = await Promise.all([
        put(pathF32, Buffer.from(dataBase64, "base64"), {
          access: "public",
          contentType: "application/octet-stream",
        }),
        put(pathJson, JSON.stringify({ sampleRate, sampleCount, encoding }), {
          access: "public",
          contentType: "application/json",
        }),
      ]);

      results.f32 = blobF32.url;
      results.json = blobJson.url;
      console.log(`[audio] Uploaded to Vercel Blob: ${blobF32.url}`);
    }

    // ── Video RGBA + JPEG thumbnail ──
    else if (type === "video-frame") {
      const { streamId, width, height, rgbaBase64, thumbDataUrl } = payload;
      const name = `${ts}-${sanitize(streamId, "stream")}`;
      const pathRgba = `${baseDir}/frames/${name}.rgba`;

      const uploads = [
        put(pathRgba, Buffer.from(rgbaBase64, "base64"), {
          access: "public",
          contentType: "application/octet-stream",
        }),
      ];

      if (thumbDataUrl) {
        const b64 = thumbDataUrl.split(",")[1];
        const pathJpg = `${baseDir}/frames/${name}.jpg`;
        uploads.push(
          put(pathJpg, Buffer.from(b64, "base64"), {
            access: "public",
            contentType: "image/jpeg",
          }),
        );
      }

      const blobs = await Promise.all(uploads);
      results.rgba = blobs[0].url;
      if (blobs[1]) results.jpg = blobs[1].url;
      console.log(`[video] Uploaded to Vercel Blob: ${blobs[0].url}`);
    }

    // ── WebM chunk ──
    else if (type === "webm-chunk") {
      const { streamId, dataBase64 } = payload;
      const name = `${ts}-${sanitize(streamId, "stream")}`;
      const pathWebm = `${baseDir}/webm/${name}.webm`;

      const blobWebm = await put(pathWebm, Buffer.from(dataBase64, "base64"), {
        access: "public",
        contentType: "video/webm",
      });

      results.webm = blobWebm.url;
      console.log(`[webm] Uploaded to Vercel Blob: ${blobWebm.url}`);
    }

    res.json({ ok: true, urls: results });
  } catch (err) {
    console.error("Capture error:", err.message);
    res.status(500).json({ ok: false, reason: err.message });
  }
});

// ─── Export/Start ────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Meet capture API (Vercel Blob) → http://localhost:${port}`);
  });
}

export default app;
