import type { Speaker, TranscriptSegment } from './types.ts';

export interface FormatOptions {
  labels: Record<Speaker, string>;
  /** Epoch ms that maps to [00:00]. Defaults to the first segment. */
  startAt?: number;
  /** Consecutive segments of one speaker closer than this are merged into one line. */
  mergeGapMs: number;
}

const DEFAULTS: FormatOptions = {
  labels: { me: 'Me', them: 'Them' },
  mergeGapMs: 8_000,
};

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Collapses whitespace and strips characters that only add noise to a prompt. */
export function cleanText(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex -- stripping control characters is the point
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Renders segments as compact prompt text, e.g.
 *   [00:03] Them: Premium kitna hoga monthly?
 *   [00:09] Me: Around 1,200 rupees per month.
 */
export function formatTranscript(
  segments: readonly TranscriptSegment[],
  options: Partial<FormatOptions> = {},
): string {
  const opts = { ...DEFAULTS, ...options, labels: { ...DEFAULTS.labels, ...options.labels } };
  const lines: { speaker: Speaker; at: number; lastAt: number; text: string }[] = [];
  for (const seg of segments) {
    const text = cleanText(seg.text);
    if (!text) continue;
    const prev = lines[lines.length - 1];
    if (prev && prev.speaker === seg.speaker && seg.at - prev.lastAt <= opts.mergeGapMs) {
      prev.text += ' ' + text;
      prev.lastAt = seg.at;
    } else {
      lines.push({ speaker: seg.speaker, at: seg.at, lastAt: seg.at, text });
    }
  }
  const start = opts.startAt ?? segments[0]?.at ?? 0;
  return lines
    .map((l) => `[${formatClock(l.at - start)}] ${opts.labels[l.speaker]}: ${l.text}`)
    .join('\n');
}
