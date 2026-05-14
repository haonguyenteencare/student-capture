# Chiến lược Benchmark & Bảng theo dõi thông số

Tài liệu này cung cấp chiến lược và các biểu mẫu (bảng) để đo lường hiệu năng (Benchmark) cho hệ thống Student Media Capture (Extension + Vercel Blob).

---

## 1. Các thông số cần theo dõi (Metrics)

Để đánh giá hệ thống có thực sự "nhẹ" và "ổn định" hay không, cần theo dõi 2 nhóm thông số chính:

### Nhóm 1: Client-side (Tại máy học sinh cài Extension)
*Sử dụng công cụ: Chrome Task Manager (`Shift + Esc`), Chrome DevTools (Tab Network & Application).*

- **CPU Usage (%):** Mức độ ngốn CPU của Extension. Nếu `> 5-10%` liên tục là có vấn đề.
- **Memory/RAM Usage (MB):** Kiểm tra xem có bị Memory Leak (tràn RAM) không. RAM phải duy trì ổn định, không được tăng tịnh tiến theo thời gian.
- **Upload Bandwidth (KB/s):** Tốc độ mạng tải lên. Đảm bảo dung lượng gửi đi mỗi 5 giây không làm lag mạng máy học sinh.
- **IndexedDB Storage (MB):** Kích thước dữ liệu lưu tạm khi rớt mạng. Cần đo xem 1 phút rớt mạng sẽ tốn bao nhiêu MB ổ cứng local.

### Nhóm 2: Server-side (Tại Vercel & Vercel Blob)
*Sử dụng công cụ: Vercel Dashboard, Vercel Analytics.*

- **Storage Consumption Rate (MB/phút):** Tốc độ ngốn dung lượng của Vercel Blob (rất quan trọng vì Free Tier chỉ có 512MB).
- **API Latency (ms):** Thời gian Vercel phản hồi API `/api/capture`.
- **Error Rate (%):** Tỷ lệ lỗi HTTP 500 hoặc HTTP 429 (Too Many Requests) khi có nhiều máy gửi dữ liệu cùng lúc.

---

## 2. Chiến lược Test (Testing Strategy)

Thực hiện theo 4 giai đoạn test để bóc tách từng giới hạn của hệ thống:

1. **Baseline Test (Test cơ sở - 10 phút):**
   - **Setup:** 1 Student + 1 Mentor. Máy lạnh, mạng ổn định.
   - **Mục tiêu:** Đo thông số gốc (Baseline) của CPU, RAM và tính toán dung lượng Vercel Blob tốn cho 1 phút là bao nhiêu.

2. **Scale / Stress Test (Test chịu tải - 45 phút):**
   - **Setup:** 4 Student + 1 Mentor cùng vào 1 phòng.
   - **Mục tiêu:** Ép Vercel API nhận đồng thời nhiều Request. Kiểm tra xem Vercel có đánh rớt Request nào không (Rate limit). Đo tốc độ cạn kiệt 512MB.

3. **Endurance / Soak Test (Test sức bền - 120 phút):**
   - **Setup:** 1 Student + 1 Mentor. Treo máy trong 2 tiếng.
   - **Mục tiêu:** Tìm kiếm lỗi Memory Leak. Quan sát xem RAM của Chrome có phình to lên mức GBs hay không. Đảm bảo Extension không tự crash.

4. **Degraded Network Test (Test mạng chập chờn):**
   - **Setup:** Dùng tính năng *Throttling* trong Chrome DevTools -> Chuyển sang `Offline` hoặc `Slow 3G`.
   - **Mục tiêu:** Ép dữ liệu phải lưu vào IndexedDB. Sau 5 phút, bật lại `Online`. Đo thời gian Auto-Flush để đẩy hết dữ liệu tồn đọng lên server mà không làm treo trình duyệt.

---

## 3. Bảng Benchmark (Dành cho QA / Tester điền)

*Hãy copy bảng này ra Excel hoặc Google Sheets để ghi nhận kết quả cho từng lần chạy test.*

### Bảng 1: Hiệu năng Client (Đo tại mốc 10 phút / 30 phút / 60 phút)

| Kịch bản Test | Thời điểm đo | CPU Usage (%) | RAM Usage (MB) | Upload TTB (KB/s) | IndexedDB (nếu offline) | Ghi chú / Cảnh báo |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Baseline (1 kèm 1)** | Phút 10 | `...` | `...` | `...` | `0 MB` | Trạng thái bình thường |
| **Endurance** | Phút 30 | `...` | `...` | `...` | `0 MB` | RAM có tăng lên không? |
| **Endurance** | Phút 60 | `...` | `...` | `...` | `0 MB` | Tràn RAM? Máy có lag? |
| **Đứt mạng 5 phút** | Phút thứ 5 | `...` | `...` | `0 KB/s` | `... MB` | Đo dung lượng lưu tạm |

### Bảng 2: Chi phí & Giới hạn Server (Vercel)

| Loại Dữ Liệu | Số lượng file / 1h (ước tính) | Dung lượng thực tế / 1h / 1 User | Dự kiến đầy 512MB (Vercel) sau... |
| :--- | :---: | :---: | :---: |
| **Audio (F32LE)** | ~720 file | `... MB` | `... giờ` |
| **Video (RGBA Raw)** | ~1200 file | `... MB` | `... giờ` |
| **Video (WebM)** | ~720 file | `... MB` | `... giờ` |
| **Tổng cộng** | **~2640 file** | **`... MB`** | **`... giờ`** |

> **Khuyến nghị cho QA:** Bảng 2 cực kỳ quan trọng. Nếu dung lượng tổng vượt quá 512MB trong vòng chưa tới 1 tiếng (với 4 máy), chúng ta sẽ phải khẩn cấp bổ sung tính năng nén Video (chuyển RGBA sang WebP) ở Phase tiếp theo.
