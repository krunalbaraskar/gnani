/** OpenAI-compatible content parts; images travel as data URLs. */
export type ContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface LlmRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  /** How long to wait for the reply to start. Overrides the provider's default. */
  timeoutMs?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly name: string;
  /** Yields text deltas as they arrive. Throws LlmError on failure. */
  streamChat(req: LlmRequest): AsyncIterable<string>;
}

export class LlmError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}
