/** Float32 [-1, 1] → signed 16-bit PCM. Out-of-range input is clamped. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    // Asymmetric scaling so -1 → -32768 and +1 → 32767.
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Int16 samples → little-endian bytes, independent of host endianness. */
export function pcm16ToBytesLE(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i] ?? 0, true);
  return bytes;
}

/** Little-endian PCM16 bytes → Int16 samples. A trailing odd byte is ignored. */
export function bytesLEToPcm16(bytes: Uint8Array): Int16Array {
  const n = bytes.length >> 1;
  const out = new Int16Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

export function pcm16ToFloat(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return out;
}

/** Float32 → PCM16 little-endian bytes in one step. */
export function floatToPcm16Bytes(input: Float32Array): Uint8Array {
  return pcm16ToBytesLE(floatToPcm16(input));
}
