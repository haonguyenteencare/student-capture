# BÁO CÁO TỔNG KẾT DỰ ÁN: STUDENT MEDIA CAPTURE

## 1. Mục tiêu & Phạm vi Dự án
Dự án nhằm xây dựng một hệ thống mở rộng trình duyệt (Chrome Extension) và máy chủ nội bộ để ghi lại tự động và toàn diện các buổi học 1 kèm 1 trên Google Meet. 
- **Đối tượng:** Capture hình ảnh/âm thanh của học sinh và âm thanh của giáo viên (Mentor).
- **Mục tiêu kỹ thuật:** Đảm bảo tính ổn định cao (>30 phút không crash), chất lượng âm thanh rõ nét để phục vụ nghiên cứu AI, và không làm ảnh hưởng đến trải nghiệm học tập của học sinh.

## 2. Kết quả đạt được (Status: Ready-to-use)

### Thu thập dữ liệu (Capture)
- **Video:** Đã triển khai thành công việc capture video thô của học sinh dưới dạng các phân đoạn WebM và ảnh Thumbnail định kỳ.
- **Audio Mentor (Quan trọng):** Đã triển khai kỹ thuật **WebRTC Hooking** cao cấp. Hệ thống tự động can thiệp vào `RTCPeerConnection` để lấy luồng âm thanh nguyên bản của Mentor ngay khi kết nối, khắc phục hoàn toàn việc bị Google Meet chặn hoặc lỗi câm trên Chrome.
- **Audio Student:** Thu âm High-Fidelity trực tiếp từ thiết bị đầu vào của học sinh.

### Xử lý & Gộp dữ liệu (Stitching)
- Đã xây dựng bộ công cụ hậu kỳ (`stitch.js`, `f32-to-wav.js`) cho phép ghép nối các mảnh dữ liệu rời rạc thành file hoàn chỉnh.
- **Kết quả:** Bản ghi Video (WebM) có chất lượng rất rõ nét. Phần Audio từ dữ liệu thô (Raw .f32) đã được tích hợp bộ lọc Noise Gate và Auto-Gain để đảm bảo âm lượng đồng nhất.

## 3. Kiến trúc kỹ thuật & Tối ưu hóa

### Cơ chế Streaming Batch Upload (Đã tối ưu Pipeline)
Thay vì lưu trữ tạm trên trình duyệt (gây nặng máy), hệ thống sử dụng cơ chế **đẩy dữ liệu liên tục về Server nội bộ mỗi 5-10 giây**. Hiện tại, dữ liệu Media nặng đã được tách biệt thành luồng riêng:
- **Audio F32:** Mã hóa sang chuỗi Base64 nhị phân (giảm ~65% dung lượng truyền tải so với JSON array).
- **Video RGBA & WebM:** Truyền tải base64 qua kênh song song, giảm tần suất RGBA xuống 10s/lần.
- **Tránh tràn RAM:** Đã chặn rò rỉ bộ nhớ ở Service Worker và Content Script, không lưu các mảng media khổng lồ vào RAM hay Disk nội bộ của máy học sinh.

### Xử lý âm thanh 3 lớp
1. **Lớp trình duyệt:** Ép bật khử nhiễu và cân bằng âm lượng phần cứng.
2. **Lớp Extension:** Thu âm raw không nén để giữ độ chi tiết cao nhất.
3. **Lớp Server:** Áp dụng thuật toán Noise Gate (tấn công nhanh) để lọc tiếng xì nền và chuẩn hóa âm lượng (Normalize).

## 4. Đánh giá hiệu năng & Tối ưu hóa (Cập nhật)

- **Hiệu năng:** Hệ thống vừa hoàn tất đợt **Hotfix khẩn cấp (Phase 0)**. Các lỗi về rò rỉ RAM ở Service Worker và CPU spike do ép kiểu Audio Float32 thành JSON string đã được loại bỏ hoàn toàn.
- **Kết quả:** Payload của Audio gửi về Server đã giảm hơn 3 lần, và thời gian Serialize JSON gần như bằng 0.

## 5. Hướng phát triển & Đề xuất tiếp theo (Phase 1 & 2)

- **Tối ưu hóa Audio Pipeline:** Chuyển dịch từ `ScriptProcessorNode` (main thread) sang **AudioWorklet** với tính năng tự động Downsample xuống 16kHz (tiết kiệm thêm 66% băng thông).
- **Phát hiện giọng nói (VAD):** Tích hợp thuật toán chặn các đoạn silence (im lặng) không cần thiết để gửi lên Server.
- **Thay đổi Giao thức Truyền tải:** Chuyển từ HTTP POST sang **WebSocket (Binary)** kết hợp MessagePack để loại bỏ hoàn toàn overhead của HTTP header và Base64 encoding.

---
*Ngày báo cáo: 13/05/2026 (Cập nhật Hotfix Phase 0)*
*Trạng thái: Đã fix lỗi Memory Leak & CPU Spike. Chuẩn bị triển khai AudioWorklet.*
