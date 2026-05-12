# Student Media Capture

Hệ thống ghi âm và hình ảnh tự động dành cho Google Meet trong mô hình dạy học 1 kèm 1 (1 Student - 1 Mentor).

## 🌟 Các tính năng đã hoàn thiện

- **Hook WebRTC (Không thể bị chặn):** Tự động can thiệp vào `RTCPeerConnection` để bắt trọn luồng âm thanh nguyên bản (raw data) của Mentor ngay khi kết nối.
- **Hệ thống xử lý âm thanh 3 lớp:**
  - *Browser Layer:* Ép Google Meet bật chế độ `noiseSuppression` và `autoGainControl` phần cứng.
  - *Capture Layer:* Bắt mẫu raw `.f32` (High-Fidelity) liền mạch 100%, không bị rớt khung hay mất mẫu âm thanh (đã fix lỗi buffer).
  - *Server Layer:* Thuật toán **Noise Gate** (ngưỡng tấn công cực nhanh) và **Auto-Gain** thông minh để khử tiếng xì nền và đẩy tiếng nói to rõ mà không vỡ tiếng.
- **Cơ chế Streaming Batch Upload:** Cứ mỗi 5 giây, dữ liệu được đóng gói và bắn thẳng về Server nội bộ, thay vì lưu ở trình duyệt.
- **Stitch Tool thông minh (Gộp file):** 
  - Tự động gom nhóm theo vai trò, đầu ra gọn gàng: `student_full_audio.wav`, `mentor_full_audio.wav`.
  - Tự động xử lý các luồng đứt quãng khi kết nối lại, ghép nối liền mạch các đoạn của cùng một đối tượng.

## ⚠️ Lưu ý Kiến trúc: Tại sao không lưu tạm vào bộ nhớ Trình duyệt học sinh?

Hệ thống được thiết kế theo cơ chế **"Thu đến đâu, vứt lên Server đến đó" (Streaming Upload)** thay vì lưu tạm vào `chrome.storage` hay `IndexedDB` trên máy học sinh. Dưới đây là những nhược điểm chí mạng của việc lưu tại trình duyệt đối với các file media lớn:

1. **Tràn RAM & Crash:** Dữ liệu `.f32` và RGBA cực kỳ nặng. Nếu giữ trong RAM sẽ khiến tab Google Meet phình to 2-4GB và dẫn đến lỗi "Aw, Snap!" (văng tab).
2. **Nghẽn cổ chai Disk I/O:** Ghi liên tục hàng chục/trăm MB xuống ổ cứng qua API trình duyệt làm máy tính (đặc biệt là ổ HDD/eMMC cũ của học sinh) bị đơ, gây giật lag cục bộ toàn bộ quá trình học.
3. **Nguy cơ mất trắng dữ liệu:** Trình duyệt có thể tự động xóa (evict) IndexedDB nếu máy tính sắp hết dung lượng ổ C. Học sinh lỡ dọn dẹp Cache/Cookie, hoặc máy sập nguồn đột ngột cũng sẽ làm bốc hơi toàn bộ dữ liệu chưa kịp xuất ra.
4. **Giới hạn Quota:** `chrome.storage` được thiết kế để lưu cài đặt (text/JSON) chứ không phải file binary media khổng lồ. Việc nhét video/audio vào đó làm Extension chạy vô cùng ì ạch.

Vì vậy, máy học sinh chỉ đóng vai trò là "đường ống" truyền dữ liệu, Server mới là nơi lưu trữ an toàn thực sự.

## 📊 Báo cáo tiến độ & Tình trạng dự án

- **Kết quả thu thập:** Đã capture thành công raw video (student) và audio (student & mentor). Bản ghi WebM (Video) có chất lượng rất rõ nét. Phần audio từ dữ liệu thô (raw) đang được tiếp tục tinh chỉnh để đạt độ rõ tương đương.
- **Hiệu năng & Rủi ro:** Hiện tại hệ thống hoạt động ổn định trên môi trường local. Tuy nhiên, việc lưu trữ/buffer dữ liệu lâu dài trên máy học sinh có nguy cơ gây tràn RAM hoặc lag trình duyệt do giới hạn tài nguyên.
- **Định hướng tối ưu:** Đang nghiên cứu chuyển đổi quy trình sang định dạng **Base64** để giảm tải CPU/RAM và tiết kiệm băng thông. Việc triển khai chính thức sẽ được thực hiện ngay khi thống nhất định dạng file đầu ra cuối cùng cho hệ thống AI.

## 🚀 Hướng dẫn sử dụng

### 1. Khởi động Server (meet-capture-api)
Mở Terminal mới và chạy lệnh:
```bash
cd meet-capture-api
npm start
```
Server sẽ hứng dữ liệu tại `http://localhost:8787`.

### 2. Gộp file cuối buổi học
Sau khi buổi học kết thúc, chạy 2 lệnh sau tại thư mục `meet-capture-api` để kết xuất dữ liệu cuối cùng:
```bash
node f32-to-wav.js   # Gộp và xử lý lọc âm, chuẩn hóa thành WAV
node stitch.js       # Gộp nối các mảnh video WebM
```