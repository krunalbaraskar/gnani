/** Deterministic test signals. */
export function sine(freq: number, rate: number, seconds: number, amp = 0.5): Float32Array {
  const n = Math.round(rate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

export function rms(x: Float32Array, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]! ** 2;
  return Math.sqrt(s / Math.max(1, to - from));
}

/** Estimates the dominant frequency by counting zero crossings. */
export function zeroCrossingFreq(x: Float32Array, rate: number): number {
  let crossings = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1]! < 0 !== x[i]! < 0) crossings++;
  return (crossings / 2) * (rate / x.length);
}

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
