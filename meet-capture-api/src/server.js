import cors from "cors";
import express from "express";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const capturesRoot = path.join(projectRoot, "captures");
const port = Number(process.env.PORT || 8787);

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "250mb" }));
app.use("/captures", express.static(capturesRoot));

const sanitize = (v, fallback) =>
  String(v || "").trim().replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 120) || fallback;

// ─── POST /api/capture ───────────────────────────────────────────────────────
app.post("/api/capture", async (req, res) => {
  try {
    const { sessionId, meetingId, studentId, type, payload, at } = req.body;

    const dir = path.join(
      capturesRoot,
      sanitize(meetingId, "unknown-meeting"),
      sanitize(studentId, "unknown-student"),
      sanitize(sessionId, "unknown-session"),
    );
    await mkdir(dir, { recursive: true });

    const ts = at || Date.now();

    // ── Audio F32 raw ──
    if (type === "audio-chunk") {
      const { streamId, sampleRate, sampleCount, encoding, dataBase64 } = payload;
      const subdir = String(streamId).startsWith("remote") ? "audio/remote" : "audio/local";
      await mkdir(path.join(dir, subdir), { recursive: true });
      const name = `${ts}-${sanitize(streamId, "stream")}`;
      await writeFile(path.join(dir, subdir, `${name}.f32`), Buffer.from(dataBase64, "base64"));
      await writeFile(
        path.join(dir, subdir, `${name}.json`),
        JSON.stringify({ sampleRate, sampleCount, encoding }),
      );
      console.log(`[audio] ${subdir}/${name}.f32 (${sampleCount} samples @ ${sampleRate}Hz)`);
    }

    // ── Video RGBA + JPEG thumbnail ──
    else if (type === "video-frame") {
      const { streamId, width, height, rgbaBase64, thumbDataUrl } = payload;
      await mkdir(path.join(dir, "frames"), { recursive: true });
      const name = `${ts}-${sanitize(streamId, "stream")}`;
      await writeFile(
        path.join(dir, "frames", `${name}.rgba`),
        Buffer.from(rgbaBase64, "base64"),
      );
      if (thumbDataUrl) {
        const b64 = thumbDataUrl.split(",")[1];
        await writeFile(path.join(dir, "frames", `${name}.jpg`), Buffer.from(b64, "base64"));
      }
      console.log(`[video] frames/${name}.rgba (${width}x${height})`);
    }

    // ── WebM chunk ──
    else if (type === "webm-chunk") {
      const { streamId, dataBase64 } = payload;
      await mkdir(path.join(dir, "webm"), { recursive: true });
      const name = `${ts}-${sanitize(streamId, "stream")}`;
      await writeFile(path.join(dir, "webm", `${name}.webm`), Buffer.from(dataBase64, "base64"));
      console.log(`[webm] webm/${name}.webm`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Capture error:", err.message);
    res.status(500).json({ ok: false, reason: err.message });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────
await mkdir(capturesRoot, { recursive: true });

app.listen(port, () => {
  console.log(`Meet capture API → http://localhost:${port}`);
  console.log(`Captures root    → ${capturesRoot}`);
});
