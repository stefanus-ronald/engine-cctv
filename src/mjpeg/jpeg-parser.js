/**
 * JPEGFrameParser — Extracts complete JPEG frames from a binary stream.
 * Reused from rtsp2web-main/src/mjpeg/mjpeg_multi.js
 */
// Hard cap on the accumulation buffer. If we never find a frame end (corrupt
// stream, or input that isn't really MJPEG), the buffer must not grow forever.
// A single JPEG frame at 1080p is well under this; anything bigger is junk.
const MAX_BUFFER_BYTES = 8 * 1024 * 1024; // 8 MB

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

    // Safety valve: a partial frame is normal (we wait for more data), but an
    // ever-growing buffer with no end marker is a leak — drop it and resync.
    if (this.buffer.length > MAX_BUFFER_BYTES) {
      this.buffer = Buffer.alloc(0);
    }

    return frames;
  }
}

module.exports = JPEGFrameParser;
