import { afterEach, describe, expect, it } from 'vitest';
import { OpenAiCompatibleProvider } from '../src/core/llm/openai-compatible.ts';
import { LlmError } from '../src/core/llm/types.ts';
import { MockLlmServer } from './mock/mock-llm-server.ts';

let server: MockLlmServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
});

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const t of it) out.push(t);
  return out;
}

const messages = [{ role: 'user' as const, content: 'hi' }];

describe('OpenAiCompatibleProvider', () => {
  it('streams tokens and sends an OpenAI-shaped request', async () => {
    server = new MockLlmServer({ tokens: ['Ji', ' bilkul', ', main', ' bhejta hoon.'] });
    const baseUrl = await server.start();
    const p = new OpenAiCompatibleProvider({
      baseUrl: baseUrl + '/',
      model: 'test-model',
      apiKey: 'sk-test',
    });
    expect(await collect(p.streamChat({ messages, maxTokens: 50 }))).toEqual([
      'Ji',
      ' bilkul',
      ', main',
      ' bhejta hoon.',
    ]);
    const req = server.requests[0]!;
    expect(req.path).toBe('/v1/chat/completions');
    expect(req.headers.authorization).toBe('Bearer sk-test');
    expect(req.body).toMatchObject({ model: 'test-model', stream: true, max_tokens: 50, messages });
  });

  it('omits Authorization when there is no key (e.g. Ollama)', async () => {
    server = new MockLlmServer();
    const p = new OpenAiCompatibleProvider({ baseUrl: await server.start(), model: 'llama3.2' });
    await collect(p.streamChat({ messages }));
    expect(server.requests[0]!.headers.authorization).toBeUndefined();
  });

  it('copes with CRLF framing and lines split across TCP writes', async () => {
    server = new MockLlmServer({ tokens: ['नमस्ते', ' जी'], awkwardFraming: true });
    const p = new OpenAiCompatibleProvider({ baseUrl: await server.start(), model: 'm' });
    expect((await collect(p.streamChat({ messages }))).join('')).toBe('नमस्ते जी');
  });

  it('accepts a non-streamed JSON reply', async () => {
    server = new MockLlmServer({ json: true, tokens: ['<think>hmm</think>', 'Sure.'] });
    const p = new OpenAiCompatibleProvider({ baseUrl: await server.start(), model: 'm' });
    expect(await collect(p.streamChat({ messages }))).toEqual(['Sure.']);
  });

  it('strips <think> blocks from reasoning models', async () => {
    server = new MockLlmServer({ tokens: ['<think>', 'let me think', '</think>', 'Ji haan.'] });
    const p = new OpenAiCompatibleProvider({ baseUrl: await server.start(), model: 'm' });
    expect((await collect(p.streamChat({ messages }))).join('')).toBe('Ji haan.');
  });

  it('turns HTTP errors into LlmError with the server message, never the key', async () => {
    server = new MockLlmServer({
      status: 401,
      errorBody: JSON.stringify({ error: { message: 'Invalid API key' } }),
    });
    const p = new OpenAiCompatibleProvider({
      baseUrl: await server.start(),
      model: 'm',
      apiKey: 'sk-secret',
    });
    const err = await collect(p.streamChat({ messages })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).status).toBe(401);
    expect((err as LlmError).message).toContain('Invalid API key');
    expect((err as LlmError).message).not.toContain('sk-secret');
  });

  it('reports an unreachable server clearly', async () => {
    const p = new OpenAiCompatibleProvider({ baseUrl: 'http://127.0.0.1:9/v1', model: 'm' });
    await expect(collect(p.streamChat({ messages }))).rejects.toThrow(/Could not reach the LLM/);
  });

  it('can be aborted mid-stream', async () => {
    server = new MockLlmServer({
      tokens: Array.from({ length: 50 }, (_, i) => `t${i} `),
      tokenDelayMs: 10,
    });
    const p = new OpenAiCompatibleProvider({ baseUrl: await server.start(), model: 'm' });
    const abort = new AbortController();
    const got: string[] = [];
    const run = (async () => {
      for await (const t of p.streamChat({ messages, signal: abort.signal })) {
        got.push(t);
        if (got.length === 3) abort.abort();
      }
    })();
    await expect(run).rejects.toThrow();
    expect(got.length).toBeLessThan(10);
  });

  it('validates its config', () => {
    expect(() => new OpenAiCompatibleProvider({ baseUrl: '', model: 'm' })).toThrow();
    expect(() => new OpenAiCompatibleProvider({ baseUrl: 'http://x', model: '' })).toThrow();
  });
});
