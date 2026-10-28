/**
 * Past meetings as reference material: their minutes and the user's notes become chunks
 * that answers can cite, exactly like files in the context folder.
 */
import { speakerOf } from '../../shared/speakers.ts';
import { formatTranscript } from '../../shared/transcript/format.ts';
import { chunkText, type Chunk } from '../context/context.ts';
import { speakerLabels } from '../minutes/minutes.ts';
import type { StoredMeeting } from './store.ts';

/** Newest meetings first; older ones are left out of answers. */
export const MEMORY_MEETINGS = 40;

/** Starts every name, so the prompt and the answer card can tell meetings from files. */
export const MEETING_SOURCE_PREFIX = 'meeting ';

function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The name a meeting is cited by, e.g. "meeting 2026-10-26 Blue 5 litre stock". Commas,
 * brackets and slashes would break the "[source: a, b]" line, so they become spaces.
 */
export function meetingSourceName(m: StoredMeeting, suffix = ''): string {
  const title = m.title
    .replace(/[,[\]\\/:;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${MEETING_SOURCE_PREFIX}${isoDate(m.record.startedAt)} ${title}${suffix}`;
}

export function isMeetingSource(name: string): boolean {
  return name.startsWith(MEETING_SOURCE_PREFIX);
}

function newest(meetings: readonly StoredMeeting[], limit: number): StoredMeeting[] {
  return [...meetings].sort((a, b) => b.record.startedAt - a.record.startedAt).slice(0, limit);
}

/** Minutes and notes of the newest meetings that have them. */
export function meetingChunks(
  meetings: readonly StoredMeeting[],
  limit = MEMORY_MEETINGS,
): Chunk[] {
  const out: Chunk[] = [];
  for (const m of newest(meetings, limit)) {
    const text = [m.minutes?.markdown ?? '', m.notes.trim() ? `My notes:\n${m.notes}` : '']
      .filter((t) => t.trim())
      .join('\n\n');
    if (text) out.push(...chunkText(meetingSourceName(m), text));
  }
  return out;
}

/** Transcript lines too, for questions about what exactly was said. */
export function meetingTranscriptChunks(
  meetings: readonly StoredMeeting[],
  myName: string,
  limit = MEMORY_MEETINGS,
): Chunk[] {
  const out: Chunk[] = [];
  for (const m of newest(meetings, limit)) {
    const text = formatTranscript(m.record.segments, {
      labels: speakerLabels(myName),
      startAt: m.record.startedAt,
      nameOf: (seg) => speakerOf(seg, myName, m.speakers),
    });
    if (text) out.push(...chunkText(meetingSourceName(m, ' transcript'), text));
  }
  return out;
}
