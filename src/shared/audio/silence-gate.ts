import { bytesLEToPcm16 } from './pcm16.ts';

/** RMS level of a PCM16 LE frame in dBFS (-Infinity for digital silence). */
export function frameLevelDb(frame: Uint8Array): number {
  const samples = bytesLEToPcm16(frame);
  if (samples.length === 0) return -Infinity;
  let sum = 0;
  for (const s of samples) sum += (s / 32768) ** 2;
  const rms = Math.sqrt(sum / samples.length);
  return rms === 0 ? -Infinity : 20 * Math.log10(rms);
}

export interface SilenceGateOptions {
  /** Frames quieter than this are treated as silence. */
  thresholdDb: number;
  /** Silent frames kept before speech starts, so word onsets aren't clipped. */
  preRollFrames: number;
  /**
   * Silent frames still sent after speech stops. Gnani's server-side VAD needs some
   * trailing silence to decide a segment ended, so this must not be too small.
   */
  hangoverFrames: number;
}

// 32 ms frames: 8 ≈ 256 ms pre-roll, 30 ≈ 960 ms hangover.
export const DEFAULT_SILENCE_GATE: SilenceGateOptions = {
  thresholdDb: -50,
  preRollFrames: 8,
  hangoverFrames: 30,
};

/**
 * Energy-based gate that drops long runs of silence to save STT credits.
 * `process` returns the frames that should be sent now (possibly none, possibly the
 * buffered pre-roll plus the current frame).
 */
export class SilenceGate {
  private readonly opts: SilenceGateOptions;
  private preRoll: Uint8Array[] = [];
  private silentRun = Infinity;
  dropped = 0;

  constructor(opts: Partial<SilenceGateOptions> = {}) {
    this.opts = { ...DEFAULT_SILENCE_GATE, ...opts };
  }

  process(frame: Uint8Array): Uint8Array[] {
    const voiced = frameLevelDb(frame) >= this.opts.thresholdDb;
    if (voiced) {
      const out = [...this.preRoll, frame];
      this.preRoll = [];
      this.silentRun = 0;
      return out;
    }
    this.silentRun++;
    if (this.silentRun <= this.opts.hangoverFrames) return [frame];
    this.preRoll.push(frame);
    if (this.preRoll.length > this.opts.preRollFrames) {
      this.preRoll.shift();
      this.dropped++;
    }
    return [];
  }

  get isOpen(): boolean {
    return this.silentRun <= this.opts.hangoverFrames;
  }
}
