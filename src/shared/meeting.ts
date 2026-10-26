/** Meetings as the library window sees them. Types and pure helpers only. */
import type { SuggestionView } from './ipc.ts';
import type { MeetingMode } from './settings.ts';
import type { TranscriptSegment } from './transcript/types.ts';

/** m + start time in ms; the only ids the main process accepts from a renderer. */
export const MEETING_ID = /^m\d{10,16}$/;

export type MinutesState = 'none' | 'writing' | 'ready' | 'failed';

export interface MinutesView {
  markdown: string;
  generatedAt: number;
  /** The user changed the text after it was written. */
  edited: boolean;
  /** Figures in the minutes that nobody said; shown as a warning until edited. */
  unverifiedFigures: string[];
}

export interface MeetingSummary {
  id: string;
  title: string;
  startedAt: number;
  durationMs: number;
  mode?: MeetingMode;
  lines: number;
  actionItems: number;
  minutes: MinutesState;
  /** Search hit or opening words, for the list. */
  snippet: string;
}

export interface MeetingDetail extends MeetingSummary {
  segments: TranscriptSegment[];
  suggestions: SuggestionView[];
  notes: string;
  agenda: string;
  minutesView?: MinutesView;
  minutesError?: string;
  pauses: { from: number; to: number }[];
}

/** Partial update from the library. Only these fields can be changed by a renderer. */
export interface MeetingPatch {
  title?: string;
  notes?: string;
  minutes?: string;
}

export type MinutesProgressView =
  { stage: 'notes'; part: number; parts: number } | { stage: 'writing'; text: string };

export function defaultMeetingTitle(startedAt: number): string {
  const d = new Date(startedAt);
  return `Meeting · ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
}
