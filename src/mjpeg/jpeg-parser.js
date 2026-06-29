/**
 * JPEGFrameParser — Extracts complete JPEG frames from a binary stream.
 * Reused from rtsp2web-main/src/mjpeg/mjpeg_multi.js
 */
class JPEGFrameParser {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.JPEG_START = Buffer.from([0xFF, 0xD8]);
    this.JPEG_END = Buffer.from([0xFF, 0xD9]);
  }

  parseChunk(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames = [];

    while (true) {
      const startIndex = this.buffer.indexOf(this.JPEG_START);
      if (startIndex === -1) break;

      if (startIndex > 0) {
        this.buffer = this.buffer.slice(startIndex);
      }

      const endIndex = this.buffer.indexOf(this.JPEG_END);
      if (endIndex === -1) break;

      const frame = this.buffer.slice(0, endIndex + 2);
      frames.push(frame);
      this.buffer = this.buffer.slice(endIndex + 2);
    }

    return frames;
  }
}

module.exports = JPEGFrameParser;
