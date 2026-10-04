/**
 * Streaming windowed-sinc resampler for mono Float32 audio.
 *
 * Works for any rate ratio (48k→16k, 44.1k→16k, 8k→16k). For downsampling the sinc
 * cutoff is lowered to the output Nyquist so content above 8 kHz is filtered out
 * instead of aliasing into the speech band. State is carried between calls, so
 * feeding audio in arbitrary block sizes gives the same output as one big block.
 */
export class StreamingResampler {
  readonly inputRate: number;
  readonly outputRate: number;
  private readonly step: number; // input samples per output sample
  private readonly cutoff: number; // normalised to input Nyquist, 0..1
  private readonly halfTaps: number;
  private history: Float32Array = new Float32Array(0);
  /** Absolute input-sample position of history[0]. */
  private historyStart = 0;
  /** Absolute input-sample position of the next output sample. */
  private nextPos = 0;

  constructor(inputRate: number, outputRate: number, halfTaps = 16) {
    if (!(inputRate > 0) || !(outputRate > 0)) throw new Error('sample rates must be positive');
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    this.step = inputRate / outputRate;
    // 0.95 leaves a little transition band below Nyquist.
    this.cutoff = Math.min(1, outputRate / inputRate) * 0.95;
    this.halfTaps = Math.ceil(halfTaps / Math.min(1, this.cutoff));
  }

  process(input: Float32Array): Float32Array {
    if (this.inputRate === this.outputRate) return input.slice();

    const merged = new Float32Array(this.history.length + input.length);
    merged.set(this.history);
    merged.set(input, this.history.length);
    const end = this.historyStart + merged.length; // exclusive absolute position

    const out: number[] = [];
    // We can produce an output sample once halfTaps of lookahead are available.
    while (this.nextPos + this.halfTaps < end) {
      out.push(this.interpolate(merged, this.nextPos));
      this.nextPos += this.step;
    }

    // Keep enough history to cover the left half of the next kernel.
    const keepFrom = Math.max(this.historyStart, Math.floor(this.nextPos) - this.halfTaps);
    this.history = merged.slice(keepFrom - this.historyStart);
    this.historyStart = keepFrom;
    return Float32Array.from(out);
  }

  /** Emit remaining samples by padding with silence (call at end of stream). */
  flush(): Float32Array {
    return this.process(new Float32Array(this.halfTaps + 1));
  }

  private interpolate(buf: Float32Array, pos: number): number {
    const center = Math.floor(pos);
    let acc = 0;
    let norm = 0;
    for (let k = center - this.halfTaps + 1; k <= center + this.halfTaps; k++) {
      const idx = k - this.historyStart;
      const x = pos - k;
      const w = this.kernel(x);
      norm += w;
      if (idx >= 0 && idx < buf.length) acc += (buf[idx] ?? 0) * w;
    }
    return norm === 0 ? 0 : acc / norm;
  }

  private kernel(x: number): number {
    const c = this.cutoff;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * c * x) / (Math.PI * c * x);
    // Blackman window over [-halfTaps, halfTaps].
    const n = (x + this.halfTaps) / (2 * this.halfTaps);
    if (n < 0 || n > 1) return 0;
    const win = 0.42 - 0.5 * Math.cos(2 * Math.PI * n) + 0.08 * Math.cos(4 * Math.PI * n);
    return c * sinc * win;
  }
}

/** Average any number of channels into one. */
export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0]!.slice();
  const len = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(len);
  for (const ch of channels) for (let i = 0; i < len; i++) out[i]! += ch[i]! / channels.length;
  return out;
}
