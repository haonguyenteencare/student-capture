class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.buffer = [];
    this.bufferSize = 16000 * 5; // 5 giây dữ liệu ở 16kHz

    // global 'sampleRate' có sẵn trong AudioWorkletGlobalScope
    this.ratio = sampleRate / this.targetSampleRate; // ~3 với 48kHz
    this.lastSampleIndex = 0;

    // FIR low-pass filter coefficients — cutoff 7kHz (dưới Nyquist 8kHz của 16kHz)
    // 15-tap windowed-sinc filter, đủ nhẹ để chạy real-time trong Worklet
    this.firCoeffs = new Float32Array([
      -0.0029, -0.0057,  0.0000,  0.0141,  0.0340,
       0.0568,  0.0762,  0.0843,  0.0762,  0.0568,
       0.0340,  0.0141,  0.0000, -0.0057, -0.0029,
    ]);
    this.firBuffer = new Float32Array(this.firCoeffs.length); // ring buffer
    this.firIndex = 0;
  }

  applyFIR(sample) {
    // Ghi sample vào ring buffer
    this.firBuffer[this.firIndex] = sample;
    this.firIndex = (this.firIndex + 1) % this.firCoeffs.length;

    // Tính tích chập (convolution)
    let output = 0;
    for (let i = 0; i < this.firCoeffs.length; i++) {
      const idx = (this.firIndex + i) % this.firCoeffs.length;
      output += this.firCoeffs[i] * this.firBuffer[idx];
    }
    return output;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // Chỉ lấy kênh trái (Mono)

    for (let i = 0; i < channelData.length; i++) {
      // Lọc anti-aliasing TRƯỚC khi decimation
      const filtered = this.applyFIR(channelData[i]);

      this.lastSampleIndex += 1;
      if (this.lastSampleIndex >= this.ratio) {
        this.lastSampleIndex -= this.ratio;

        // Clamp về [-1, 1] và convert sang Int16
        const clamped = Math.max(-1, Math.min(1, filtered));
        const int16Sample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        this.buffer.push(int16Sample);

        if (this.buffer.length >= this.bufferSize) {
          const out = new Int16Array(this.buffer);
          // Dùng transferable để zero-copy
          this.port.postMessage(out.buffer, [out.buffer]);
          this.buffer = [];
        }
      }
    }

    return true; // Giữ processor sống
  }
}

registerProcessor("audio-processor", AudioProcessor);
