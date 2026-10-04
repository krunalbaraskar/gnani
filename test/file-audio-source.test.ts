import { describe, expect, it } from 'vitest';
import { FileAudioSource, FRAME_MS } from '../src/shared/audio/file-audio-source.ts';
import { FakeClock } from './helpers/fake-clock.ts';
import { readFixture } from './helpers/fixtures.ts';

describe('FileAudioSource', () => {
  it('decodes a WAV into 1024-byte frames covering its duration plus trailing silence', () => {
    const src = FileAudioSource.fromWav(readFixture('them.wav'), {
      onFrame() {},
      trailingSilenceMs: 0,
    });
    expect(src.frames.every((f) => f.length === 1024)).toBe(true);
    // 6 s of audio → 6000 / 32 = 187.5 → 188 frames.
    expect(src.frames.length).toBe(188);
  });

  it('emits frames at real-time cadence', () => {
    const clock = new FakeClock();
    const got: Uint8Array[] = [];
    const frames = Array.from({ length: 100 }, () => new Uint8Array(1024));
    const src = new FileAudioSource(frames, {
      onFrame: (f) => got.push(f),
      clock,
      trailingSilenceMs: 0,
    });
    src.start();
    expect(got).toHaveLength(1);
    clock.advance(FRAME_MS * 10);
    expect(got).toHaveLength(11);
    clock.advance(1000);
    expect(got).toHaveLength(42); // floor(1320 / 32) + 1
    expect(src.progress).toBeCloseTo(0.42);
  });

  it('honours speed, stop/resume and fires onEnd once', () => {
    const clock = new FakeClock();
    let count = 0;
    let ended = 0;
    const frames = Array.from({ length: 40 }, () => new Uint8Array(1024));
    const src = new FileAudioSource(frames, {
      onFrame: () => count++,
      onEnd: () => ended++,
      clock,
      speed: 4,
      trailingSilenceMs: 0,
    });
    src.start();
    clock.advance(FRAME_MS * 2); // 8 frames' worth at 4×
    expect(count).toBe(9);
    src.stop();
    clock.advance(10_000);
    expect(count).toBe(9);
    src.start();
    clock.advance(10_000);
    expect(count).toBe(40);
    expect(ended).toBe(1);
    expect(src.running).toBe(false);
  });

  it('catches up after a late timer instead of drifting', () => {
    const clock = new FakeClock();
    let count = 0;
    const src = new FileAudioSource(
      Array.from({ length: 50 }, () => new Uint8Array(1024)),
      { onFrame: () => count++, clock, trailingSilenceMs: 0 },
    );
    src.start();
    clock.t += 500; // event loop stalled for 500 ms
    clock.advance(0);
    expect(count).toBe(Math.floor(500 / FRAME_MS) + 1);
  });

  it('appends trailing silence', () => {
    const src = new FileAudioSource([new Uint8Array(1024).fill(1)], {
      onFrame() {},
      trailingSilenceMs: 320,
    });
    expect(src.frames).toHaveLength(11);
    expect(src.frames[10]!.every((b) => b === 0)).toBe(true);
  });
});
