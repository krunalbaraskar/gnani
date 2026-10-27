import { LlmError, type LlmProvider } from '../llm/types.ts';
import type { Logger } from '../util/logger.ts';
import { silentLogger } from '../util/logger.ts';
import { groundText } from '../context/context.ts';
import {
  decideVerdict,
  numbersGrounded,
  splitSource,
  visibleWhileStreaming,
  type Verdict,
} from './answer.ts';
import {
  buildSuggestionMessages,
  cleanSuggestion,
  type PromptInput,
  type SuggestionTrigger,
} from './prompt.ts';

export interface Suggestion {
  id: string;
  trigger: SuggestionTrigger;
  /** For auto suggestions, the question being answered. */
  question?: string;
  /** For typed questions, what the user asked. */
  asked?: string;
  text: string;
  startedAt: number;
  finishedAt?: number;
  /** Time to first token. */
  firstTokenMs?: number;
  error?: string;
  cancelled?: boolean;
  /** How far the answer can be trusted; set when it finishes without error. */
  verdict?: Verdict;
  /** Files (or "transcript"/"note") the answer was grounded in. */
  sources?: string[];
  usedScreen?: boolean;
}

export interface SuggestionEvents {
  onStart(s: Suggestion): void;
  onToken(id: string, token: string, textSoFar: string): void;
  onDone(s: Suggestion): void;
}

export type SuggestRequest = PromptInput;

export interface SuggestionEngineOptions {
  /** Minimum gap between automatic suggestions. Manual requests ignore it. */
  autoCooldownMs?: number;
  /** An automatic answer won't replace one the user asked for until this long after it. */
  manualProtectMs?: number;
  /** A held-back automatic question older than this is dropped. */
  heldMaxAgeMs?: number;
  /** An answer that has not finished after this long is given up on. */
  answerTimeoutMs?: number;
  now?: () => number;
  logger?: Logger;
}

/**
 * Runs one suggestion at a time. A manual request (hotkey, typed, screen) cancels the one
 * in flight. An automatic one that can't run yet is held (newest only) and runs as soon as
 * nothing is streaming, the cooldown is over and the user's own answer has had its time.
 */
export class SuggestionEngine {
  readonly history: Suggestion[] = [];
  private current: { s: Suggestion; abort: AbortController } | null = null;
  private held: { make: () => SuggestRequest; at: number } | null = null;
  private heldTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAutoAt = -Infinity;
  private lastManualDoneAt = -Infinity;
  private counter = 0;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly cooldown: number;
  private readonly manualProtect: number;
  private readonly heldMaxAge: number;
  private readonly answerTimeout: number;
  private readonly getProvider: (vision: boolean) => LlmProvider;
  private readonly events: SuggestionEvents;

  constructor(
    getProvider: (vision: boolean) => LlmProvider,
    events: SuggestionEvents,
    opts: SuggestionEngineOptions = {},
  ) {
    this.getProvider = getProvider;
    this.events = events;
    this.now = opts.now ?? Date.now;
    this.log = opts.logger ?? silentLogger;
    this.cooldown = opts.autoCooldownMs ?? 8000;
    this.manualProtect = opts.manualProtectMs ?? 8000;
    this.heldMaxAge = opts.heldMaxAgeMs ?? 20_000;
    this.answerTimeout = opts.answerTimeoutMs ?? 45_000;
  }

  get busy(): boolean {
    return this.current !== null;
  }

  /** How long until an automatic answer may run (0 = now). */
  private autoWaitMs(): number {
    if (this.current) return Infinity;
    const now = this.now();
    return Math.max(
      0,
      this.lastAutoAt + this.cooldown - now,
      this.lastManualDoneAt + this.manualProtect - now,
    );
  }

  /**
   * An automatic request. `make` is called when it actually runs, so a held question is
   * answered with the transcript as it is then. Resolves null if it was held or dropped.
   */
  requestAuto(make: () => SuggestRequest): Promise<Suggestion | null> {
    if (this.autoWaitMs() > 0) {
      this.held = { make, at: this.now() };
      this.scheduleHeld();
      return Promise.resolve(null);
    }
    this.held = null; // this question is newer than any that was waiting
    this.lastAutoAt = this.now();
    return this.run(make());
  }

  /** Returns the finished suggestion, or null if an auto request was held back. */
  request(req: SuggestRequest): Promise<Suggestion | null> {
    if (req.trigger === 'auto') return this.requestAuto(() => req);
    this.abortCurrent();
    return this.run(req);
  }

