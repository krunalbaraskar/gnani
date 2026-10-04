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
}
