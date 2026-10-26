import { describe, expect, it } from 'vitest';
import type { LlmProvider, LlmRequest } from '../src/core/llm/types.ts';
import { LlmError } from '../src/core/llm/types.ts';
import { type Suggestion, SuggestionEngine } from '../src/core/suggest/engine.ts';
import { waitFor } from './helpers/wait.ts';

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

describe('SuggestionEngine: grounded answers', () => {
  const chunks = [{ file: 'inventory.csv', text: 'item,qty\nBlue 5L,142' }];
  const grounded = { ...base, contextLoaded: true, chunks, trigger: 'hotkey' as const };

  it('strips the source line, hides it while streaming, and sets the verdict', async () => {
    const r = recorder();
    const seen: string[] = [];
    const engine = new SuggestionEngine(
      () => fakeProvider(['142 units', ' hain.', '\n[source:', ' inventory.csv]']),
      { ...r.events, onToken: (_id, _t, all) => seen.push(all) },
    );
    const s = await engine.request(grounded);
    expect(s?.text).toBe('142 units hain.');
    expect(s?.verdict).toBe('files');
    expect(s?.sources).toEqual(['inventory.csv']);
    expect(seen.every((t) => !t.includes('[source'))).toBe(true);
    expect(r.started[0]?.verdict).toBeUndefined(); // nothing is claimed before the check
  });

  it('marks an invented figure as unverified even when a file is cited', async () => {
    const engine = new SuggestionEngine(
      () => fakeProvider(['900 units hain.\n[source: inventory.csv]']),
      recorder().events,
    );
    expect((await engine.request(grounded))?.verdict).toBe('unverified');
  });

  it('sends screen questions to the vision provider and labels them screen', async () => {
    const text = fakeProvider(['text']);
    const vision = fakeProvider(['It says 99.\n[source: screen]']);
    const engine = new SuggestionEngine((v) => (v ? vision : text), recorder().events);
    const s = await engine.request({
      ...grounded,
      trigger: 'screen',
      image: 'data:image/jpeg;base64,AA',
    });
    expect(text.calls).toHaveLength(0);
    expect(vision.calls[0]!.messages[1]!.content).toEqual([
      expect.objectContaining({ type: 'text' }),
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA' } },
    ]);
    expect(s?.verdict).toBe('screen');
    expect(s?.usedScreen).toBe(true);
  });

  it('explains what to change when the model rejects an image or a long prompt', async () => {
    const failing = (message: string) => ({
      name: 'fake',
      // eslint-disable-next-line require-yield
      async *streamChat(): AsyncIterable<string> {
        throw new LlmError(message, 400);
      },
    });
    const img = new SuggestionEngine(
      () => failing('LLM request failed (HTTP 400): no images'),
      recorder().events,
    );
    expect((await img.request({ ...grounded, trigger: 'screen', image: 'data:x' }))?.error).toMatch(
      /cannot read images. Set a vision model in Settings/,
    );
    const long = new SuggestionEngine(
      () => failing('LLM request failed (HTTP 400): maximum context length exceeded'),
      recorder().events,
    );
    expect((await long.request(grounded))?.error).toMatch(/Lower the context budget in Settings/);
  });
});

describe('SuggestionEngine: held-back automatic answers', () => {
  const auto = (question: string) => ({ ...base, trigger: 'auto' as const, question });

  it('answers a second quick question once the first answer and the cooldown are done', async () => {
    const r = recorder();
    const engine = new SuggestionEngine(() => fakeProvider(['ok'], 15), r.events, {
      autoCooldownMs: 40,
    });
    void engine.request(auto('stock?'));
    expect(await engine.request(auto('older, replaced'))).toBeNull();
    expect(await engine.request(auto('bulk rate?'))).toBeNull(); // newest one is kept
    await waitFor(() => r.done.length === 2, 2000);
    expect(r.done.map((s) => s.question)).toEqual(['stock?', 'bulk rate?']);
  });

  it('builds a held request only when it runs', async () => {
    const r = recorder();
    const engine = new SuggestionEngine(() => fakeProvider(['ok'], 15), r.events, {
      autoCooldownMs: 30,
    });
    let built = 0;
    void engine.request(auto('first'));
    void engine.requestAuto(() => {
      built++;
      return auto('second');
    });
    expect(built).toBe(0);
    await waitFor(() => r.done.length === 2, 2000);
    expect(built).toBe(1);
  });

  it('does not replace an answer the user asked for until its protection ends', async () => {
    const r = recorder();
    const engine = new SuggestionEngine(() => fakeProvider(['ok']), r.events, {
      autoCooldownMs: 0,
      manualProtectMs: 60,
    });
    await engine.request({ ...base, trigger: 'typed', asked: 'what did we promise?' });
    expect(await engine.request(auto('stock?'))).toBeNull();
    expect(r.done).toHaveLength(1);
    await waitFor(() => r.done.length === 2, 2000);
    expect(r.done[1]?.question).toBe('stock?');
  });

  it('drops a held question that has become too old', async () => {
    let now = 0;
    const r = recorder();
    const engine = new SuggestionEngine(() => fakeProvider(['ok'], 15), r.events, {
      autoCooldownMs: 30,
      heldMaxAgeMs: 20,
      now: () => now,
    });
    void engine.request(auto('first'));
    void engine.request(auto('late'));
    await waitFor(() => r.done.length === 1, 2000);
    now = 100; // cooldown over, but the held question is 100 ms old
    await new Promise((res) => setTimeout(res, 80));
    expect(r.done).toHaveLength(1);
  });

  it('a manual request does not reset the automatic cooldown, and cancel() forgets the held one', async () => {
    const r = recorder();
    const engine = new SuggestionEngine(() => fakeProvider(['ok'], 10), r.events, {
      autoCooldownMs: 30,
      manualProtectMs: 0,
    });
    void engine.request(auto('first'));
    void engine.request(auto('held'));
    engine.cancel();
    await new Promise((res) => setTimeout(res, 80));
    expect(r.done.map((s) => s.question)).toEqual(['first']);
    expect(r.done[0]?.cancelled).toBe(true);
  });
});
