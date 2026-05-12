import fs from "node:fs/promises";
import path from "node:path";

async function checkAudioLevel() {
  const dir = "D:\\Teencare\\Extension\\student-capture\\meet-capture-api\\captures\\wmj-ptau-ezc\\haohao\\meet-raw-data-2026-05-12T04-25-59-102Z-tab-1786179504\\audio";
  const files = await fs.readdir(dir);
  const remoteFiles = files.filter(f => f.includes("-remote-") && f.endsWith(".f32"));
  const file = path.join(dir, remoteFiles[0]);
  try {
    const buf = await fs.readFile(file);
    const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
    
    let min = 1, max = -1, sum = 0;
    for(let i=0; i<f32.length; i++) {
      if(f32[i] < min) min = f32[i];
      if(f32[i] > max) max = f32[i];
      sum += Math.abs(f32[i]);
    }
    const avg = sum / f32.length;
    console.log(`Min: ${min}, Max: ${max}, Avg: ${avg}`);
  } catch (err) {
    console.error(err);
  }
}

checkAudioLevel();
