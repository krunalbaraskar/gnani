/**
 * Who said what. Speech-to-text only knows the two channels: "me" (the microphone) and
 * "them" (everyone else). Names on top of that come from the user, or from a guess the
 * user can correct (see core/meetings/speakers.ts).
 */
import type { TranscriptSegment } from './transcript/types.ts';

export interface SpeakerNames {
  /** Everyone on the "them" side, e.g. "Mehta Hardware" for a 1:1 call. */
  them?: string;
  /** One "them" line's speaker, by segment id. */
  byLine?: Record<string, string>;
  /** Segment ids whose name was guessed by the AI and not yet confirmed by the user. */
  guessed?: string[];
}

export const MAX_SPEAKER_NAME = 60;

export function cleanSpeakerName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_SPEAKER_NAME);
}

/** The label for one line: my name, the line's own name, the "them" name, or Them. */
export function speakerOf(
  seg: Pick<TranscriptSegment, 'id' | 'speaker'>,
  myName: string,
  names?: SpeakerNames,
): string {
  if (seg.speaker === 'me') return myName.trim() || 'Me';
  return names?.byLine?.[seg.id] || names?.them?.trim() || 'Them';
}

/** Everyone in the meeting: me first, then attendees and the names on lines, no repeats. */
export function participants(
  myName: string,
  names: SpeakerNames | undefined,
  attendees: readonly string[] = [],
  segments: readonly Pick<TranscriptSegment, 'id' | 'speaker'>[] = [],
): string[] {
  const me = myName.trim() || 'Me';
  const out = [me];
  const seen = new Set([me.toLowerCase()]);
  const add = (n: string | undefined) => {
    const name = n?.trim();
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
    }
  };
  for (const a of attendees) add(a);
  for (const seg of segments) {
    const name = seg.speaker === 'them' ? speakerOf(seg, myName, names) : '';
    if (name !== 'Them') add(name);
  }
  // Nobody is known by name: say so rather than list no one.
  if (out.length === 1) out.push('Them');
  return out;
}
