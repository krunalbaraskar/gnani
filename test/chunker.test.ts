import { describe, expect, it } from 'vitest';
import { ByteChunker, FRAME_BYTES } from '../src/shared/audio/chunker.ts';
import { FrameEncoder } from '../src/shared/audio/frame-encoder.ts';
import { sine } from './helpers/signals.ts';

describe('ByteChunker', () => {
  it('defaults to 1024-byte frames', () => {
    expect(FRAME_BYTES).toBe(1024);
    expect(new ByteChunker().size).toBe(1024);
  });

  it('emits only complete frames and keeps the remainder', () => {
    const c = new ByteChunker(4);
    expect(c.push(new Uint8Array([1, 2, 3]))).toEqual([]);
    expect(c.bufferedBytes).toBe(3);
    const frames = c.push(new Uint8Array([4, 5, 6, 7, 8, 9]));
    expect(frames.map((f) => [...f])).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
    expect(c.bufferedBytes).toBe(1);
  });

  it('does not alias frames it already returned', () => {
    const c = new ByteChunker(2);
    const [a] = c.push(new Uint8Array([1, 2]));
    c.push(new Uint8Array([3, 4]));
    expect([...a!]).toEqual([1, 2]);
  });

  it('flushes a zero-padded final frame', () => {
    const c = new ByteChunker(4);
    c.push(new Uint8Array([7]));
    expect([...c.flush()!]).toEqual([7, 0, 0, 0]);
    expect(c.flush()).toBeNull();
  });

  it('handles a large push spanning many frames', () => {
    const frames = new ByteChunker().push(new Uint8Array(1024 * 5 + 10));
    expect(frames).toHaveLength(5);
    expect(frames.every((f) => f.length === 1024)).toBe(true);
  });

  it('rejects bad sizes', () => {
    expect(() => new ByteChunker(0)).toThrow();
  });
});

describe('FrameEncoder', () => {
  it('turns one second of 48 kHz audio into ~31 frames of 1024 bytes (32 ms each)', () => {
    const enc = new FrameEncoder(48_000);
    const audio = sine(440, 48_000, 1);
    const frames = [] as Uint8Array[];
    for (let i = 0; i < audio.length; i += 128)
      frames.push(...enc.push(audio.subarray(i, i + 128)));
    frames.push(...enc.flush());
    expect(frames.every((f) => f.length === 1024)).toBe(true);
    // 16000 samples * 2 bytes / 1024 = 31.25 → 32 frames after the padded flush.
    expect(frames.length).toBe(32);
  });
});
