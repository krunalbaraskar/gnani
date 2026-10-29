/** Defects found in review, each pinned by the smallest test that fails without its fix. */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeText, groundText, loadContext, splitRows } from '../src/core/context/context.ts';
import { OpenAiCompatibleProvider } from '../src/core/llm/openai-compatible.ts';
import { LlmError, type LlmProvider } from '../src/core/llm/types.ts';
import { MockLlmServer } from './mock/mock-llm-server.ts';
import { CopilotSession, type SessionEvents } from '../src/core/session/copilot-session.ts';
import type { SttProvider } from '../src/core/stt/types.ts';
import {
  decideVerdict,
  numbersGrounded,
  numbersIn,
  splitSource,
  visibleWhileStreaming,
} from '../src/core/suggest/answer.ts';
import { SuggestionEngine, type Suggestion } from '../src/core/suggest/engine.ts';
import { buildSuggestionMessages } from '../src/core/suggest/prompt.ts';
import { readContextDir } from '../src/main/context-loader.ts';
import { initialUiState, uiReducer } from '../src/renderer/src/state.ts';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/shared/settings.ts';

const enc = new TextEncoder();

describe('number check on tables', () => {
  it('reads adjacent CSV cells as separate numbers, not one merged number', () => {
    const chunk = { file: 'stock.csv', text: 'item,qty,rate\nPipe,120,450' };
    expect(numbersGrounded('120 in stock at 450', [groundText(chunk)])).toBe(true);
    expect(numbersGrounded('120450 in stock', [groundText(chunk)])).toBe(false);
  });

  it('still reads a quoted cell with a thousands separator as one number', () => {
    const chunk = { file: 'stock.csv', text: 'item,rate\nBlue,"1,180"' };
    expect(numbersGrounded('Rate is ₹1,180', [groundText(chunk)])).toBe(true);
  });

  it('only drops commas that group digits', () => {
    expect(numbersIn('sizes 3,4 and 1,20,000 and 1,180')).toEqual(['3', '4', '120000', '1180']);
  });
});

describe('CSV rows', () => {
  it('a stray quote (2" pipe) does not swallow the rows after it', () => {
    expect(splitRows('item,qty\n2" pipe,40\n3" pipe,12\nElbow,7')).toHaveLength(4);
  });

  it('keeps an escaped quote inside a quoted cell', () => {
    expect(splitRows('item,note\n"Pipe ""A""","two\nlines"\nElbow,ok')).toHaveLength(3);
  });
});

describe('decoding', () => {
  it('refuses UTF-16 without a byte-order mark instead of loading NUL-filled text', () => {
    expect(decodeText(new Uint8Array([0x68, 0x00, 0x69, 0x00]))).toBeNull();
    const bytes = new Uint8Array([0x68, 0x00, 0x69, 0x00]);
    expect(loadContext([{ name: 'a.txt', size: 4, bytes }]).skipped[0]?.reason).toMatch(/UTF-8/);
    expect(decodeText(enc.encode('fine'))).toBe('fine');
  });
});

