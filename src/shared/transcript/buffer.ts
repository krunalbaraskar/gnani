import type { Speaker, TranscriptSegment } from './types.ts';

export interface TranscriptBufferOptions {
  /** Hard cap so a very long session can't grow memory without bound. */
  maxSegments: number;
}

/** Rolling, time-ordered, speaker-labelled transcript for one session. */
export class TranscriptBuffer {
  private segments: TranscriptSegment[] = [];
  private readonly opts: TranscriptBufferOptions;

  constructor(opts: Partial<TranscriptBufferOptions> = {}) {
    this.opts = { maxSegments: 5000, ...opts };
  }

  /** Inserts in `at` order (segments from two streams can arrive slightly out of order). */
  add(segment: TranscriptSegment): void {
    const text = segment.text.trim();
    if (!text) return;
    const seg = { ...segment, text };
    let i = this.segments.length;
    while (i > 0 && this.segments[i - 1]!.at > seg.at) i--;
    this.segments.splice(i, 0, seg);
    if (this.segments.length > this.opts.maxSegments) {
      this.segments.splice(0, this.segments.length - this.opts.maxSegments);
    }
  }

  remove(id: string): TranscriptSegment | undefined {
    const i = this.segments.findIndex((s) => s.id === id);
    if (i < 0) return undefined;
    return this.segments.splice(i, 1)[0];
  }

  /** Segments received in the last `minutes`, oldest first. */
  getRecent(minutes: number, now: number = Date.now()): TranscriptSegment[] {
    const since = now - minutes * 60_000;
    return this.segments.filter((s) => s.at >= since);
  }

  /** Segments of one speaker received at or after `since`. */
  since(since: number, speaker?: Speaker): TranscriptSegment[] {
    return this.segments.filter((s) => s.at >= since && (!speaker || s.speaker === speaker));
  }

  all(): TranscriptSegment[] {
    return [...this.segments];
  }

  get size(): number {
    return this.segments.length;
  }

  clear(): void {
    this.segments = [];
  }
}
