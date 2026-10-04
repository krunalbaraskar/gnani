/**
 * AudioWorklet that turns live audio into Gnani frames on the audio thread:
 * any channel count → mono → 16 kHz → PCM16 LE → 1024-byte frames (FrameEncoder,
 * the same code FileAudioSource uses). Frames are posted to the page with their
 * buffers transferred, plus an input level for the meter.
 */
import { FrameEncoder } from '../../../shared/audio/frame-encoder.ts';
import { downmixToMono } from '../../../shared/audio/resampler.ts';
import { frameLevelDb } from '../../../shared/audio/silence-gate.ts';

// AudioWorkletGlobalScope isn't in TypeScript's DOM lib.
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

export interface WorkletMessage {
  frame: ArrayBuffer;
  /** dBFS of this frame, sent every few frames. */
  levelDb?: number;
}

class BoloPcmProcessor extends AudioWorkletProcessor {
  private readonly encoder = new FrameEncoder(sampleRate);
  private stopped = false;
  private count = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data === 'stop') this.stopped = true;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    // No channels = the source is muted/ended for this render quantum.
    if (channels && channels.length > 0) {
      const mono = channels.length === 1 ? channels[0]! : downmixToMono(channels);
      for (const frame of this.encoder.push(mono)) {
        const msg: WorkletMessage = { frame: frame.buffer as ArrayBuffer };
        if (++this.count % 3 === 0) msg.levelDb = frameLevelDb(frame);
        this.port.postMessage(msg, [msg.frame]);
      }
    }
    return !this.stopped;
  }
}

registerProcessor('bolo-pcm', BoloPcmProcessor);
