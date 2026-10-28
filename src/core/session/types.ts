import type { Suggestion } from '../suggest/engine.ts';
import type { TranscriptSegment } from '../../shared/transcript/types.ts';

/** Everything saved when a session ends. Contains no secrets. */
export interface SessionRecord {
  startedAt: number;
  endedAt?: number;
  sttLanguage: string;
  outputLanguage: string;
  contextNote: string;
  audioMode: string;
  segments: TranscriptSegment[];
  suggestions: Suggestion[];
  /** "me" segments dropped as speaker echo. */
  echoesRemoved: number;
  /** Mode at the end of the meeting (see MeetingMode). Absent in records made before modes. */
  mode?: string;
  /** From the calendar invite the meeting was started from. */
  title?: string;
  attendees?: string[];
  /** Stretches when the user paused listening; nothing was sent or transcribed then. */
  pauses?: { from: number; to: number }[];
}
