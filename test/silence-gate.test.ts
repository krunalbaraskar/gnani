import { describe, expect, it } from 'vitest';
import { floatToPcm16Bytes } from '../src/shared/audio/pcm16.ts';
import { frameLevelDb, SilenceGate } from '../src/shared/audio/silence-gate.ts';
import { sine } from './helpers/signals.ts';

const loud = () => floatToPcm16Bytes(sine(300, 16_000, 0.032, 0.3));
const quiet = () => new Uint8Array(1024);

describe('frameLevelDb', () => {
  it('is -Infinity for digital silence and about -13 dBFS for a 0.3 sine', () => {
    expect(frameLevelDb(quiet())).toBe(-Infinity);
    expect(frameLevelDb(loud())).toBeCloseTo(20 * Math.log10(0.3 / Math.SQRT2), 0);
  });
});

describe('SilenceGate', () => {
  it('drops long silence but keeps hangover after speech and pre-roll before it', () => {
    const gate = new SilenceGate({ preRollFrames: 2, hangoverFrames: 3 });
    // Leading silence: gate starts closed, nothing sent.
    for (let i = 0; i < 5; i++) expect(gate.process(quiet())).toHaveLength(0);
    // Speech starts: the 2 pre-roll frames plus the current one.
    expect(gate.process(loud())).toHaveLength(3);
    expect(gate.isOpen).toBe(true);
    // Hangover: 3 silent frames still go through so the server VAD sees the end.
    for (let i = 0; i < 3; i++) expect(gate.process(quiet())).toHaveLength(1);
    expect(gate.process(quiet())).toHaveLength(0);
    expect(gate.isOpen).toBe(false);
    expect(gate.dropped).toBeGreaterThan(0);
  });

  it('passes everything through during continuous speech', () => {
    const gate = new SilenceGate();
    for (let i = 0; i < 50; i++) expect(gate.process(loud())).toHaveLength(1);
  });
});
