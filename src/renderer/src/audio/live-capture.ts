import type { Speaker } from '../../../shared/transcript/types.ts';
import { levelFromDb } from '../state.ts';
import type { WorkletMessage } from './pcm-worklet.ts';
import workletUrl from './pcm-worklet.ts?worker&url';
import type { AudioSink, AudioSourceController } from './types.ts';

export interface LiveCaptureOptions {
  /** '' = system default microphone. */
  micDeviceId: string;
  /** Non-fatal problems, e.g. system audio unavailable (mic-only session). */
  onWarning?: (message: string) => void;
}

/**
 * Live capture on Windows:
 *   me   = microphone via getUserMedia
 *   them = system audio via getDisplayMedia. The main process answers that request with
 *          audio: 'loopback' (everything the PC plays); we drop the video track at once.
 * Each stream feeds its own AudioWorkletNode, so the two speakers never mix and need no
 * diarization.
 */
export class LiveCapture implements AudioSourceController {
  private ctx: AudioContext | null = null;
  private streams: MediaStream[] = [];
  private nodes: AudioNode[] = [];
  private readonly sink: AudioSink;
  private readonly opts: LiveCaptureOptions;

  constructor(sink: AudioSink, opts: LiveCaptureOptions) {
    this.sink = sink;
    this.opts = opts;
  }

  async start(): Promise<void> {
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      await ctx.audioWorklet.addModule(workletUrl);
      if (ctx.state === 'suspended') await ctx.resume();

      const mic = await this.openMic();
      this.wire('me', mic);

      const system = await this.openSystemAudio();
      if (system) this.wire('them', system);
    } catch (err) {
      this.stop();
      throw err;
    }
  }

  stop(): void {
    for (const n of this.nodes) {
      if (n instanceof AudioWorkletNode) n.port.postMessage('stop');
      n.disconnect();
    }
    this.nodes = [];
    for (const s of this.streams) s.getTracks().forEach((t) => t.stop());
    this.streams = [];
    void this.ctx?.close();
    this.ctx = null;
    this.sink.level('me', 0);
    this.sink.level('them', 0);
  }

  private async openMic(): Promise<MediaStream> {
    const id = this.opts.micDeviceId;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: id ? { exact: id } : undefined,
          channelCount: 1,
          // Browser processing helps the mic side; it can't remove Zoom's audio from
          // the speakers (that's what echo dedupe is for).
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      this.streams.push(stream);
      return stream;
    } catch (err) {
      const name = (err as DOMException).name;
      if (name === 'NotAllowedError') {
        throw new Error(
          'Microphone access was blocked. Allow it in Windows Settings → Privacy & security → Microphone.',
          { cause: err },
        );
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        throw new Error('Microphone not found. Pick another one in Settings.', { cause: err });
      }
      throw new Error(`Could not open the microphone: ${(err as Error).message}`, { cause: err });
    }
  }

  private async openSystemAudio(): Promise<MediaStream | null> {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // required by the API; discarded below
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      for (const t of stream.getVideoTracks()) {
        t.stop();
        stream.removeTrack(t);
      }
      this.streams.push(stream);
      if (stream.getAudioTracks().length === 0) {
        this.opts.onWarning?.('System audio is unavailable — only your mic is being transcribed.');
        return null;
      }
      return stream;
    } catch (err) {
      this.opts.onWarning?.(
        `Could not capture system audio (${(err as Error).message}). Only your mic is being transcribed.`,
      );
      return null;
    }
  }

  private wire(speaker: Speaker, stream: MediaStream): void {
    const ctx = this.ctx!;
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'echo-pcm', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.port.onmessage = (e: MessageEvent<WorkletMessage>) => {
      this.sink.frame(speaker, new Uint8Array(e.data.frame));
      if (e.data.levelDb !== undefined) this.sink.level(speaker, levelFromDb(e.data.levelDb));
    };
    // The worklet must be connected to the destination to be pulled; mute its output.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(ctx.destination);
    this.nodes.push(source, node, mute);

    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () =>
        this.opts.onWarning?.(
          `${speaker === 'me' ? 'Microphone' : 'System audio'} stopped (device unplugged or changed).`,
        ),
      );
    }
  }
}
