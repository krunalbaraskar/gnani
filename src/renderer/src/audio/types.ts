import type { Speaker } from '../../../shared/transcript/types.ts';

/** Where audio frames come from: live devices or WAV replay. */
export interface AudioSourceController {
  start(): Promise<void>;
  stop(): void;
}

export interface AudioSink {
  /** One 1024-byte PCM16 LE frame at 16 kHz. */
  frame(speaker: Speaker, frame: Uint8Array): void;
  /** 0..1 input level, for the meters. */
  level(speaker: Speaker, level: number): void;
}
