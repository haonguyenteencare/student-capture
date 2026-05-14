# Kịch Bản Stress Test: Google Meet Capture

Tài liệu này mô tả các kịch bản kiểm thử chịu tải (Stress Test) và độ ổn định thực tế (Field Test) dành cho hệ thống Meet Capture.

## 💻 Môi trường thử nghiệm
- **Tổng số máy:** 5 máy tính.
- **Mentor (Giáo viên):** 1 máy tính (Tạo phòng Google Meet, KHÔNG cần cài Extension).
- **Student (Học sinh):** 4 máy tính (Tham gia phòng Meet, CẢ 4 máy ĐỀU cài đặt Extension).
- **Môi trường Server:** Vercel Blob (Sử dụng link thật `https://student-capture.vercel.app`).

---

## 🧪 Kịch bản 1: Concurrent Load (Tải đồng thời liên tục)
**Mục đích:** Kiểm tra khả năng chịu tải của Vercel Blob và hiệu năng của extension khi 4 học sinh cùng ghi hình và upload trong 1 phòng.
**Các bước:**
1. Mentor tạo 1 phòng Google Meet.
2. 4 Student nhập 4 **Tên lớp** khác nhau vào Popup (VD: `Class-1`, `Class-2`, `Class-3`, `Class-4`).
3. Cả 4 Student cùng Join vào phòng Meet gần như cùng lúc.
4. Bật camera và micro trên cả 4 máy Student và 1 máy Mentor. Mentor thực hiện nói chuyện liên tục, chia sẻ màn hình.
5. Duy trì phòng học ít nhất **45 - 60 phút**.
**Kỳ vọng:**
- Các máy tính Student không bị giật lag, CPU không bị quá tải (Spike).
- Server Vercel không trả về lỗi `HTTP 429 (Too Many Requests)` hoặc `500`.
- Kiểm tra Vercel Blob Dashboard: Có đủ dữ liệu cho cả 4 thư mục `Class-1` đến `Class-4`.

---

## 🧪 Kịch bản 2: Network Drop & Recovery (Mô phỏng đứt mạng)
**Mục đích:** Kiểm tra cơ chế IndexedDB Buffering và Auto-Flush khi bị rớt mạng thực tế.
**Các bước:**
1. Trong lúc cả 4 Student đang trong phòng (như Kịch bản 1).
2. Rút dây mạng/Tắt Wifi đột ngột ở **Student 1** và **Student 2**.
3. Đợi 5 phút. 
   - Kiểm tra xem 2 máy này có hiện Màn hình đỏ cảnh báo "Mất kết nối Internet" không.
   - Kiểm tra Popup xem số lượng `chunk chờ gửi` có tăng dần không.
4. Bật lại Wifi cho **Student 1** và **Student 2**.
**Kỳ vọng:**
- Khi mất mạng, luồng ghi âm/ghi hình không bị crash. Tab không bị treo.
- Khi có mạng lại, Màn hình đỏ tự biến mất.
- Popup hiển thị số `chunk` giảm dần về 0 (Auto-Flush thành công).
- Không có khoảng trống (gap) dữ liệu của 2 máy này trên Vercel sau khi upload bù.

---

## 🧪 Kịch bản 3: Landing Page & Green Room Bypass (Lọc trang chờ)
**Mục đích:** Đảm bảo hệ thống không gửi rác (junk data) khi chưa chính thức vào phòng.
**Các bước:**
1. **Student 3** bấm vào link Meet nhưng CHỈ ở trang chuẩn bị (Green Room / Landing).
2. Để máy chờ ở màn hình này khoảng 10 phút. Ngồi nói chuyện và di chuyển trước camera.
3. Sau 10 phút, bấm nút **Tham gia (Join)**.
**Kỳ vọng:**
- Trong suốt 10 phút chờ, **tuyệt đối không có file nào** của Student 3 được upload lên Vercel.
- Dữ liệu (Audio/Video/WebM) chỉ bắt đầu được tạo trên Vercel kể từ thời điểm bấm nút Join.

---

## 🧪 Kịch bản 4: Remote Audio Hooking (Thu âm Mentor)
**Mục đích:** Đảm bảo cơ chế can thiệp `RTCPeerConnection` hoạt động tốt với nhiều client, không bị mất tiếng của Mentor.
**Các bước:**
1. Bốn máy Student đều tắt Micro (Mute). Chỉ duy nhất Mentor bật Micro.
2. Mentor đọc 1 đoạn văn bản dài 3 phút.
3. Sau buổi test, tải file F32 của thư mục `audio/remote/` của cả 4 Student về máy.
4. Dùng tool `f32-to-wav.js` chuyển đổi sang đuôi `.wav`.
**Kỳ vọng:**
- Cả 4 file `wav` của 4 Student đều có tiếng của Mentor đọc đoạn văn bản đó rõ ràng, không bị méo tiếng, không bị đứt quãng.

---

## 🧪 Kịch bản 5: Late Join & Tab Reload (F5 giữa chừng)
**Mục đích:** Xử lý trường hợp người dùng lỡ tay tải lại trang web hoặc vào trễ.
**Các bước:**
1. **Student 4** đang học được 15 phút, đột ngột ấn `F5` tải lại trang Google Meet.
2. **Student 4** bị văng ra trang chuẩn bị, sau đó bấm Join lại vào phòng.
**Kỳ vọng:**
- Sau khi F5, Extension tự động khởi tạo lại quá trình ghi (Sinh ra một `sessionId` mới).
- Dữ liệu trước khi F5 và sau khi F5 được tách thành 2 thư mục `session-...` khác nhau trên Vercel, dữ liệu hoàn toàn không bị hỏng hay ghi đè.
