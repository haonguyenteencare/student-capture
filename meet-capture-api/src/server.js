import { createClient } from "@supabase/supabase-js";
import cors from "cors";
import "dotenv/config";
import express from "express";

const port = Number(process.env.PORT || 8787);

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const sanitize = (v, fallback) =>
  String(v || "").trim().replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 120) || fallback;

const supabase = createClient(
  process.env.SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_KEY || "placeholder-key"
);

// ─── Health Check ────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Meet Capture API is running",
    storage: "Supabase Storage",
    timestamp: new Date().toISOString(),
  });
});

// ─── POST /api/capture ───────────────────────────────────────────────────────
app.post("/api/capture", async (req, res) => {
  try {
    const { sessionId, meetingId, studentId, type, at, streamId, hasWebp, hasThumb, hasRgba, uniqueId: clientUniqueId } = req.body;
    console.log(`[API] Capture request: type=${type}, hasRgba=${!!hasRgba}, hasThumb=${!!hasThumb}, stream=${streamId}`);

    const baseDir = `captures/${sanitize(meetingId, "unknown-meeting")}/${sanitize(
      studentId,
      "unknown-student",
    )}/${sanitize(sessionId, "unknown-session")}`;

    const ts = at || Date.now();
    const uniqueId = clientUniqueId || Math.random().toString(36).substring(2, 10);
    const name = `${ts}-${sanitize(streamId, "stream")}-${uniqueId}`;

    const getSignedUrl = async (path) => {
      const { data, error } = await supabase.storage
        .from("captures")
        .createSignedUploadUrl(path);
      
      if (error) {
        if (error.message?.includes("already exists") || error.statusCode === "409") {
          return { path, alreadyExists: true };
        }
        throw error;
      }
      return { path, signedUrl: data.signedUrl };
    };

    const signedUrls = {};

    if (type === "audio-chunk") {
      const subdir = String(streamId).startsWith("remote") ? "audio/remote" : "audio/local";
      signedUrls.f32 = await getSignedUrl(`${baseDir}/${subdir}/${name}.f32`);
      signedUrls.json = await getSignedUrl(`${baseDir}/${subdir}/${name}.json`);
    } 
    else if (type === "video-frame") {
      const { hasWebp, hasThumb, hasRgba } = req.body;
      if (hasWebp) signedUrls.webp = await getSignedUrl(`${baseDir}/frames/webp-${name}.webp`);
      if (hasThumb) signedUrls.thumb = await getSignedUrl(`${baseDir}/frames/thumb-${name}.jpg`);
      if (hasRgba) signedUrls.rgba = await getSignedUrl(`${baseDir}/frames/rgba-${name}.rgba`);
    } 
    else if (type === "webm-chunk") {
      signedUrls.webm = await getSignedUrl(`${baseDir}/webm/${name}.webm`);
    }

    res.json({ ok: true, signedUrls });
  } catch (err) {
    console.error("Capture error:", err.message);
    res.status(500).json({ ok: false, reason: err.message });
  }
});

// ─── Export/Start ────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Meet capture API (Supabase) → http://localhost:${port}`);
  });
}

export default app;