describe('answer stream', () => {
  it('gives up on a stream that stalls, so later answers are not blocked', async () => {
    const stuck: LlmProvider = {
      name: 'stuck',
      async *streamChat(req) {
        yield 'Blue 5 litre';
        await new Promise((_, reject) =>
          req.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      },
    };
    const done: Suggestion[] = [];
    const engine = new SuggestionEngine(
      () => stuck,
      { onStart: () => {}, onToken: () => {}, onDone: (s) => done.push(s) },
      { answerTimeoutMs: 40 },
    );
    const s = await engine.request({
      segments: [],
      contextNote: '',
      outputLanguage: 'english',
      trigger: 'hotkey',
    });
    expect(s?.error).toMatch(/^The AI model stopped responding./);
    expect(engine.busy).toBe(false);
  });
});

describe('session', () => {
  it('sends nothing to the model for a question that arrives after the call stopped', async () => {
    let calls = 0;
    const llm: LlmProvider = {
      name: 'count',
      // eslint-disable-next-line require-yield
      async *streamChat() {
        calls++;
      },
    };
    const stt: SttProvider = {
      name: 'none',
      openStream: () => ({ send: () => {}, close: async () => {} }),
    } as unknown as SttProvider;
    const events = new Proxy({}, { get: () => () => {} }) as SessionEvents;
    const session = new CopilotSession({
      stt,
      llm: () => llm,
      settings: () => DEFAULT_SETTINGS,
      events,
    });
    session.start();
    await session.stop();
    expect(await session.ask('what is the rate?', 'data:image/jpeg;base64,AA')).toBeNull();
    expect(await session.askScreen('data:image/jpeg;base64,AA')).toBeNull();
    expect(calls).toBe(0);
  });
});

describe('source tag as real models write it', () => {
  it('reads a tag on the same line as the reply, or wrapped in bold', () => {
    expect(splitSource('Ji, 120 pieces hain. [source: inventory.csv]')).toEqual({
      text: 'Ji, 120 pieces hain.',
      cited: ['inventory.csv'],
    });
    expect(splitSource('Ji, 120 pieces hain.\n**[Source: inventory.csv]**')).toEqual({
      text: 'Ji, 120 pieces hain.',
      cited: ['inventory.csv'],
    });
  });

  it('hides an inline tag while it streams, but not other brackets', () => {
    expect(visibleWhileStreaming('120 pieces hain. [sour')).toBe('120 pieces hain.');
    expect(visibleWhileStreaming('120 pieces hain. **[source: inv')).toBe('120 pieces hain.');
    expect(visibleWhileStreaming('Rate [per unit] 450')).toBe('Rate [per unit] 450');
  });

  it('accepts a cited file name without its extension', () => {
    const v = decideVerdict({
      text: '120 pieces hain.',
      cited: ['inventory'],
      sentFiles: ['inventory.csv'],
      contextLoaded: true,
      usedScreen: false,
      groundTexts: ['item | stock\nPipe | 120'],
    });
    expect(v).toEqual({ verdict: 'files', sources: ['inventory.csv'] });
  });
});

describe('number check and the transcript', () => {
  it('does not take a figure from the transcript clock ([00:05])', async () => {
    const llm: LlmProvider = {
      name: 'invents',
      async *streamChat() {
        yield '5 units hain.\n[source: stock.csv]';
      },
    };
    const engine = new SuggestionEngine(() => llm, {
      onStart: () => {},
      onToken: () => {},
      onDone: () => {},
    });
    const s = await engine.request({
      segments: [
        { id: 'me:1', speaker: 'me', text: 'Namaste', at: 0 },
        { id: 'them:1', speaker: 'them', text: 'Pipe ka stock?', at: 5000 },
      ],
      contextNote: '',
      outputLanguage: 'english',
      trigger: 'hotkey',
      contextLoaded: true,
      chunks: [{ file: 'stock.csv', text: 'item,qty\nPipe,120' }],
    });
    expect(s?.verdict).toBe('unverified');
  });
});

describe('context folder', () => {
  it('a file that is not UTF-8 does not use up the room for the files after it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'echo-ctx-'));
    const bad = new Uint8Array(1_000_000).fill(0xff);
    for (const n of ['a1.csv', 'a2.csv', 'a3.csv', 'a4.csv']) writeFileSync(join(dir, n), bad);
    writeFileSync(join(dir, 'stock.csv'), 'item,qty\nPipe,120');
    const { context } = await readContextDir(dir);
    expect(context.files.map((f) => f.name)).toEqual(['stock.csv']);
  });

  it('skips what it cannot read and keeps the rest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'echo-ctx-'));
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'notes.md'), 'Delivery in 3 days');
    const { context, error } = await readContextDir(dir);
    expect(error).toBeUndefined();
    expect(context.files.map((f) => f.name)).toEqual(['notes.md']);
  });
});

describe('overlay', () => {
  it('shows an answer the user asked for, whatever tab is open', () => {
    const start = (trigger: 'typed' | 'auto') =>
      uiReducer(
        { ...initialUiState, panel: 'settings', open: true },
        {
          type: 'event',
          event: {
            type: 'suggestion-start',
            suggestion: { id: 'sug-1', trigger, text: '', startedAt: 0 },
          },
        },
      ).panel;
    expect(start('typed')).toBe('live');
    // An answer nobody asked for must not pull the user out of Settings.
    expect(start('auto')).toBe('settings');
  });
});

describe('LLM base URL', () => {
  const url = (llmBaseUrl: string) => sanitizeSettings({ llmBaseUrl }).llmBaseUrl;

  it('refuses plain http to a public host: the key and transcript would go in clear', () => {
    expect(url('http://llm.example.com/v1')).toBe('');
    expect(url('https://llm.example.com/v1')).toBe('https://llm.example.com/v1');
  });

  it('allows plain http to this machine and the local network', () => {
    for (const u of [
      'http://localhost:11434/v1',
      'http://127.0.0.1:8788/v1',
      'http://192.168.1.20:8000/v1',
      'http://gpu-box:8000/v1',
    ]) {
      expect(url(u)).toBe(u);
    }
  });
});

