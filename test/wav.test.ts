import { describe, expect, it } from 'vitest';
import { encodeWav16, parseWav } from '../src/shared/audio/wav.ts';

function makeWav(opts: {
  format: number;
  bits: number;
  channels: number;
  rate: number;
  data: number[];
}) {
  const header = new Uint8Array(44);
  const v = new DataView(header.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + opts.data.length, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, opts.format, true);
  v.setUint16(22, opts.channels, true);
  v.setUint32(24, opts.rate, true);
  v.setUint16(34, opts.bits, true);
  w(36, 'data');
  v.setUint32(40, opts.data.length, true);
  const out = new Uint8Array(44 + opts.data.length);
  out.set(header);
  out.set(opts.data, 44);
  return out;
}

describe('parseWav', () => {
  it('round-trips encodeWav16 (stereo)', () => {
    const l = Float32Array.from([0, 0.5, -0.5]);
    const r = Float32Array.from([0.25, -0.25, 0]);
    const wav = parseWav(encodeWav16([l, r], 44_100));
    expect(wav.sampleRate).toBe(44_100);
    expect(wav.channels).toHaveLength(2);
    wav.channels[0]!.forEach((s, i) => expect(s).toBeCloseTo(l[i]!, 3));
    wav.channels[1]!.forEach((s, i) => expect(s).toBeCloseTo(r[i]!, 3));
  });

  it('decodes 24-bit PCM', () => {
    // 0x400000 = +0.5, 0xC00000 = -0.5
    const wav = parseWav(
      makeWav({ format: 1, bits: 24, channels: 1, rate: 8000, data: [0, 0, 0x40, 0, 0, 0xc0] }),
    );
    expect([...wav.channels[0]!]).toEqual([0.5, -0.5]);
  });

  it('decodes 32-bit float', () => {
    const f = new Float32Array([0.125, -1]);
    const wav = parseWav(
      makeWav({
        format: 3,
        bits: 32,
        channels: 1,
        rate: 16_000,
        data: [...new Uint8Array(f.buffer)],
      }),
    );
    expect([...wav.channels[0]!]).toEqual([0.125, -1]);
  });

  it('skips unknown chunks (e.g. LIST) before data', () => {
    const base = encodeWav16([Float32Array.from([0.5])], 16_000);
    const list = new Uint8Array(
      [...'LIST'].map((c) => c.charCodeAt(0)).concat([3, 0, 0, 0, 1, 2, 3, 0]),
    );
    const wav = new Uint8Array(base.length + list.length);
    wav.set(base.subarray(0, 36));
    wav.set(list, 36);
    wav.set(base.subarray(36), 36 + list.length);
    expect(parseWav(wav).channels[0]![0]).toBeCloseTo(0.5, 3);
  });

  it('rejects non-WAV input', () => {
    expect(() => parseWav(new Uint8Array(20))).toThrow(/not a WAV/);
  });
});
