export type Speaker = 'me' | 'them';

export const SPEAKERS: readonly Speaker[] = ['me', 'them'];

export interface TranscriptSegment {
  /** Unique within a session. */
  id: string;
  speaker: Speaker;
  text: string;
  /** Epoch ms when the final transcript was received. */
  at: number;
  /** Duration of the spoken audio, if the STT reported it. */
  audioDurationMs?: number;
  /** Server-side processing latency reported by the STT. */
  serverLatencyMs?: number;
  /** Measured: transcript arrival minus the last voiced frame we sent. */
  endToEndLatencyMs?: number;
  /** Plain meaning in the user's language, when the line mixes in other languages. */
  meaning?: string;
}
