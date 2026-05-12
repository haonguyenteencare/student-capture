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

### Cơ chế Streaming Batch Upload
Thay vì lưu trữ tạm trên trình duyệt (gây nặng máy), hệ thống sử dụng cơ chế **đẩy dữ liệu liên tục về Server nội bộ mỗi 5 giây**. Điều này giúp giải quyết các nhược điểm chí mạng của việc lưu trữ tại trình duyệt:
- **Tránh tràn RAM:** Không gây lỗi "Aw, Snap!" do tích tụ dữ liệu media nặng.
- **Giảm nghẽn Disk I/O:** Không làm đơ máy học sinh (đặc biệt các máy dùng ổ HDD/eMMC cũ).
- **An toàn dữ liệu:** Dữ liệu được bảo vệ tại Server, tránh việc bị trình duyệt tự động xóa (evict) khi hết dung lượng.

### Xử lý âm thanh 3 lớp
1. **Lớp trình duyệt:** Ép bật khử nhiễu và cân bằng âm lượng phần cứng.
2. **Lớp Extension:** Thu âm raw không nén để giữ độ chi tiết cao nhất.
3. **Lớp Server:** Áp dụng thuật toán Noise Gate (tấn công nhanh) để lọc tiếng xì nền và chuẩn hóa âm lượng (Normalize).

## 4. Đánh giá hiệu năng & Rủi ro vận hành

- **Hiệu năng:** Hiện tại hệ thống đã hoạt động ổn định trên môi trường kiểm thử. Tuy nhiên, khi vận hành thực tế trên các máy tính cấu hình yếu của học sinh trong thời gian dài (>60 phút), vẫn cần giám sát chặt chẽ mức độ chiếm dụng tài nguyên.
- **Rủi ro:** Duy trì ghi dữ liệu liên tục có thể dẫn đến lag nhẹ nếu CPU máy học sinh quá yếu. Việc tối ưu hóa bằng định dạng Base64 đang được xem xét để giảm tải thêm.

## 5. Hướng phát triển & Đề xuất tiếp theo

- **Tối ưu hóa dữ liệu:** Nghiên cứu chuyển đổi quy trình truyền tải sang định dạng **Base64**. Phương pháp này giúp việc đóng gói gửi về server nhẹ nhàng hơn, giảm áp lực lên RAM và CPU. (Hiện đang chờ xác nhận định dạng đầu ra cuối cùng để triển khai).
- **Kiểm thử áp lực (Stress Test):** Thực hiện đánh giá trên quy mô 40 máy chạy đồng thời để xác định ngưỡng giới hạn của Server.
- **Cải thiện Audio:** Tiếp tục tinh chỉnh thuật toán lọc nhiễu cho luồng Raw Audio để đạt chất lượng tương đương với bản ghi WebM nén.

---
*Ngày báo cáo: 12/05/2026*
*Trạng thái: Đã bàn giao mã nguồn và tài liệu hướng dẫn.*
