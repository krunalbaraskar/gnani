import { describe, expect, it } from 'vitest';
import { composeConversation } from '../src/core/demo/compose.ts';

const ones = (n: number) => new Float32Array(n).fill(1);

describe('composeConversation', () => {
  it('places turns on separate, time-aligned tracks with gaps', () => {
    const t = composeConversation(
      [
        { speaker: 'me', audio: ones(3) },
        { speaker: 'them', audio: ones(2) },
      ],
      { sampleRate: 1000, gapMs: 2, leadMs: 1, echoGain: 0, echoDelayMs: 0 },
    );
    // lead 1, me 3, gap 2, them 2, gap 2 → 10 samples
    expect([...t.me]).toEqual([0, 1, 1, 1, 0, 0, 0, 0, 0, 0]);
    expect([...t.them]).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 0, 0]);
  });

  it('can leak "them" into the mic track to simulate speaker echo', () => {
    const t = composeConversation([{ speaker: 'them', audio: ones(2) }], {
      sampleRate: 1000,
      gapMs: 0,
      leadMs: 0,
      echoGain: 0.5,
      echoDelayMs: 1,
    });
    expect([...t.me]).toEqual([0, 0.5, 0.5]);
    expect([...t.them]).toEqual([1, 1, 0]);
  });
});
