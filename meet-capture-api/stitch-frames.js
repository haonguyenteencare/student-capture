import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const capturesRoot = path.join(__dirname, "captures");

async function stitchFrames() {
  console.log("=== CÔNG CỤ GỘP ẢNH THÀNH VIDEO ===");
  
  try {
    const meetings = await fs.readdir(capturesRoot).catch(() => []);

    for (const meeting of meetings) {
      if (meeting.startsWith(".")) continue;
      const meetingPath = path.join(capturesRoot, meeting);
      const students = await fs.readdir(meetingPath).catch(() => []);

      for (const student of students) {
        const studentPath = path.join(meetingPath, student);
        const sessions = await fs.readdir(studentPath).catch(() => []);
        
        for (const session of sessions) {
          const framesDir = path.join(studentPath, session, "frames");
          
          try {
            const files = await fs.readdir(framesDir);
            const jpgFiles = files.filter(f => f.endsWith(".jpg")).sort();

            if (jpgFiles.length === 0) continue;

            console.log(`Đang xử lý: ${student} - ${session} (${jpgFiles.length} ảnh)...`);

            // Tạo file danh sách cho FFmpeg (vì tên file có timestamp không liên tục)
            const concatFilePath = path.join(framesDir, "input.txt");
            let concatContent = "";
            
            // Mỗi frame cách nhau khoảng 3 giây (theo cấu hình hook.js)
            for (const file of jpgFiles) {
              concatContent += `file '${file}'\nduration 3\n`;
            }
            // Frame cuối cùng cần lặp lại để FFmpeg không bị mất
            if (jpgFiles.length > 0) {
                concatContent += `file '${jpgFiles[jpgFiles.length-1]}'\n`;
            }

            await fs.writeFile(concatFilePath, concatContent);

            const outputPath = path.join(framesDir, "timelapse_video.mp4");
            
            // Lệnh FFmpeg:
            // -f concat: gộp file theo danh sách
            // -i input.txt: file danh sách vừa tạo
            // -vsync vfr: variable frame rate
            // -pix_fmt yuv420p: định dạng tương thích mọi trình xem video
            const ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${concatFilePath}" -c:v libx264 -pix_fmt yuv420p -r 10 "${outputPath}"`;

            await execAsync(ffmpegCmd);
            
            // Xóa file tạm
            await fs.unlink(concatFilePath);
            
            console.log(`✅ Đã tạo video: ${outputPath}`);
          } catch (e) {
            // Thư mục frames không tồn tại hoặc lỗi khác, bỏ qua
          }
        }
      }
    }
    console.log("Hoàn tất!");
  } catch (err) {
    console.error("Lỗi:", err.message);
  }
}

stitchFrames();
