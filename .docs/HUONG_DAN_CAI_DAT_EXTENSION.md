# Hướng Dẫn Cài Đặt và Sử Dụng Extension Google Meet Capture

Tài liệu này hướng dẫn bạn cách cài đặt, cấu hình và sử dụng Extension để ghi lại dữ liệu buổi học trên Google Meet.

---

## Phần 1: Cài đặt Extension vào Chrome

Do extension này chưa được phát hành công khai trên Chrome Web Store, bạn sẽ cần cài đặt thủ công qua chế độ dành cho nhà phát triển (Developer Mode).

1. **Tải mã nguồn:**
   - Đảm bảo bạn đã có sẵn thư mục `extension-webcam` trên máy tính.

2. **Mở trang quản lý Tiện ích của Chrome:**
   - Mở trình duyệt Google Chrome.
   - Click vào dấu 3 chấm góc trên bên phải > **Extensions (Tiện ích mở rộng)** > **Manage Extensions (Quản lý tiện ích)**.
   - Hoặc gõ trực tiếp đường dẫn sau vào thanh địa chỉ: `chrome://extensions/`

3. **Bật chế độ Nhà phát triển (Developer Mode):**
   - Nhìn lên góc trên bên phải của trang Quản lý tiện ích, bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển).

4. **Tải Extension vào Chrome:**
   - Click vào nút **Load unpacked** (Tải tiện ích đã giải nén) ở góc trên bên trái.
   - Trỏ đường dẫn đến thư mục `extension-webcam` trên máy tính của bạn và chọn **Select Folder**.
   - Bạn sẽ thấy biểu tượng **Meet Raw Data PoC** xuất hiện trong danh sách extension.

---

## Phần 2: Sử dụng Extension

### 1. Định danh Tên lớp học
Để dữ liệu ghi lại được phân loại đúng thư mục, bạn cần khai báo Tên lớp học ngay sau khi cài đặt.

1. Bấm vào biểu tượng **mảnh ghép** ở góc trên bên phải trình duyệt Chrome.
2. Click vào biểu tượng ghim (Pin) bên cạnh **Meet Raw Data PoC** để ghim tiện ích ra ngoài thanh công cụ cho dễ bấm.
3. Click vào biểu tượng của Extension (hình cái mic 🎙️).
4. Tại ô **Tên lớp**, nhập mã hoặc tên lớp của bạn (Ví dụ: `Lop-Toan-12A1`).
5. Bấm nút **Lưu**. Bạn sẽ thấy dòng chữ xanh lá cây thông báo: `"Tên lớp: Lop-Toan-12A1"`.

### 2. Ghi hình buổi học
Extension được thiết kế tự động hoàn toàn, bạn **không cần** phải bấm nút "Quay" hay "Dừng".

1. Truy cập vào **Google Meet** bình thường.
2. Extension sẽ **bỏ qua trang chủ** (khi bạn đang chờ ở phòng ngoài).
3. **Chỉ khi bạn chính thức tham gia (Join) vào phòng họp**, hệ thống mới bắt đầu tự động ghi lại Audio và Video.
4. Bạn có thể mở Popup (bấm vào icon extension) để xem trạng thái thời gian thực. Popup sẽ hiển thị thông báo như `Audio chunk...` hoặc `Video frame...` chứng tỏ dữ liệu đang được thu thập.

---

## Phần 3: Lưu ý Quan trọng (Cơ chế chống mất mạng)

Hệ thống được trang bị tính năng chống mất dữ liệu tự động. Nếu mạng Internet của bạn bị đứt giữa chừng:

- Bạn sẽ thấy một màn hình cảnh báo màu đỏ hiện lên: **"Mất kết nối Internet!"**.
- **TUYỆT ĐỐI KHÔNG ĐÓNG TAB GOOGLE MEET LÚC NÀY.**
- Mọi dữ liệu thu âm và hình ảnh vẫn đang được ghi lại và lưu tạm vào ổ cứng máy tính của bạn (IndexedDB).
- Khi có mạng trở lại, màn hình cảnh báo sẽ tự tắt và toàn bộ dữ liệu tồn đọng sẽ được tự động đồng bộ (Upload) lên máy chủ Vercel. Chờ khoảng 1-2 phút trước khi tắt Meet để đảm bảo dữ liệu lên hết.

---

## Phụ lục: Dành cho Quản trị viên (Admin)

Nếu bạn cần thay đổi máy chủ lưu trữ (chuyển đổi giữa Localhost và Vercel), hãy làm theo cách sau:
1. Mở file `env.js` nằm trong thư mục `extension-webcam`.
2. Sửa biến `API_URL` thành đường dẫn bạn mong muốn:
   ```javascript
   const ENV = {
     // Chọn 1 trong 2 dòng dưới đây
     API_URL: "https://student-capture.vercel.app" // Máy chủ thật
     // API_URL: "http://localhost:8787" // Chạy thử ở máy cá nhân
   };
   ```
3. Sau khi sửa file xong, bạn bắt buộc phải quay lại trang `chrome://extensions/` và bấm vào nút **Vòng tròn (Reload)** ở góc dưới Extension để code mới có hiệu lực.
