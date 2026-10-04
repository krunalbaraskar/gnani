import type { Speaker } from '../../shared/transcript/types.ts';

export interface Turn {
  speaker: Speaker;
  /** Mono samples at the composition sample rate. */
  audio: Float32Array;
}

export interface ComposeOptions {
  sampleRate: number;
  /** Pause between turns. */
  gapMs: number;
  /** Silence before the first turn. */
  leadMs: number;
  /**
   * Simulate laptop speakers without headphones: mix "them" into the "me" track at this
   * gain (0 = off), slightly delayed, so the echo dedupe has something to remove.
   */
  echoGain: number;
  echoDelayMs: number;
}

/**
 * Lays a conversation out on two time-aligned tracks, as a real call would arrive:
 * the mic track (me) and the system-audio track (them), silent while the other talks.
 */
export function composeConversation(
  turns: readonly Turn[],
  opts: ComposeOptions,
): Record<Speaker, Float32Array> {
  const ms = (v: number) => Math.round((v / 1000) * opts.sampleRate);
  const total =
    ms(opts.leadMs) +
    turns.reduce((n, t) => n + t.audio.length + ms(opts.gapMs), 0) +
    ms(opts.echoDelayMs);
  const tracks: Record<Speaker, Float32Array> = {
    me: new Float32Array(total),
    them: new Float32Array(total),
  };
  let at = ms(opts.leadMs);
  for (const turn of turns) {
    tracks[turn.speaker].set(turn.audio, at);
    if (turn.speaker === 'them' && opts.echoGain > 0) {
      const delay = ms(opts.echoDelayMs);
      for (let i = 0; i < turn.audio.length; i++)
        tracks.me[at + delay + i]! += turn.audio[i]! * opts.echoGain;
    }
    at += turn.audio.length + ms(opts.gapMs);
  }
  return tracks;
}
