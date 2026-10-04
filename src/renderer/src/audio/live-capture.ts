import type { AudioSink, AudioSourceController } from './types.ts';

/** Placeholder until M5 (Windows mic + loopback capture). */
export class LiveCapture implements AudioSourceController {
  constructor(_sink: AudioSink, _opts: { micDeviceId: string }) {}
  async start(): Promise<void> {
    throw new Error('Live capture is not implemented yet. Use file replay.');
  }
  stop(): void {}
}
