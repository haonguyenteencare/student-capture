import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const capturesRoot = path.join(__dirname, "captures");

// Hàm chuyển đổi raw Float32 sang định dạng WAV 16-bit PCM
function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  let offset = 0;

  const writeString = (value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset, value.charCodeAt(index));
      offset += 1;
    }
  };

  writeString("RIFF");
  view.setUint32(offset, 36 + samples.length * bytesPerSample, true);
  offset += 4;
  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true); // PCM format
  offset += 2;
  view.setUint16(offset, 1, true); // 1 channel (mono)
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * bytesPerSample, true); // Byte rate
  offset += 4;
  view.setUint16(offset, bytesPerSample, true); // Block align
  offset += 2;
  view.setUint16(offset, 16, true); // Bits per sample
  offset += 2;
  writeString("data");
  view.setUint32(offset, samples.length * bytesPerSample, true);
  offset += 4;

  // 1. Quét tìm Peak để Normalize (tránh rè do quá tải)
  let maxPeak = 0;
  for (const sample of samples) {
    if (Math.abs(sample) > maxPeak) maxPeak = Math.abs(sample);
  }
  
  // Auto-gain thông minh: 
  // - Chỉ khuếch đại nếu có tín hiệu rõ ràng (Peak > 0.02).
  // - Nếu toàn tiếng xì nhỏ, giữ nguyên âm lượng gốc (gain=1) để không làm to tiếng ồn.
  const gain = maxPeak > 0.02 ? Math.min(8.0, 0.9 / maxPeak) : 1.0;

  // 2. Noise Gate chất lượng cao
  let envelope = 0;
  const attack = 0.4; // Tấn công cực nhanh để bắt trọn âm đầu
  const release = 0.002; // Giải phóng mượt mà
  const noiseThreshold = 0.005; // Hạ thấp ngưỡng để không bị "ăn" mất giọng nói nhẹ
  for (const sample of samples) {
    const absSample = Math.abs(sample);
    
    // Envelope follower mượt mà
    if (absSample > envelope) {
      envelope += attack * (absSample - envelope);
    } else {
      envelope += release * (absSample - envelope);
    }

    // Áp dụng Gate: Giảm âm lượng mạnh khi dưới ngưỡng nhiễu
    let gateMultiplier = 1.0;
    if (envelope < noiseThreshold) {
      gateMultiplier = Math.pow(envelope / noiseThreshold, 2); 
    }

    // Áp dụng Gain và Gate
    let processed = sample * gain * gateMultiplier;
    
    // Clamp an toàn về phạm vi [-1, 1]
    const clamped = Math.max(-1, Math.min(1, processed));
    
    // Ghi vào định dạng 16-bit PCM
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return Buffer.from(buffer);
}

async function convertAudio() {
// ... không thay đổi hàm convertAudio
  console.log("=== CÔNG CỤ CHUYỂN ĐỔI .f32 SANG .wav ===");
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

        const localDir = path.join(sessionPath, "audio", "local");
        const remoteDir = path.join(sessionPath, "audio", "remote");
        const oldDir = path.join(sessionPath, "audio"); // Dành cho cấu trúc cũ

        await processDirectory(localDir, "local_full_audio.wav");
        await processDirectory(remoteDir, "remote_full_audio.wav");
        await processDirectory(oldDir, "old_full_audio.wav");
      }
    }
  }
  console.log("Hoàn tất!");
}

async function processDirectory(dir, outputPrefix) {
  try {
    const files = await fs.readdir(dir);
    const audioFiles = files.filter(f => (f.endsWith(".f32") || f.endsWith(".bin")) && !f.includes("full_audio")).sort();

    if (audioFiles.length === 0) return;

    // Phân nhóm theo Loại (local/remote) thay vì streamId chi tiết để gom chung Mentor/Student
    const streams = {};
    for (const file of audioFiles) {
      const parts = file.split("-");
      if (parts.length >= 4) {
        const type = parts[1]; // "local" hoặc "remote"
        if (!streams[type]) streams[type] = [];
        streams[type].push(file);
      }
    }

    for (const [type, chunks] of Object.entries(streams)) {
      if (chunks.length === 0) continue;

      const role = type === "local" ? "student" : "mentor";
      console.log(`Đang gộp ${chunks.length} chunk Audio của [${role}] tại: ${dir}...`);
      
      let sampleRate = 48000;
      let totalLength = 0;
      const buffers = [];

      for (const file of chunks) {
        const baseName = file.replace(/\.(f32|bin)$/, "");
        const jsonFile = baseName + ".json";
        
        try {
          let encoding = "f32le";
          try {
            const jsonContent = JSON.parse(await fs.readFile(path.join(dir, jsonFile), "utf8"));
            if (jsonContent.sampleRate) sampleRate = jsonContent.sampleRate;
            if (jsonContent.encoding) encoding = jsonContent.encoding;
          } catch {
            console.warn(`[WARN] Không tìm thấy metadata ${jsonFile} — mặc định đọc theo F32. Audio có thể sai nếu thực tế là I16!`);
          }
          
          const fileBuffer = await fs.readFile(path.join(dir, file));
          let float32Array;
          
          if (encoding === "i16le") {
            // TypedArray view — zero-copy, không cần loop
            const int16Array = new Int16Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength / 2);
            float32Array = new Float32Array(int16Array.length);
            for (let i = 0; i < int16Array.length; i++) {
              float32Array[i] = int16Array[i] / 32768.0;
            }
          } else {
            // TypedArray view thay vì loop readFloatLE — tránh alignment issue
            float32Array = new Float32Array(
              fileBuffer.buffer,
              fileBuffer.byteOffset,
              fileBuffer.byteLength / 4,
            );
          }
          
          buffers.push(float32Array);
          totalLength += float32Array.length;
        } catch (err) {
          console.error(`Lỗi đọc chunk ${file}:`, err.message);
        }
      }

      if (buffers.length > 0) {
        // Gộp tất cả Float32Array lại
        const combined = new Float32Array(totalLength);
        let offset = 0;
        for (const buffer of buffers) {
          combined.set(buffer, offset);
          offset += buffer.length;
        }

        const wavBuffer = encodeWav(combined, sampleRate);
        const role = type === "local" ? "student" : "mentor";
        const outputPath = path.join(dir, `${role}_full_audio.wav`);
        await fs.writeFile(outputPath, wavBuffer);
        console.log(`=> Đã tạo file: ${outputPath}`);
      }
    }
  } catch (error) {
    // Thư mục có thể không tồn tại
  }
}

convertAudio();
