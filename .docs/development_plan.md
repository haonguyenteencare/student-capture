# Student Media Capture - Development Plan

## Phase 1: Capture — lấy stream từ Meet (Tuần 1–2)
**Cách intercept:**
- Inject content script vào `meet.google.com`
- Hook `getUserMedia` trước khi Meet gọi
- Giữ reference tới `MediaStream` gốc
- Meet vẫn hoạt động bình thường

**Output của phase này:**
- Video track — 1 stream từ webcam
- Audio track — 1 stream từ mic
- Cả 2 chạy song song, không ảnh hưởng Meet

*Lưu ý: Meet dùng adapter.js shim — cần hook ở tầng window trước khi Meet load, dùng `world: "MAIN"` trong manifest v3.*

### Chi tiết kỹ thuật Hook getUserMedia
Đây là bước quan trọng nhất. Meet load rất sớm, nên extension phải inject vào `world: "MAIN"` để override được `navigator.mediaDevices.getUserMedia` trước khi Meet gọi nó:

**Cấu hình manifest.json:**
```json
"content_scripts": [{
  "matches": ["https://meet.google.com/*"],
  "js": ["hook.js"],
  "run_at": "document_start",
  "world": "MAIN"
}]
```

**Logic hook.js (chạy trước Meet):**
```javascript
const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

navigator.mediaDevices.getUserMedia = async (constraints) => {
  const stream = await origGetUserMedia(constraints);
  // giữ reference, pipe vào pipeline của mình
  window.__studentStream = stream;
  return stream; // trả lại cho Meet, Meet không biết gì
};
```


## Phase 2: Pipeline xử lý local (Tuần 3–5)
**Audio pipeline:**
- AudioWorklet — raw PCM float32
- VAD — detect khi student đang nói
- MediaRecorder opus — chunk 2s
- Gắn timestamp + sessionId mỗi chunk

**Video pipeline:**
- ImageCapture — snapshot mỗi N giây
- Resize xuống 320×240 trước khi encode
- Convert sang JPEG base64 (~15–30KB/frame)
- Gắn timestamp khớp với audio

*Tần suất capture video gợi ý: 1 frame/3–5 giây — đủ cho attention/emotion analysis, không quá nặng bandwidth.*

## Phase 3: Batch gửi về server (Tuần 6–7)
**Cấu trúc batch JSON:**
- `sessionId` — định danh phiên học
- `studentId` — từ Meet user info
- `chunks[]` — audio base64 + index
- `frames[]` — video JPEG base64 + timestamp

**Chiến lược gửi:**
- Audio: gửi mỗi 2s (theo chunk recorder)
- Video: gửi kèm cùng batch audio
- Retry tự động nếu fail
- Queue trong `chrome.storage` nếu offline

## Phase 4: UX & kiểm soát (Tuần 8)
**Extension popup:**
- Indicator đang record / đã dừng
- Tự động bật khi vào `meet.google.com`
- Student biết đang bị capture (compliance)

**Edge cases:**
- Student tắt camera → fallback audio only
- Mất mạng → buffer local, gửi lại sau
- Meet reconnect → tự hook lại stream mới

## Ghi chú về Phân tích dữ liệu & AI
Với định dạng dữ liệu theo kế hoạch này (audio chunk + video frame có chung timestamp), server có thể chạy các mô hình AI:
- **Whisper/STT:** Cho speech-to-text từ audio chunks.
- **FER/MediaPipe:** Cho facial emotion và attention analysis từ video frames.
- **Correlation:** Đồng bộ hóa kết quả theo timeline để có cái nhìn tổng thể về hành vi học sinh.

**QUAN TRỌNG:** Phải đảm bảo timestamp được gắn chính xác ngay từ đầu tại client. Việc lệch timestamp sẽ khiến việc phân tích correlation sau này cực kỳ khó khăn và tốn kém tài nguyên để sửa chữa.
