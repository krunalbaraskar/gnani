import { describe, expect, it } from 'vitest';
import { TranscriptBuffer } from '../src/shared/transcript/buffer.ts';
import { cleanText, formatClock, formatTranscript } from '../src/shared/transcript/format.ts';
import type { TranscriptSegment } from '../src/shared/transcript/types.ts';

const T0 = 1_700_000_000_000;
const seg = (
  id: string,
  speaker: 'me' | 'them',
  text: string,
  secs: number,
): TranscriptSegment => ({
  id,
  speaker,
  text,
  at: T0 + secs * 1000,
});

describe('TranscriptBuffer', () => {
  it('keeps segments ordered by arrival time even if added out of order', () => {
    const b = new TranscriptBuffer();
    b.add(seg('a', 'them', 'one', 10));
    b.add(seg('b', 'me', 'two', 5));
    b.add(seg('c', 'them', 'three', 20));
    expect(b.all().map((s) => s.id)).toEqual(['b', 'a', 'c']);
  });

  it('ignores empty text and trims whitespace', () => {
    const b = new TranscriptBuffer();
    b.add(seg('a', 'me', '   ', 1));
    b.add(seg('b', 'me', '  hello ', 2));
    expect(b.all().map((s) => s.text)).toEqual(['hello']);
  });

  it('getRecent returns only the last N minutes', () => {
    const b = new TranscriptBuffer();
    b.add(seg('old', 'them', 'old', 0));
    b.add(seg('mid', 'them', 'mid', 150));
    b.add(seg('new', 'me', 'new', 290));
    const now = T0 + 300_000;
    expect(b.getRecent(3, now).map((s) => s.id)).toEqual(['mid', 'new']);
    expect(b.getRecent(10, now)).toHaveLength(3);
  });

  it('removes by id and caps total size', () => {
    const b = new TranscriptBuffer({ maxSegments: 2 });
    b.add(seg('a', 'me', 'a', 1));
    b.add(seg('b', 'me', 'b', 2));
    b.add(seg('c', 'me', 'c', 3));
    expect(b.all().map((s) => s.id)).toEqual(['b', 'c']);
    expect(b.remove('b')?.id).toBe('b');
    expect(b.remove('zzz')).toBeUndefined();
    expect(b.size).toBe(1);
  });

  it('filters by speaker and time', () => {
    const b = new TranscriptBuffer();
    b.add(seg('a', 'me', 'a', 1));
    b.add(seg('b', 'them', 'b', 2));
    b.add(seg('c', 'me', 'c', 3));
    expect(b.since(T0 + 2000, 'me').map((s) => s.id)).toEqual(['c']);
  });
});

describe('formatTranscript', () => {
  it('produces timestamped, labelled lines and merges consecutive same-speaker segments', () => {
    const text = formatTranscript([
      seg('1', 'them', 'Namaste, main Priya bol rahi hoon.', 0),
      seg('2', 'them', 'Policy ke baare mein', 3),
      seg('3', 'them', 'premium kitna hoga?', 5),
      seg('4', 'me', 'Ji, bataata hoon.', 9),
      seg('5', 'them', 'Theek hai.', 70),
    ]);
    expect(text).toBe(
      [
        '[00:00] Them: Namaste, main Priya bol rahi hoon. Policy ke baare mein premium kitna hoga?',
        '[00:09] Me: Ji, bataata hoon.',
        '[01:10] Them: Theek hai.',
      ].join('\n'),
    );
  });

  it('does not merge across a long gap and supports custom labels', () => {
    const text = formatTranscript([seg('1', 'me', 'a', 0), seg('2', 'me', 'b', 30)], {
      labels: { me: 'Agent', them: 'Customer' },
    });
    expect(text).toBe('[00:00] Agent: a\n[00:30] Agent: b');
  });

  it('handles empty input and hour-long clocks', () => {
    expect(formatTranscript([])).toBe('');
    expect(formatClock(3_725_000)).toBe('1:02:05');
  });

  it('cleans control characters and whitespace, keeping Indic text intact', () => {
    expect(cleanText('  क्या\n\tहाल   है \u0007')).toBe('क्या हाल है');
  });
});
