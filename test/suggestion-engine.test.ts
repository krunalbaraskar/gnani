import { describe, expect, it } from 'vitest';
import type { LlmProvider, LlmRequest } from '../src/core/llm/types.ts';
import { type Suggestion, SuggestionEngine } from '../src/core/suggest/engine.ts';

/** Provider that yields scripted tokens, waiting `delayMs` between them. */
function fakeProvider(
  tokens: string[],
  delayMs = 0,
  fail?: string,
): LlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    name: 'fake',
    calls,
    async *streamChat(req) {
      calls.push(req);
      for (const t of tokens) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        if (req.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        yield t;
      }
      if (fail) throw new Error(fail);
    },
  };
}

function recorder() {
  const tokens: string[] = [];
  const done: Suggestion[] = [];
  const started: Suggestion[] = [];
  return {
    tokens,
    done,
    started,
    events: {
      onStart: (s: Suggestion) => started.push(s),
      onToken: (_id: string, t: string) => tokens.push(t),
      onDone: (s: Suggestion) => done.push(s),
    },
  };
}

const base = { segments: [], contextNote: '', outputLanguage: 'english' as const };

describe('SuggestionEngine', () => {
  it('streams tokens and records the cleaned result', async () => {
    const r = recorder();
    const engine = new SuggestionEngine(
      () => fakeProvider(['- ', 'Sure', ', sending', ' now.']),
      r.events,
    );
    const s = await engine.request({ ...base, trigger: 'hotkey' });
    expect(r.tokens).toEqual(['- ', 'Sure', ', sending', ' now.']);
    expect(s?.text).toBe('Sure, sending now.');
    expect(s?.firstTokenMs).toBeGreaterThanOrEqual(0);
    expect(engine.history).toHaveLength(1);
    expect(engine.busy).toBe(false);
  });

  it('a hotkey request cancels the one in flight', async () => {
    const r = recorder();
    const engine = new SuggestionEngine(
      () => fakeProvider(['a', 'b', 'c', 'd', 'e'], 15),
      r.events,
    );
    const first = engine.request({ ...base, trigger: 'hotkey' });
    await new Promise((res) => setTimeout(res, 20));
    const second = engine.request({ ...base, trigger: 'hotkey' });
    const [a, b] = await Promise.all([first, second]);
    expect(a?.cancelled).toBe(true);
    expect(b?.cancelled).toBeUndefined();
    expect(b?.text).toBe('abcde');
  });

  it('skips auto suggestions while busy and during the cooldown', async () => {
    let now = 0;
    const r = recorder();
    const engine = new SuggestionEngine(() => fakeProvider(['ok'], 10), r.events, {
      autoCooldownMs: 8000,
      now: () => now,
    });
    const first = engine.request({ ...base, trigger: 'auto', question: 'kya?' });
    expect(await engine.request({ ...base, trigger: 'auto' })).toBeNull(); // busy
    await first;
    now = 5000;
    expect(await engine.request({ ...base, trigger: 'auto' })).toBeNull(); // cooldown
    now = 9000;
    expect(await engine.request({ ...base, trigger: 'auto' })).not.toBeNull();
    // Hotkey ignores the cooldown.
    expect(await engine.request({ ...base, trigger: 'hotkey' })).not.toBeNull();
  });

  it('reports provider errors on the suggestion', async () => {
    const r = recorder();
    const engine = new SuggestionEngine(
      () => fakeProvider(['partial'], 0, 'LLM request failed (HTTP 500)'),
      r.events,
    );
    const s = await engine.request({ ...base, trigger: 'hotkey' });
    expect(s?.error).toMatch(/HTTP 500/);
    expect(r.done[0]?.error).toMatch(/HTTP 500/);
  });

  it('reports configuration errors (provider factory throws)', async () => {
    const r = recorder();
    const engine = new SuggestionEngine(() => {
      throw new Error('LLM base URL is not set');
    }, r.events);
    expect((await engine.request({ ...base, trigger: 'hotkey' }))?.error).toMatch(/base URL/);
  });

  it('passes the built prompt to the provider', async () => {
    const provider = fakeProvider(['x']);
    const engine = new SuggestionEngine(() => provider, recorder().events);
    await engine.request({ ...base, contextNote: 'selling insurance', trigger: 'hotkey' });
    expect(provider.calls[0]!.messages[1]!.content).toContain('selling insurance');
  });
});
