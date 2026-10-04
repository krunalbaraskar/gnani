import type { Clock } from '../../src/shared/audio/file-audio-source.ts';

/** Manually advanced clock for deterministic timing tests. */
export class FakeClock implements Clock {
  t = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private ids = 0;

  now = (): number => this.t;

  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.ids;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  };

  clearTimeout = (h: unknown): void => {
    this.timers = this.timers.filter((t) => t.id !== h);
  };

  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
  }
}
