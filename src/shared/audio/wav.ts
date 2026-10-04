export interface DecodedWav {
  sampleRate: number;
  /** One Float32Array per channel, samples in [-1, 1]. */
  channels: Float32Array[];
}

/** Parses RIFF/WAVE: PCM 8/16/24/32-bit integer and 32/64-bit float. */
export function parseWav(data: ArrayBuffer | Uint8Array): DecodedWav {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE')
    throw new Error('not a WAV file');

  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      let format = view.getUint16(body, true);
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true); // EXTENSIBLE
      fmt = {
        format,
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data chunk before fmt chunk');
      const len = Math.min(size, bytes.length - body);
      return { sampleRate: fmt.rate, channels: decodeSamples(view, body, len, fmt) };
    }
    offset = body + size + (size & 1); // chunks are word aligned
  }
  throw new Error('WAV file has no data chunk');
}

function decodeSamples(
  view: DataView,
  start: number,
  length: number,
  fmt: { format: number; channels: number; bits: number },
): Float32Array[] {
  const bytesPer = fmt.bits / 8;
  if (fmt.channels < 1) throw new Error('WAV has no channels');
  const frames = Math.floor(length / (bytesPer * fmt.channels));
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  const read = sampleReader(view, fmt.format, fmt.bits);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      channels[c]![i] = read(start + (i * fmt.channels + c) * bytesPer);
    }
  }
  return channels;
}

function sampleReader(view: DataView, format: number, bits: number): (o: number) => number {
  if (format === 1) {
    if (bits === 8) return (o) => (view.getUint8(o) - 128) / 128;
    if (bits === 16) return (o) => view.getInt16(o, true) / 32768;
    if (bits === 24)
      return (o) => {
        const v = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16);
        return v / 8388608;
      };
    if (bits === 32) return (o) => view.getInt32(o, true) / 2147483648;
  }
  if (format === 3) {
    if (bits === 32) return (o) => view.getFloat32(o, true);
    if (bits === 64) return (o) => view.getFloat64(o, true);
  }
  throw new Error(`unsupported WAV encoding (format ${format}, ${bits}-bit)`);
}

/** Encodes interleaved-free channels as 16-bit PCM WAV. Used for fixtures and tests. */
export function encodeWav16(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const numCh = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataLen = frames * numCh * 2;
  const out = new Uint8Array(44 + dataLen);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) =>
    [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numCh * 2, true);
  v.setUint16(32, numCh * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataLen, true);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]![i] ?? 0));
      v.setInt16(44 + (i * numCh + c) * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return out;
}