describe('screen questions', () => {
  const base = {
    segments: [{ id: 'them:1', speaker: 'them' as const, text: 'Haan ji, boliye', at: 0 }],
    contextNote: '',
    outputLanguage: 'same' as const,
    trigger: 'screen' as const,
    image: 'data:image/jpeg;base64,AA',
  };

  it('asks the model to solve what is on screen, in the screen language, not to say a line aloud', () => {
    const [system, user] = buildSuggestionMessages(base);
    const sys = system!.content as string;
    expect(sys).toContain('solve it and give the answer');
    expect(sys).toContain('complete solution in\n  one fenced code block');
    expect(sys).toContain('language the question on the screen is written in');
    expect(sys).not.toContain('read out loud');
    expect(sys).not.toContain('1 to 3 short lines');
    const text = (user!.content as { type: string; text?: string }[])[0]!.text!;
    expect(text).toContain('Solve or answer what is on my screen.');
  });

  it('puts a typed question about the screen in the request', () => {
    const [, user] = buildSuggestionMessages({ ...base, asked: 'what is the time complexity?' });
    const text = (user!.content as { type: string; text?: string }[])[0]!.text!;
    expect(text).toContain('My question about my screen: "what is the time complexity?"');
  });

  it('keeps a long screen answer whole, code included, and gives it room', async () => {
    const answer = [
      'Track booked seats per row.',
      '```cpp',
      'class BusBooking {',
      'public:',
      '    BusBooking(int n) {}',
      '    void toggle(string seat) {}',
      '};',
      '```',
      'Time O(1) per call.',
      '[source: screen]',
    ].join('\n');
    let maxTokens: number | undefined;
    const llm: LlmProvider = {
      name: 'vision',
      async *streamChat(req) {
        maxTokens = req.maxTokens;
        yield answer;
      },
    };
    const engine = new SuggestionEngine(() => llm, {
      onStart: () => {},
      onToken: () => {},
      onDone: () => {},
    });
    const s = await engine.request(base);
    expect(s?.text).toBe(answer.replace('\n[source: screen]', ''));
    expect(s?.verdict).toBe('screen');
    expect(maxTokens).toBe(4096);
  });

  it('call replies are still cut to three spoken lines', async () => {
    const llm: LlmProvider = {
      name: 'chatty',
      async *streamChat() {
        yield 'one\ntwo\nthree\nfour';
      },
    };
    const engine = new SuggestionEngine(() => llm, {
      onStart: () => {},
      onToken: () => {},
      onDone: () => {},
    });
    const { image: _image, ...reply } = base;
    const s = await engine.request({ ...reply, trigger: 'hotkey' });
    expect(s?.text).toBe('one\ntwo\nthree');
  });
});

describe('slow thinking models', () => {
  it('sends reasoning_effort only when it is configured', async () => {
    const llm = new MockLlmServer({ tokens: ['ok'] });
    const url = await llm.start();
    try {
      const drain = async (p: OpenAiCompatibleProvider) => {
        for await (const _t of p.streamChat({ messages: [{ role: 'user', content: 'hi' }] }))
          void _t;
      };
      await drain(new OpenAiCompatibleProvider({ baseUrl: url, model: 'm' }));
      await drain(
        new OpenAiCompatibleProvider({ baseUrl: url, model: 'm', reasoningEffort: 'low' }),
      );
      expect('reasoning_effort' in llm.requests[0]!.body).toBe(false);
      expect((llm.requests[1]!.body as { reasoning_effort?: string }).reasoning_effort).toBe('low');
    } finally {
      await llm.stop();
    }
  });

  it('waits as long as the request asks before giving up on the first byte', async () => {
    const server = createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end('data: {"choices":[{"delta":{"content":"late"}}]}\n\ndata: [DONE]\n\n');
      }, 120);
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const p = new OpenAiCompatibleProvider({ baseUrl: url, model: 'm', timeoutMs: 40 });
    const collect = async (timeoutMs?: number) => {
      let out = '';
      for await (const t of p.streamChat({ messages: [{ role: 'user', content: 'x' }], timeoutMs }))
        out += t;
      return out;
    };
    try {
      await expect(collect()).rejects.toThrow('did not respond within 40 ms');
      expect(await collect(2000)).toBe('late');
    } finally {
      server.closeAllConnections();
      await new Promise((ok) => server.close(ok));
    }
  });

  it('tells the user what to change when the model is slow to start', async () => {
    const slow: LlmProvider = {
      name: 'slow',
      // eslint-disable-next-line require-yield
      async *streamChat() {
        throw new LlmError('LLM did not respond within 45000 ms');
      },
    };
    const engine = new SuggestionEngine(() => slow, {
      onStart: () => {},
      onToken: () => {},
      onDone: () => {},
    });
    const s = await engine.request({
      segments: [],
      contextNote: '',
      outputLanguage: 'english',
      trigger: 'hotkey',
    });
    expect(s?.error).toMatch(/LLM_REASONING_EFFORT=low/);
  });
});
