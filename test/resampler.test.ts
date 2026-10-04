import { describe, expect, it } from 'vitest';
import { downmixToMono, StreamingResampler } from '../src/shared/audio/resampler.ts';
import { concat, rms, sine, zeroCrossingFreq } from './helpers/signals.ts';

function resampleAll(r: StreamingResampler, input: Float32Array, block: number): Float32Array {
  const parts: Float32Array[] = [];
  for (let i = 0; i < input.length; i += block) parts.push(r.process(input.subarray(i, i + block)));
  parts.push(r.flush());
  return concat(...parts);
}

describe('StreamingResampler', () => {
  it.each([48_000, 44_100, 32_000, 22_050])(
    'downsamples %i Hz to 16 kHz with the right length',
    (rate) => {
      const out = resampleAll(new StreamingResampler(rate, 16_000), sine(440, rate, 1), 128);
      expect(Math.abs(out.length - 16_000)).toBeLessThanOrEqual(40);
    },
  );

  it('preserves the frequency and level of an in-band tone (1 kHz, 48k → 16k)', () => {
    const out = resampleAll(new StreamingResampler(48_000, 16_000), sine(1000, 48_000, 1), 128);
    const mid = out.subarray(1000, 15_000);
    expect(zeroCrossingFreq(mid, 16_000)).toBeCloseTo(1000, -1);
    expect(rms(mid)).toBeCloseTo(0.5 / Math.SQRT2, 1);
  });

  it('suppresses content above the output Nyquist instead of aliasing it', () => {
    // A 12 kHz tone would alias to 4 kHz in a naive decimator.
    const out = resampleAll(new StreamingResampler(48_000, 16_000), sine(12_000, 48_000, 1), 128);
    expect(rms(out.subarray(1000, 15_000))).toBeLessThan(0.01);
  });

  it('gives identical output regardless of block size', () => {
    const input = sine(700, 44_100, 0.5);
    const a = resampleAll(new StreamingResampler(44_100, 16_000), input, 128);
    const b = resampleAll(new StreamingResampler(44_100, 16_000), input, 1000);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i]!, 5);
  });

  it('upsamples 8 kHz to 16 kHz', () => {
    const out = resampleAll(new StreamingResampler(8000, 16_000), sine(300, 8000, 1), 160);
    expect(Math.abs(out.length - 16_000)).toBeLessThanOrEqual(40);
    expect(zeroCrossingFreq(out.subarray(500, 15_000), 16_000)).toBeCloseTo(300, -1);
  });

  it('is a copy when rates match', () => {
    const input = Float32Array.from([0.1, 0.2]);
    const out = new StreamingResampler(16_000, 16_000).process(input);
    expect([...out]).toEqual([...input]);
    expect(out).not.toBe(input);
  });

  it('rejects invalid rates', () => {
    expect(() => new StreamingResampler(0, 16_000)).toThrow();
  });
});

describe('downmixToMono', () => {
  it('averages channels', () => {
    const out = downmixToMono([Float32Array.from([1, 0]), Float32Array.from([0, 1])]);
    expect([...out]).toEqual([0.5, 0.5]);
  });
  it('handles zero and one channel', () => {
    expect(downmixToMono([]).length).toBe(0);
    expect([...downmixToMono([Float32Array.from([0.25])])]).toEqual([0.25]);
  });
});
