import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const capturesRoot = path.join(__dirname, "captures");

const supabase = createClient(
  process.env.SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_KEY || "placeholder-key"
);

async function syncFolder(currentPath) {
  const { data, error } = await supabase.storage.from("captures").list(currentPath, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  });

  if (error) {
    console.error(`Lỗi đọc thư mục ${currentPath || 'gốc'}:`, error.message);
    return;
  }

  if (!data || data.length === 0) return;

  for (const item of data) {
    // Supabase trả về item không có 'id' nếu nó là folder
    const isFolder = !item.id;
    const itemPath = currentPath ? `${currentPath}/${item.name}` : item.name;

    if (item.name === ".emptyFolderPlaceholder") continue;

    if (isFolder) {
      await fs.mkdir(path.join(capturesRoot, itemPath), { recursive: true });
      await syncFolder(itemPath);
    } else {
      const localFilePath = path.join(capturesRoot, itemPath);
      
      // Bỏ qua nếu file đã tồn tại ở local (tiết kiệm thời gian/băng thông)
      try {
        await fs.access(localFilePath);
        continue;
      } catch (err) {
        // File chưa có, tiến hành tải
      }

      console.log(`Đang tải: ${itemPath} ...`);
      const { data: fileData, error: downloadError } = await supabase.storage
        .from("captures")
        .download(itemPath);
        
      if (downloadError) {
        console.error(` Lỗi tải file ${itemPath}:`, downloadError.message);
        continue;
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());
      
      // Đảm bảo thư mục cha tồn tại trước khi ghi file
      await fs.mkdir(path.dirname(localFilePath), { recursive: true });
      await fs.writeFile(localFilePath, buffer);
    }
  }
}

async function startSync() {
  console.log("=== CÔNG CỤ ĐỒNG BỘ DỮ LIỆU TỪ SUPABASE ===");
  console.log("Đang quét và tải các file mới...");
  
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error(" Lỗi: Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_KEY trong file .env");
    process.exit(1);
  }

  await fs.mkdir(capturesRoot, { recursive: true });
  await syncFolder("");
  
  console.log("\nHoàn tất đồng bộ!");
}

startSync();
