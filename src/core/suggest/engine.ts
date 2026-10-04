import type { LlmProvider } from '../llm/types.ts';
import type { Logger } from '../util/logger.ts';
import { silentLogger } from '../util/logger.ts';
import type { TranscriptSegment } from '../../shared/transcript/types.ts';
import type { OutputLanguage } from '../../shared/settings.ts';
import { buildSuggestionMessages, cleanSuggestion, type SuggestionTrigger } from './prompt.ts';

export interface Suggestion {
  id: string;
  trigger: SuggestionTrigger;
  /** For auto suggestions, the question being answered. */
  question?: string;
  text: string;
  startedAt: number;
  finishedAt?: number;
  /** Time to first token. */
  firstTokenMs?: number;
  error?: string;
  cancelled?: boolean;
}

export interface SuggestionEvents {
  onStart(s: Suggestion): void;
  onToken(id: string, token: string, textSoFar: string): void;
  onDone(s: Suggestion): void;
}

export interface SuggestRequest {
  segments: readonly TranscriptSegment[];
  contextNote: string;
  outputLanguage: OutputLanguage;
  trigger: SuggestionTrigger;
  question?: string;
}

export interface SuggestionEngineOptions {
  /** Minimum gap between automatic suggestions. Hotkey requests ignore it. */
  autoCooldownMs?: number;
  now?: () => number;
  logger?: Logger;
}

/**
 * Runs one suggestion at a time. A new hotkey request cancels the one in flight; an
 * automatic one is skipped if a suggestion is already streaming or one was made recently.
 */
export class SuggestionEngine {
  readonly history: Suggestion[] = [];
  private current: { s: Suggestion; abort: AbortController } | null = null;
  private lastAutoAt = -Infinity;
  private counter = 0;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly cooldown: number;
  private readonly getProvider: () => LlmProvider;
  private readonly events: SuggestionEvents;

  constructor(
    getProvider: () => LlmProvider,
    events: SuggestionEvents,
    opts: SuggestionEngineOptions = {},
  ) {
    this.getProvider = getProvider;
    this.events = events;
    this.now = opts.now ?? Date.now;
    this.log = opts.logger ?? silentLogger;
    this.cooldown = opts.autoCooldownMs ?? 8000;
  }

  get busy(): boolean {
    return this.current !== null;
  }

  /** Returns the finished suggestion, or null if an auto request was skipped. */
  async request(req: SuggestRequest): Promise<Suggestion | null> {
    if (req.trigger === 'auto') {
      if (this.current || this.now() - this.lastAutoAt < this.cooldown) return null;
      this.lastAutoAt = this.now();
    } else {
      this.cancel();
    }

    const abort = new AbortController();
    const s: Suggestion = {
      id: `sug-${++this.counter}`,
      trigger: req.trigger,
      question: req.question,
      text: '',
      startedAt: this.now(),
    };
    this.current = { s, abort };
    this.events.onStart({ ...s });

    let raw = '';
    try {
      const provider = this.getProvider();
      const messages = buildSuggestionMessages(req);
      for await (const token of provider.streamChat({ messages, signal: abort.signal })) {
        if (abort.signal.aborted) break;
        if (s.firstTokenMs === undefined) s.firstTokenMs = this.now() - s.startedAt;
        raw += token;
        this.events.onToken(s.id, token, raw);
      }
      s.text = cleanSuggestion(raw);
      if (abort.signal.aborted) s.cancelled = true;
    } catch (err) {
      if (abort.signal.aborted) {
        s.cancelled = true;
        s.text = cleanSuggestion(raw);
      } else {
        s.error = (err as Error).message;
        this.log.warn('suggestion failed', { error: s.error });
      }
    }
    s.finishedAt = this.now();
    if (this.current?.s === s) this.current = null;
    this.history.push({ ...s });
    this.events.onDone({ ...s });
    return s;
  }

  cancel(): void {
    this.current?.abort.abort();
    this.current = null;
  }
}
