export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** 0..1 — fraction of the delay that is randomised to avoid reconnect stampedes. */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 500, maxMs: 15_000, jitter: 0.2 };

/** Delay before reconnect attempt `attempt` (1-based): 0.5s, 1s, 2s, 4s … capped. */
export function backoffDelay(
  attempt: number,
  options: Partial<BackoffOptions> = {},
  random: () => number = Math.random,
): number {
  const o = { ...DEFAULT_BACKOFF, ...options };
  const exp = Math.min(o.maxMs, o.baseMs * 2 ** Math.max(0, attempt - 1));
  const spread = exp * o.jitter;
  return Math.round(Math.min(o.maxMs, Math.max(0, exp - spread + random() * 2 * spread)));
}
