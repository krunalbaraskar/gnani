import { ByteChunker, FRAME_BYTES } from './chunker.ts';
import { floatToPcm16Bytes } from './pcm16.ts';
import { StreamingResampler } from './resampler.ts';

export const TARGET_SAMPLE_RATE = 16_000;

/**
 * The capture pipeline in one object: mono Float32 at any rate → 16 kHz → PCM16 LE →
 * 1024-byte frames. Used both by the AudioWorklet (live audio) and FileAudioSource
 * (WAV replay), so both paths produce identical frames.
 */
export class FrameEncoder {
  private readonly resampler: StreamingResampler;
  private readonly chunker: ByteChunker;

  constructor(inputRate: number, outputRate = TARGET_SAMPLE_RATE, frameBytes = FRAME_BYTES) {
    this.resampler = new StreamingResampler(inputRate, outputRate);
    this.chunker = new ByteChunker(frameBytes);
  }

  push(samples: Float32Array): Uint8Array[] {
    return this.chunker.push(floatToPcm16Bytes(this.resampler.process(samples)));
  }

  flush(): Uint8Array[] {
    const frames = this.chunker.push(floatToPcm16Bytes(this.resampler.flush()));
    const last = this.chunker.flush();
    if (last) frames.push(last);
    return frames;
  }
}
