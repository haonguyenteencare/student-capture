import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const capturesRoot = path.join(__dirname, "captures");

async function stitchFiles() {
  console.log("=== CÔNG CỤ GỘP FILE WEBM ===");
  const meetings = await fs.readdir(capturesRoot).catch(() => []);

  for (const meeting of meetings) {
    if (meeting.startsWith(".")) continue;
    const meetingPath = path.join(capturesRoot, meeting);
    const students = await fs.readdir(meetingPath).catch(() => []);

    for (const student of students) {
      if (student.startsWith(".")) continue;
      const studentPath = path.join(meetingPath, student);
      const sessions = await fs.readdir(studentPath).catch(() => []);
      
      for (const session of sessions) {
        if (session.startsWith(".")) continue;
        const sessionPath = path.join(studentPath, session);

        const localDir = path.join(sessionPath, "recordings", "local");
        const remoteDir = path.join(sessionPath, "recordings", "remote");
        const oldDir = path.join(sessionPath, "recordings");

        await processDirectory(localDir, "local_full_video.webm");
        await processDirectory(remoteDir, "remote_full_video.webm");
        await processDirectory(oldDir, "old_full_video.webm");
      }
    }
  }
  console.log("Hoàn tất!");
}

async function processDirectory(dir, outputPrefix) {
  try {
    const files = await fs.readdir(dir);
    const webmFiles = files.filter(f => f.endsWith(".webm") && !f.includes("full_video")).sort();

    if (webmFiles.length === 0) return;

    // Phân nhóm theo streamId (VD: 1778559971690-local-1-0002.webm -> streamId = "local-1")
    const streams = {};
    for (const file of webmFiles) {
      const parts = file.split("-");
      // Format: timestamp-type-id-index.webm (VD: 171...-local-1-0002.webm)
      if (parts.length >= 4) {
        const streamId = `${parts[1]}-${parts[2]}`; // "local-1"
        if (!streams[streamId]) streams[streamId] = [];
        streams[streamId].push(file);
      }
    }

    for (const [streamId, chunks] of Object.entries(streams)) {
      const outputPath = path.join(dir, `${streamId}_${outputPrefix}`);
      const outputHandle = await fs.open(outputPath, "w");

      console.log(`Đang gộp ${chunks.length} chunk của luồng [${streamId}] tại: ${dir}...`);
      
      for (const file of chunks) {
        const buffer = await fs.readFile(path.join(dir, file));
        await outputHandle.write(buffer);
      }

      await outputHandle.close();
      console.log(`=> Đã tạo file: ${outputPath}`);
    }
  } catch (error) {
    // Thư mục có thể không tồn tại, bỏ qua
  }
}

stitchFiles();
