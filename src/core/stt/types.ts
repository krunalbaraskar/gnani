import type { Speaker } from '../../shared/transcript/types.ts';

export type SttConnectionState =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';

export interface SttStatus {
  speaker: Speaker;
  state: SttConnectionState;
  /** Reconnect attempt number while reconnecting. */
  attempt?: number;
  /** Delay before the next reconnect attempt. */
  retryInMs?: number;
  /** Human-readable error; never contains secrets. */
  error?: string;
  /** Frames dropped because the socket wasn't open. */
  droppedFrames?: number;
}

export interface SttTranscript {
  speaker: Speaker;
  text: string;
  /** False for interim/partial hypotheses that a later final will replace. */
  final: boolean;
  segmentId: string;
  segmentIndex?: number;
  audioDurationMs?: number;
  serverLatencyMs?: number;
  /** Arrival time minus the last voiced audio frame sent on this stream. */
  endToEndLatencyMs?: number;
  receivedAt: number;
}

export interface SttStreamCallbacks {
  onTranscript(t: SttTranscript): void;
  onStatus(s: SttStatus): void;
  /** Server signalled that it is transcribing a finished utterance. */
  onProcessing?(speaker: Speaker): void;
}

export interface SttStream {
  /** Sends one 1024-byte PCM16 LE frame at 16 kHz. Safe to call while reconnecting. */
  send(frame: Uint8Array): void;
  /** Closes the stream, waiting briefly for an in-flight final transcript. */
  close(): Promise<void>;
}

export interface SttStreamOptions {
  /** Language code understood by the provider, e.g. "hi-IN". */
  language: string;
  /** Provider-specific output formatting, e.g. numbers as digits. */
  formatNumbers?: boolean;
}

export interface SttProvider {
  readonly name: string;
  openStream(speaker: Speaker, options: SttStreamOptions, callbacks: SttStreamCallbacks): SttStream;
}
