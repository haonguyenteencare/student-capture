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
  
  const gain = maxPeak > 0.02 ? Math.min(8.0, 0.9 / maxPeak) : 1.0;

  // 2. Noise Gate
  let envelope = 0;
  const attack = 0.4;
  const release = 0.002;
  const noiseThreshold = 0.005;
  for (const sample of samples) {
    const absSample = Math.abs(sample);
    if (absSample > envelope) envelope += attack * (absSample - envelope);
    else envelope += release * (absSample - envelope);

    let gateMultiplier = 1.0;
    if (envelope < noiseThreshold) gateMultiplier = Math.pow(envelope / noiseThreshold, 2); 

    let processed = sample * gain * gateMultiplier;
    const clamped = Math.max(-1, Math.min(1, processed));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return Buffer.from(buffer);
}

async function findAudioDirs(root) {
  let results = [];
  const list = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of list) {
    const res = path.resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "audio" || entry.name === "local" || entry.name === "remote") {
        results.push(res);
      }
      results = results.concat(await findAudioDirs(res));
    }
  }
  return results;
}

async function convertAudio() {
  console.log("=== CÔNG CỤ CHUYỂN ĐỔI AUDIO SANG .wav ===");
  console.log(`Đang quét thư mục: ${capturesRoot}`);
  
  const audioDirs = await findAudioDirs(capturesRoot);
  // Loại bỏ trùng lặp và sắp xếp
  const uniqueDirs = [...new Set(audioDirs)].sort();

  for (const dir of uniqueDirs) {
    await processDirectory(dir);
  }
  
  console.log("\nHoàn tất!");
}

async function processDirectory(dir) {
  try {
    const files = await fs.readdir(dir);
    // Lọc các file audio thô (.f32 hoặc .bin)
    const audioFiles = files.filter(f => (f.endsWith(".f32") || f.endsWith(".bin")) && !f.includes("full_audio")).sort();

    if (audioFiles.length === 0) return;

    // Phân nhóm theo streamId (ví dụ: local-1, remote-2)
    const streams = {};
    for (const file of audioFiles) {
      const parts = file.split("-");
      if (parts.length >= 2) {
        // Lấy định danh stream (ví dụ: local-1)
        const streamId = `${parts[1]}-${parts[2]}`;
        if (!streams[streamId]) streams[streamId] = [];
        streams[streamId].push(file);
      } else {
        // Fallback nếu tên file không đúng định dạng
        if (!streams["misc"]) streams["misc"] = [];
        streams["misc"].push(file);
      }
    }

    for (const [streamId, chunks] of Object.entries(streams)) {
      console.log(`\nĐang gộp ${chunks.length} chunk cho stream [${streamId}] tại: ${path.relative(capturesRoot, dir)}`);
      
      let sampleRate = 48000;
      let totalLength = 0;
      const buffers = [];
      let currentEncoding = "f32le";

      for (const file of chunks) {
        const baseName = file.replace(/\.(f32|bin)$/, "");
        const jsonFile = baseName + ".json";
        
        try {
          try {
            const jsonContent = JSON.parse(await fs.readFile(path.join(dir, jsonFile), "utf8"));
            if (jsonContent.sampleRate) sampleRate = jsonContent.sampleRate;
            if (jsonContent.encoding) currentEncoding = jsonContent.encoding;
          } catch {
            // Không có json thì giữ mặc định
          }
          
          const fileBuffer = await fs.readFile(path.join(dir, file));
          let float32Array;
          
          if (currentEncoding === "i16le") {
            const int16Array = new Int16Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength / 2);
            float32Array = new Float32Array(int16Array.length);
            for (let i = 0; i < int16Array.length; i++) {
              float32Array[i] = int16Array[i] / 32768.0;
            }
          } else {
            float32Array = new Float32Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength / 4);
          }
          
          buffers.push(float32Array);
          totalLength += float32Array.length;
        } catch (err) {
          console.error(`Lỗi đọc chunk ${file}:`, err.message);
        }
      }

      if (buffers.length > 0) {
        const combined = new Float32Array(totalLength);
        let offset = 0;
        for (const buffer of buffers) {
          combined.set(buffer, offset);
          offset += buffer.length;
        }

        const wavBuffer = encodeWav(combined, sampleRate);
        const outputPath = path.join(dir, `${streamId}_full_audio.wav`);
        await fs.writeFile(outputPath, wavBuffer);
        console.log(`  => Đã tạo file: ${path.basename(outputPath)}`);
      }
    }
  } catch (error) {
    console.error(`Lỗi xử lý thư mục ${dir}:`, error.message);
  }
}

convertAudio();
