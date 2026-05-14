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
- **Cloud Storage Integration:** Hỗ trợ lưu trữ trực tiếp lên **Vercel Blob** thay vì chỉ lưu cục bộ, trả về URL công khai ngay lập tức.

## 📊 Hiệu năng & Tối ưu hóa (Phase 0)

Hệ thống đã vượt qua giai đoạn thử nghiệm và đạt độ ổn định cao:
- **Giảm tải 65% băng thông:** Sử dụng mã hóa **Base64 Binary** thông minh, loại bỏ lỗi treo trình duyệt do xử lý JSON khổng lồ.
- **Fix Memory Leak:** Đã xử lý triệt để việc rò rỉ RAM tại Service Worker, cho phép ghi hình liên tục hàng giờ.
- **Zero CPU Spike:** Việc đóng gói dữ liệu được thực hiện theo cơ chế stream, không gây giật lag cho máy học sinh.

## 🚀 Hướng dẫn sử dụng

### 1. Khởi động Server (meet-capture-api)
```bash
cd meet-capture-api
pnpm install
# Nhớ cấu hình file .env với BLOB_READ_WRITE_TOKEN
pnpm start
```
Server sẽ hứng dữ liệu tại `http://localhost:8787` hoặc URL Vercel của bạn.

### 2. Cài đặt Extension (extension-webcam)
- Mở `chrome://extensions/`.
- Bật **Developer mode**.
- Chọn **Load unpacked** và trỏ đến thư mục `extension-webcam`.
- Sửa file `env.js` trong thư mục extension nếu muốn chuyển sang dùng Vercel API.

### 3. Xử lý hậu kỳ (Kết xuất dữ liệu)
Sau buổi học, chạy các lệnh sau tại `meet-capture-api`:
```bash
node f32-to-wav.js   # Gộp & lọc âm, xuất file .wav
node stitch.js       # Gộp nối các phân đoạn video WebM
```

## 🛠 Định hướng tiếp theo
- **Phase 1:** Triển khai **AudioWorklet** để giảm tải thêm 66% băng thông.
- **Phase 2:** Chuyển sang **Binary WebSocket** để loại bỏ hoàn toàn overhead của HTTP.