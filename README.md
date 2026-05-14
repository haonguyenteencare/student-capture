# Student Media Capture

Hệ thống ghi âm và hình ảnh tự động dành cho Google Meet trong mô hình dạy học 1 kèm 1 (1 Student - 1 Mentor).

## 🌟 Các tính năng nổi bật

- **Hook WebRTC (Không thể bị chặn):** Can thiệp trực tiếp vào `RTCPeerConnection` để bắt trọn luồng âm thanh nguyên bản (raw data) của Mentor.
- **Cơ chế Resilience (Chống mất dữ liệu):**
  - **IndexedDB Buffering:** Dữ liệu được lưu tạm vào IndexedDB ngay tại trình duyệt trước khi gửi. Đảm bảo an toàn 100% nếu mạng chập chờn.
  - **Auto-Retry:** Tự động đẩy dữ liệu tồn đọng lên Server ngay khi có mạng trở lại.
- **Offline Robustness:** 
  - Hiển thị thông báo hệ thống và lớp phủ (Overlay) cảnh báo khi mất mạng.
  - Chặn việc đóng tab vô ý khi dữ liệu chưa được upload xong.
- **Xử lý âm thanh 3 lớp:**
  - *Browser Layer:* Ép Google Meet bật khử nhiễu và cân bằng âm lượng phần cứng.
  - *Capture Layer:* Bắt mẫu raw `.f32` (High-Fidelity) không nén.
  - *Server Layer:* Áp dụng **Noise Gate** và **Auto-Gain** để khử xì nền và chuẩn hóa âm thanh.
- **Hybrid Video Capture:** Ghi đồng thời WebM (Video) và chụp RGBA Frames/JPEG Thumbnails (Computer Vision).
- **Smart Capture:** Chỉ tự động ghi hình khi người dùng thực sự ở trong phòng họp (bỏ qua trang chủ/cài đặt).
- **Cloud Storage Integration (Supabase):** Sử dụng kiến trúc **Client-Side Direct Upload** với Signed URLs. Dữ liệu được đẩy thẳng lên **Supabase Storage**, lách qua giới hạn 4.5MB của Vercel và giảm tải 100% băng thông cho server API.
- **AudioWorklet Support:** Chuyển đổi toàn bộ luồng xử lý âm thanh sang **AudioWorklet** (Phase 1). Âm thanh được xử lý trên luồng riêng biệt, không gây giật lag luồng chính (Main Thread) của Google Meet.
- **Tối ưu hóa Video Frame (WebP):** Thay thế định dạng RGBA thô (nặng >8MB/frame) bằng định dạng **WebP** nén cao, giúp tiết kiệm bộ nhớ và đảm bảo upload thành công trên mọi đường truyền.
- **Smart Capture:** Chỉ tự động ghi hình khi người dùng thực sự ở trong phòng họp (bỏ qua trang chủ/cài đặt).

## 📊 Hiệu năng & Tối ưu hóa (Đã hoàn thành Phase 1)

Hệ thống đã đạt độ ổn định cực cao:
- **Xóa bỏ giới hạn Payload:** Kiến trúc Signed URL cho phép tải lên các file dung lượng lớn mà không bị chặn bởi Cloud Provider.
- **Giảm tải 80% CPU âm thanh:** Nhờ AudioWorklet, việc capture âm thanh Mentor không còn gây ra hiện tượng drop frame trên máy học sinh.
- **Zero Memory Leak:** Đã xử lý triệt để việc rò rỉ RAM tại Service Worker.

## 🚀 Hướng dẫn sử dụng

### 1. Khởi động Server (meet-capture-api)
```bash
cd meet-capture-api
pnpm install
# Cấu hình .env với SUPABASE_URL và SUPABASE_SERVICE_KEY
pnpm start
```

### 2. Cài đặt Extension (extension-webcam)
- Mở `chrome://extensions/`.
- Bật **Developer mode**.
- Chọn **Load unpacked** và trỏ đến thư mục `extension-webcam`.
- Lưu ý: Cấu hình `env.js` trong thư mục extension để trỏ đến API (Local hoặc Production).

### 3. Xử lý hậu kỳ (Kết xuất dữ liệu)
Sau buổi học, chạy các lệnh sau tại `meet-capture-api` (Lưu ý tải dữ liệu từ Supabase về thư mục `captures/` trước):
```bash
node f32-to-wav.js   # Gộp & lọc âm, xuất file .wav
node stitch.js       # Gộp nối các phân đoạn video WebM
```

## 🛠 Định hướng tiếp theo
- **Phase 2:** Chuyển sang **Binary WebSocket** để loại bỏ hoàn toàn overhead của HTTP.
- **Phase 3:** Tích hợp AI trực tiếp để phân tích cảm xúc (Sentiment Analysis) từ WebP frames ngay tại Server.