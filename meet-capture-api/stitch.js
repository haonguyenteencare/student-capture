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

        await processDirectory(localDir, "student_full_video.webm");
        await processDirectory(remoteDir, "mentor_full_video.webm");
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

    // Phân nhóm theo Loại (local/remote) để gom chung Mentor/Student
    const streams = {};
    for (const file of webmFiles) {
      const parts = file.split("-");
      if (parts.length >= 4) {
        const type = parts[1]; // "local" hoặc "remote"
        if (!streams[type]) streams[type] = [];
        streams[type].push(file);
      }
    }

    for (const [type, chunks] of Object.entries(streams)) {
      const role = type === "local" ? "student" : "mentor";
      const outputPath = path.join(dir, `${role}_full_video.webm`);
      const outputHandle = await fs.open(outputPath, "w");

      console.log(`Đang gộp ${chunks.length} chunk của [${role}] tại: ${dir}...`);
      
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
