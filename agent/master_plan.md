# Student Media Capture - Master Plan (Agent Version)

> [!IMPORTANT]
> **HƯỚNG DẪN CHO AI AGENT:** 
> - Luôn ưu tiên thực hiện các lỗi Crash (Memory/GPU Leak) trước.
> - Tính năng **Audio Mentor** là bắt buộc (deliverable).
> - Giữ nguyên các phần POC hiện tại nếu không gây lỗi (Sequential I/O, JSON Limit, ScriptProcessor).

## 1. Fix Critical Bugs (Ưu tiên số 1 - Ngăn chặn Crash)
*Mục tiêu: Đảm bảo POC chạy ổn định > 30 phút không crash tab Meet.*

- **Sửa lỗi setInterval Zombie:** 
  - Phải `clearInterval` trong hàm `cleanup` của audio.
- **Sửa lỗi GPU Memory Leak:**
  - Luôn sử dụng `try/finally` khi xử lý `VideoFrame`.
  - Phải gọi `frame.close()` trong khối `finally`.
- **Tối ưu Payload postMessage:**
  - Loại bỏ mảng `samples: samplesCopy` khỏi sự kiện `audio-samples` hàng giây.
  - Chỉ gửi mảng samples đầy đủ trong sự kiện `audio-recording` mỗi 5 giây.

## 2. Audio Mentor (Tính năng bắt buộc)
*Mục tiêu: Capture được tiếng của giáo viên/người tham gia khác.*

- **Kỹ thuật:** Sử dụng `AudioContext.createMediaElementSource` để hook vào các thẻ `<audio>` của Google Meet.
- **Lưu ý:** Phải kết nối lại vào `destination` để người dùng vẫn nghe thấy tiếng.
- **Quản lý động:** Sử dụng `MutationObserver` để tự động hook khi Meet thêm các phần tử audio mới cho người tham gia mới.

## 3. Hoàn thiện Capture Pipeline (Dài hạn)
- **Audio Student:** WebM/Opus chunk 5s (giữ nguyên).
- **Video Student:** Thumbnail JPEG 240px mỗi 1s. RGBA raw mỗi 5s cho research.
- **Batch Upload:** Tách riêng Audio và Video batch. Audio gửi mỗi 5s, Video mỗi 15s.
- **Offline Storage:** Queue trong `chrome.storage.local` để chống mất data khi rớt mạng.

## 4. Kiểm thử & Stress Test
- Test tải tăng dần: 1 máy -> 5 máy -> 40 máy (giả lập).
- Metrics: RAM tab Meet sau 30 phút, CPU spike, Disk write speed.

## 5. Rủi ro & Giải pháp
- **Máy yếu:** Giảm sample rate video xuống 1 frame/10s.
- **Mạng chậm:** Ưu tiên audio WebM hơn video JPEG.
- **Hết ổ cứng:** Alert khi < 10GB.

---
*Tài liệu này là kim chỉ nam cho mọi thay đổi code. AI Agent cần đọc kỹ trước khi thực hiện bất kỳ lệnh sửa đổi nào.*
