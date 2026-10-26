import { SseParser } from './sse.ts';
import { ThinkFilter } from './think-filter.ts';
import { LlmError, type LlmProvider, type LlmRequest } from './types.ts';

export interface OpenAiCompatibleConfig {
  /** e.g. https://api.openai.com/v1, http://localhost:11434/v1 (Ollama), http://host:8000/v1 (vLLM) */
  baseUrl: string;
  model: string;
  /** Optional: local servers usually don't need one. */
  apiKey?: string;
  /** Abort if no response headers arrive within this time. */
  timeoutMs?: number;
  /**
   * Sent as `reasoning_effort` only when set: thinking models (Gemini 2.5, Groq's gpt-oss)
   * think before the first word, and "low" or "none" makes them answer in seconds. Servers
   * without the field may reject it, so it is never sent by default.
   */
  reasoningEffort?: string;
  fetch?: typeof fetch;
}

/**
 * Streams from any server implementing OpenAI's POST /chat/completions with
 * `stream: true` — OpenAI, Groq, Together, OpenRouter, Ollama, vLLM, LM Studio.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai-compatible';
  private readonly cfg: OpenAiCompatibleConfig;

  constructor(cfg: OpenAiCompatibleConfig) {
    if (!cfg.baseUrl) throw new Error('LLM base URL is not set');
    if (!cfg.model) throw new Error('LLM model is not set');
    this.cfg = cfg;
  }

  get endpoint(): string {
    return `${this.cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  }

  async *streamChat(req: LlmRequest): AsyncIterable<string> {
    const doFetch = this.cfg.fetch ?? fetch;
    const timeout = new AbortController();
    const waitMs = req.timeoutMs ?? this.cfg.timeoutMs ?? 20_000;
    const timer = setTimeout(() => timeout.abort(), waitMs);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout.signal]) : timeout.signal;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (this.cfg.apiKey) headers['Authorization'] = `Bearer ${this.cfg.apiKey}`;

    let res: Response;
    try {
      res = await doFetch(this.endpoint, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model: this.cfg.model,
          messages: req.messages,
          stream: true,
          max_tokens: req.maxTokens ?? 800,
          temperature: req.temperature ?? 0.4,
          ...(this.cfg.reasoningEffort ? { reasoning_effort: this.cfg.reasoningEffort } : {}),
        }),
      });
    } catch (err) {
      clearTimeout(timer);
      if (req.signal?.aborted) throw err;
      if (timeout.signal.aborted) throw new LlmError(`LLM did not respond within ${waitMs} ms`);
      throw new LlmError(`Could not reach the LLM at ${this.endpoint}: ${(err as Error).message}`);
    }
    clearTimeout(timer);

    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300);
      throw new LlmError(
        `LLM request failed (HTTP ${res.status}): ${extractErrorMessage(body)}`,
        res.status,
      );
    }

    const think = new ThinkFilter();
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('application/json')) {
      // Some servers ignore stream:true; treat the whole reply as one chunk.
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = think.push(json.choices?.[0]?.message?.content ?? '') + think.end();
      if (text) yield text;
      return;
    }
    if (!res.body) throw new LlmError('LLM response had no body');

    const parser = new SseParser();
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        const events = done ? parser.end() : parser.push(decoder.decode(value, { stream: true }));
        for (const data of events) {
          if (data.trim() === '[DONE]') return;
          const delta = parseDelta(data);
          if (delta.error) throw new LlmError(`LLM stream error: ${delta.error}`);
          const text = delta.text ? think.push(delta.text) : '';
          if (text) yield text;
        }
        if (done) break;
      }
      const tail = think.end();
      if (tail) yield tail;
    } finally {
      reader.cancel().catch(() => {});
    }
  }
}

function parseDelta(data: string): { text?: string; error?: string } {
  try {
    const j = JSON.parse(data) as {
      choices?: { delta?: { content?: string | null } }[];
      error?: { message?: string } | string;
    };
    if (j.error)
      return { error: typeof j.error === 'string' ? j.error : (j.error.message ?? 'unknown') };
    return { text: j.choices?.[0]?.delta?.content ?? undefined };
  } catch {
    return {};
  }
}

function extractErrorMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string };
    if (typeof j.error === 'string') return j.error;
    if (j.error?.message) return j.error.message;
  } catch {
    // not JSON
  }
  return body || 'no details';
}
