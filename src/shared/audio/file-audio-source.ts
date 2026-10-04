import { FrameEncoder } from './frame-encoder.ts';
import { downmixToMono } from './resampler.ts';
import { parseWav } from './wav.ts';

export const FRAME_MS = 32; // 512 samples at 16 kHz

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface FileAudioSourceOptions {
  onFrame(frame: Uint8Array): void;
  onEnd?(): void;
  /** Playback rate: 1 = real time (what Gnani expects), 4 = four times faster. */
  speed?: number;
  /** Silence appended so the STT's VAD sees the last utterance end. */
  trailingSilenceMs?: number;
  clock?: Clock;
}

/**
 * Replays a WAV file as if it were a live microphone: decode → mono → the same
 * FrameEncoder the AudioWorklet uses → 1024-byte frames emitted on a 32 ms cadence.
 * Timing is drift-corrected against the clock, so a late timer catches up.
 */
export class FileAudioSource {
  readonly frames: Uint8Array[];
  private readonly opts: Required<Omit<FileAudioSourceOptions, 'onEnd'>> &
    Pick<FileAudioSourceOptions, 'onEnd'>;
  private next = 0;
  private startedAt = 0;
  private timer: unknown = null;

  constructor(frames: Uint8Array[], opts: FileAudioSourceOptions) {
    this.opts = { speed: 1, trailingSilenceMs: 1200, clock: realClock, ...opts };
    if (!(this.opts.speed > 0)) throw new Error('speed must be positive');
    const silent = Math.ceil(this.opts.trailingSilenceMs / FRAME_MS);
    const size = frames[0]?.length ?? 1024;
    this.frames = [...frames, ...Array.from({ length: silent }, () => new Uint8Array(size))];
  }

  static fromWav(wav: ArrayBuffer | Uint8Array, opts: FileAudioSourceOptions): FileAudioSource {
    const decoded = parseWav(wav);
    const encoder = new FrameEncoder(decoded.sampleRate);
    const frames = encoder.push(downmixToMono(decoded.channels));
    frames.push(...encoder.flush());
    return new FileAudioSource(frames, opts);
  }

  get durationMs(): number {
    return this.frames.length * FRAME_MS;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** 0..1 */
  get progress(): number {
    return this.frames.length ? this.next / this.frames.length : 1;
  }

  start(): void {
    if (this.running) return;
    this.startedAt = this.opts.clock.now() - (this.next * FRAME_MS) / this.opts.speed;
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) this.opts.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private tick = (): void => {
    const { clock, speed } = this.opts;
    const elapsed = (clock.now() - this.startedAt) * speed;
    const due = Math.min(this.frames.length, Math.floor(elapsed / FRAME_MS) + 1);
    while (this.next < due) this.opts.onFrame(this.frames[this.next++]!);
    if (this.next >= this.frames.length) {
      this.timer = null;
      this.opts.onEnd?.();
      return;
    }
    const nextAt = this.startedAt + (this.next * FRAME_MS) / speed;
    this.timer = clock.setTimeout(this.tick, Math.max(0, nextAt - clock.now()));
  };
}
