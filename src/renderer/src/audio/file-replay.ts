import { FileAudioSource } from '../../../shared/audio/file-audio-source.ts';
import { frameLevelDb } from '../../../shared/audio/silence-gate.ts';
import type { Speaker } from '../../../shared/transcript/types.ts';
import { levelFromDb } from '../state.ts';
import type { AudioSink, AudioSourceController } from './types.ts';

export interface ReplayFiles {
  me: ArrayBuffer | null;
  them: ArrayBuffer | null;
}

/**
 * File replay mode: each WAV goes through FileAudioSource (decode → 16 kHz PCM16 →
 * 1024-byte frames at real-time pace) into the same MessagePorts live audio uses.
 * Optionally plays the audio aloud so a demo sounds like a real call.
 */
export class FileReplay implements AudioSourceController {
  private sources: FileAudioSource[] = [];
  private ctx: AudioContext | null = null;
  private readonly files: ReplayFiles;
  private readonly sink: AudioSink;
  private readonly opts: { speed: number; audible: boolean; onEnd: () => void };

  constructor(
    files: ReplayFiles,
    sink: AudioSink,
    opts: { speed: number; audible: boolean; onEnd: () => void },
  ) {
    this.files = files;
    this.sink = sink;
    this.opts = opts;
  }

  async start(): Promise<void> {
    const entries = (['me', 'them'] as const).filter((s) => this.files[s]);
    if (entries.length === 0) throw new Error('Choose at least one WAV file to replay.');
    let remaining = entries.length;
    // Decode everything before starting so both sides stay in sync.
    this.sources = entries.map((speaker) => {
      let n = 0;
      return FileAudioSource.fromWav(this.files[speaker]!, {
        speed: this.opts.speed,
        onFrame: (f) => {
          this.sink.frame(speaker, f);
          if (++n % 3 === 0) this.sink.level(speaker, levelFromDb(frameLevelDb(f)));
        },
        onEnd: () => {
          this.sink.level(speaker, 0);
          if (--remaining === 0) this.opts.onEnd();
        },
      });
    });
    if (this.opts.audible) await this.playAloud(entries);
    this.sources.forEach((s) => s.start());
  }

  stop(): void {
    this.sources.forEach((s) => s.stop());
    this.sources = [];
    void this.ctx?.close();
    this.ctx = null;
  }

  private async playAloud(speakers: readonly Speaker[]): Promise<void> {
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      const buffers = await Promise.all(
        speakers.map((s) => ctx.decodeAudioData(this.files[s]!.slice(0))),
      );
      const at = ctx.currentTime + 0.05;
      for (const b of buffers) {
        const node = ctx.createBufferSource();
        node.buffer = b;
        node.playbackRate.value = this.opts.speed;
        node.connect(ctx.destination);
        node.start(at);
      }
    } catch {
      // Audible playback is cosmetic; transcription works without it.
    }
  }
}
