class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.buffer = [];
    this.bufferSize = 16000 * 5; // 5 giây dữ liệu ở 16kHz
    
    // global 'sampleRate' có sẵn trong AudioWorkletGlobalScope
    this.ratio = sampleRate / this.targetSampleRate;
    this.lastSampleIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // Chỉ lấy kênh trái (Mono)

    // Linear Decimation Downsampling
    for (let i = 0; i < channelData.length; i++) {
      this.lastSampleIndex += 1;
      
      if (this.lastSampleIndex >= this.ratio) {
        this.lastSampleIndex -= this.ratio;
        
        let sample = channelData[i];
        
        // Ép giới hạn [-1.0, 1.0] và chuyển sang Int16
        let int16Sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        
        this.buffer.push(int16Sample);
        
        if (this.buffer.length >= this.bufferSize) {
          const out = new Int16Array(this.buffer);
          // Gửi buffer về main thread, dùng transferable array để tối ưu
          this.port.postMessage(out.buffer, [out.buffer]);
          this.buffer = [];
        }
      }
    }

    return true; // Giữ processor sống
  }
}

registerProcessor("audio-processor", AudioProcessor);
