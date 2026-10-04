import { describe, expect, it } from 'vitest';
import {
  bytesLEToPcm16,
  floatToPcm16,
  floatToPcm16Bytes,
  pcm16ToBytesLE,
  pcm16ToFloat,
} from '../src/shared/audio/pcm16.ts';

describe('PCM16 conversion', () => {
  it('maps the float range to the int16 range', () => {
    expect([...floatToPcm16(Float32Array.from([-1, 0, 1, 0.5, -0.5]))]).toEqual([
      -32768, 0, 32767, 16384, -16384,
    ]);
  });

  it('clamps out-of-range samples and treats NaN-free extremes safely', () => {
    expect([...floatToPcm16(Float32Array.from([2, -3]))]).toEqual([32767, -32768]);
  });

  it('writes little-endian bytes', () => {
    const bytes = pcm16ToBytesLE(Int16Array.from([0x0102, -2]));
    expect([...bytes]).toEqual([0x02, 0x01, 0xfe, 0xff]);
  });

  it('round-trips through bytes', () => {
    const samples = Int16Array.from([-32768, -1, 0, 1, 12345, 32767]);
    expect([...bytesLEToPcm16(pcm16ToBytesLE(samples))]).toEqual([...samples]);
  });

  it('reads from a view with a byte offset', () => {
    const backing = new Uint8Array([9, 0x34, 0x12]);
    expect([...bytesLEToPcm16(backing.subarray(1))]).toEqual([0x1234]);
  });

  it('round-trips float → pcm16 → float within quantisation error', () => {
    const input = Float32Array.from([0.1, -0.25, 0.999, -0.75]);
    const back = pcm16ToFloat(floatToPcm16(input));
    input.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 4));
  });

  it('produces two bytes per sample', () => {
    expect(floatToPcm16Bytes(new Float32Array(512)).length).toBe(1024);
  });
});