  private scheduleHeld(): void {
    if (this.heldTimer) clearTimeout(this.heldTimer);
    this.heldTimer = null;
    const wait = this.autoWaitMs();
    if (!this.held || wait === Infinity) return; // re-armed when the current answer ends
    this.heldTimer = setTimeout(() => {
      this.heldTimer = null;
      const held = this.held;
      if (!held) return;
      if (this.autoWaitMs() > 0) return this.scheduleHeld();
      this.held = null;
      if (this.now() - held.at > this.heldMaxAge) return;
      this.lastAutoAt = this.now();
      void this.run(held.make());
    }, wait);
    this.heldTimer.unref?.();
  }

  private async run(req: SuggestRequest): Promise<Suggestion> {
    const abort = new AbortController();
    const s: Suggestion = {
      id: `sug-${++this.counter}`,
      trigger: req.trigger,
      question: req.question,
      asked: req.asked,
      usedScreen: req.image ? true : undefined,
      text: '',
      startedAt: this.now(),
    };
    this.current = { s, abort };
    this.events.onStart({ ...s });

    // A stream that stalls mid-answer would otherwise block every later automatic answer.
    // A screen answer can be a whole program, so it gets more time and room.
    const limitMs = this.answerTimeout * (req.image ? 2 : 1);
    const stalled = AbortSignal.timeout(limitMs);
    const signal = AbortSignal.any([abort.signal, stalled]);
    let raw = '';
    try {
      const provider = this.getProvider(!!req.image);
      const messages = buildSuggestionMessages(req);
      const maxTokens = req.image ? 4096 : undefined;
      // Wait for the first word as long as for the whole answer: a thinking model can
      // take a while to start, and the overall limit already bounds the wait.
      const stream = provider.streamChat({ messages, signal, maxTokens, timeoutMs: limitMs });
      for await (const token of stream) {
        if (abort.signal.aborted) break;
        if (s.firstTokenMs === undefined) s.firstTokenMs = this.now() - s.startedAt;
        raw += token;
        this.events.onToken(s.id, token, visibleWhileStreaming(raw));
      }
      if (abort.signal.aborted) s.cancelled = true;
    } catch (err) {
      if (abort.signal.aborted) s.cancelled = true;
      else {
        s.error = stalled.aborted
          ? 'The AI model stopped responding. If this repeats, set LLM_REASONING_EFFORT=low in .env.'
          : explainError(err as Error, !!req.image);
        this.log.warn('suggestion failed', { error: s.error });
      }
    }

    const { text, cited } = splitSource(raw);
    const recap = req.trigger === 'catchup';
    // Call replies are trimmed to 3 spoken lines; a screen answer (code) or a recap is kept whole.
    s.text = req.image || recap ? text.trim() : cleanSuggestion(text);
    if (!s.error && !s.cancelled && recap) {
      const said = req.segments.map((seg) => seg.text);
      s.verdict = numbersGrounded(s.text, said) ? 'recap' : 'unverified';
      s.sources = [];
    } else if (!s.error && !s.cancelled) {
      const chunks = req.chunks ?? [];
      const { verdict, sources } = decideVerdict({
        text: s.text,
        cited,
        sentFiles: [...new Set(chunks.map((c) => c.file))],
        contextLoaded: !!req.contextLoaded,
        usedScreen: !!req.image,
        groundTexts: [
          ...chunks.map(groundText),
          req.contextNote,
          // The words only: a "[00:05]" clock would vouch for "5 units".
          ...req.segments.map((seg) => seg.text),
          req.asked ?? '',
        ],
      });
      s.verdict = verdict;
      s.sources = sources;
    }
    s.finishedAt = this.now();
    if (req.trigger !== 'auto') this.lastManualDoneAt = s.finishedAt;
    if (this.current?.s === s) this.current = null;
    this.history.push({ ...s });
    this.events.onDone({ ...s });
    this.scheduleHeld();
    return s;
  }

  private abortCurrent(): void {
    this.current?.abort.abort();
    this.current = null;
  }

  /** Stops the answer in flight and forgets any held question. */
  cancel(): void {
    this.abortCurrent();
    this.held = null;
    if (this.heldTimer) clearTimeout(this.heldTimer);
    this.heldTimer = null;
  }
}

/** Adds what the user can do about the two failures they can fix from Settings. */
function explainError(err: Error, hadImage: boolean): string {
  const status = err instanceof LlmError ? err.status : undefined;
  const rejected = status === 400 || status === 413 || status === 415 || status === 422;
  if (hadImage && rejected) {
    return `This model cannot read images. Set a vision model in Settings. (${err.message})`;
  }
  if (rejected && /context|token|too long|too large|maximum/i.test(err.message)) {
    return `${err.message} Lower the context budget in Settings.`;
  }
  if (/did not respond within/.test(err.message)) {
    return 'The AI model took too long to start answering. Thinking models are slow: set LLM_REASONING_EFFORT=low in .env, or choose a faster model.';
  }
  return err.message;
}
