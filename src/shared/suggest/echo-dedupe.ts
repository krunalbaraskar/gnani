import type { TranscriptSegment } from '../transcript/types.ts';
import { normalizeForMatch } from './text-normalize.ts';

/**
 * Without headphones the mic hears the other person through the speakers, so the
 * same words show up once as "them" (loopback) and again as "me" (mic). These helpers
 * find "me" segments that are really echoes of a nearby "them" segment.
 */

export interface EchoOptions {
  /** Max time between the two segments' arrival. Either may arrive first. */
  windowMs: number;
  /** Similarity in [0, 1] at or above which a "me" segment counts as an echo. */
  threshold: number;
  /** Ignore very short "me" segments (e.g. "haan") — too little text to judge. */
  minChars: number;
}

export const DEFAULT_ECHO_OPTIONS: EchoOptions = { windowMs: 5_000, threshold: 0.6, minChars: 4 };

function trigrams(text: string): Map<string, number> {
  const s = ` ${normalizeForMatch(text)} `;
  const chars = [...s]; // code points, so Devanagari/Tamil aren't split mid-character
  const grams = new Map<string, number>();
  for (let i = 0; i + 3 <= chars.length; i++) {
    const g = chars.slice(i, i + 3).join('');
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

/**
 * Similarity of `me` to `them`: the larger of the Dice coefficient and how much of
 * `me` is contained in `them` (the mic often catches only part of what was said).
 */
export function echoSimilarity(me: string, them: string): number {
  const a = trigrams(me);
  const b = trigrams(them);
  let sizeA = 0;
  let sizeB = 0;
  let shared = 0;
  for (const n of a.values()) sizeA += n;
  for (const n of b.values()) sizeB += n;
  if (sizeA === 0 || sizeB === 0) return 0;
  for (const [g, n] of a) shared += Math.min(n, b.get(g) ?? 0);
  const dice = (2 * shared) / (sizeA + sizeB);
  const containment = shared / sizeA;
  return Math.max(dice, containment);
}

/** True when `me` closely matches some "them" segment within the time window. */
export function isEcho(
  me: Pick<TranscriptSegment, 'text' | 'at'>,
  themSegments: readonly Pick<TranscriptSegment, 'text' | 'at'>[],
  options: Partial<EchoOptions> = {},
): boolean {
  const opts = { ...DEFAULT_ECHO_OPTIONS, ...options };
  if (normalizeForMatch(me.text).length < opts.minChars) return false;
  return themSegments.some(
    (t) =>
      Math.abs(t.at - me.at) <= opts.windowMs && echoSimilarity(me.text, t.text) >= opts.threshold,
  );
}

/**
 * Given a newly arrived "them" segment, returns the ids of recent "me" segments that
 * were echoes of it (they arrived first, so they couldn't be caught on arrival).
 */
export function findEchoesOf(
  them: Pick<TranscriptSegment, 'text' | 'at'>,
  meSegments: readonly TranscriptSegment[],
  options: Partial<EchoOptions> = {},
): string[] {
  return meSegments
    .filter((m) => m.speaker === 'me' && isEcho(m, [them], options))
    .map((m) => m.id);
}
