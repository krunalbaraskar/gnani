import { describe, expect, it } from 'vitest';
import { echoSimilarity, findEchoesOf, isEcho } from '../src/shared/suggest/echo-dedupe.ts';
import type { TranscriptSegment } from '../src/shared/transcript/types.ts';

const T0 = 1_700_000_000_000;

describe('echoSimilarity', () => {
  it('is 1 for identical text, ignoring case and punctuation', () => {
    expect(echoSimilarity('Premium kitna hoga?', 'premium KITNA hoga')).toBeCloseTo(1);
  });
  it('is high for small STT differences', () => {
    expect(
      echoSimilarity('premium kitna hoga monthly', 'premium kitna hogaa monthly'),
    ).toBeGreaterThan(0.75);
  });
  it('is high when the mic only caught part of the sentence', () => {
    expect(
      echoSimilarity('kitna hoga monthly', 'achha toh premium kitna hoga monthly mujhe batao'),
    ).toBeGreaterThan(0.9);
  });
  it('works for Devanagari', () => {
    expect(echoSimilarity('प्रीमियम कितना होगा', 'प्रीमियम कितना होगा?')).toBeCloseTo(1);
  });
  it('is low for unrelated text', () => {
    expect(
      echoSimilarity('main aapko brochure bhejta hoon', 'premium kitna hoga monthly'),
    ).toBeLessThan(0.3);
  });
  it('is 0 when either side is empty', () => {
    expect(echoSimilarity('', 'abc')).toBe(0);
  });
});

describe('isEcho', () => {
  const them = [{ text: 'Premium kitna hoga monthly?', at: T0 }];

  it('flags a matching "me" segment shortly after "them"', () => {
    expect(isEcho({ text: 'premium kitna hoga monthly', at: T0 + 1500 }, them)).toBe(true);
  });
  it('also flags it when "me" arrived first', () => {
    expect(isEcho({ text: 'premium kitna hoga monthly', at: T0 - 1000 }, them)).toBe(true);
  });
  it('ignores matches outside the time window', () => {
    expect(isEcho({ text: 'premium kitna hoga monthly', at: T0 + 20_000 }, them)).toBe(false);
  });
  it('keeps genuine replies', () => {
    expect(isEcho({ text: 'Around twelve hundred rupees a month', at: T0 + 2000 }, them)).toBe(
      false,
    );
  });
  it('does not judge very short utterances', () => {
    expect(isEcho({ text: 'ok', at: T0 }, [{ text: 'ok', at: T0 }])).toBe(false);
  });
});

describe('findEchoesOf', () => {
  it('returns ids of earlier "me" segments that echo a new "them" segment', () => {
    const me: TranscriptSegment[] = [
      { id: 'm1', speaker: 'me', text: 'Haan ji bataiye', at: T0 - 8000 },
      { id: 'm2', speaker: 'me', text: 'claim kitne din mein settle hota hai', at: T0 - 500 },
    ];
    expect(findEchoesOf({ text: 'Claim kitne din mein settle hota hai?', at: T0 }, me)).toEqual([
      'm2',
    ]);
  });
});
