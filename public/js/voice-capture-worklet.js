class DraftVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.used = 0;
    this.port.onmessage = ({data}) => {
      if (data !== 'finish') return;
      this.flush();
      this.finished = true;
      this.port.postMessage('finished');
    };
  }
  flush() {
    if (!this.used) return;
    const chunk = this.buffer.slice(0,this.used);
    this.port.postMessage(chunk,[chunk.buffer]);
    this.used = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (this.finished || !channel) return true;
    for (const value of channel) {
      this.buffer[this.used++] = value;
      if (this.used === this.buffer.length) this.flush();
    }
    return true;
  }
}

registerProcessor('qip-draft-voice', DraftVoiceCapture);
