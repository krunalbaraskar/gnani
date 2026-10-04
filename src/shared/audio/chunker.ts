/** Gnani's streaming API wants exactly 1024-byte frames (512 PCM16 samples, 32 ms at 16 kHz). */
export const FRAME_BYTES = 1024;

/** Re-slices an arbitrary byte stream into fixed-size frames. */
export class ByteChunker {
  readonly size: number;
  private pending: Uint8Array;
  private filled = 0;

  constructor(size = FRAME_BYTES) {
    if (!Number.isInteger(size) || size <= 0)
      throw new Error('chunk size must be a positive integer');
    this.size = size;
    this.pending = new Uint8Array(size);
  }

  /** Returns every complete frame the new bytes produce; the remainder is kept. */
  push(bytes: Uint8Array): Uint8Array[] {
    const frames: Uint8Array[] = [];
    let offset = 0;
    while (offset < bytes.length) {
      const take = Math.min(this.size - this.filled, bytes.length - offset);
      this.pending.set(bytes.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === this.size) {
        frames.push(this.pending);
        this.pending = new Uint8Array(this.size);
        this.filled = 0;
      }
    }
    return frames;
  }

  get bufferedBytes(): number {
    return this.filled;
  }

  /** Emits the partial frame zero-padded to full size (silence), or null if empty. */
  flush(): Uint8Array | null {
    if (this.filled === 0) return null;
    const frame = this.pending; // remaining bytes are already zero
    this.pending = new Uint8Array(this.size);
    this.filled = 0;
    return frame;
  }
}
