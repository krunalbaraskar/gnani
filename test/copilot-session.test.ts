/**
 * The session orchestrator end to end in Node: WAV fixtures → FileAudioSource → Gnani
 * mock server → transcript with echo dedupe → auto-suggest via the mock LLM server.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { OpenAiCompatibleProvider } from '../src/core/llm/openai-compatible.ts';
import { CopilotSession, type SessionEvents } from '../src/core/session/copilot-session.ts';
import { GnaniSttProvider } from '../src/core/stt/gnani-provider.ts';
import type { SttProvider, SttStreamCallbacks } from '../src/core/stt/types.ts';
import { FileAudioSource } from '../src/shared/audio/file-audio-source.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings.ts';
import type { Speaker } from '../src/shared/transcript/types.ts';
import { ME_LINES, SCRIPT, THEM_LINES } from './fixtures/script.ts';
import { MockGnaniServer } from './mock/mock-gnani-server.ts';
import { MockLlmServer } from './mock/mock-llm-server.ts';
import { readFixture } from './helpers/fixtures.ts';
import { waitFor } from './helpers/wait.ts';

function recordEvents() {
  const log: { type: string; payload: unknown }[] = [];
  const events: SessionEvents = {
    onSegment: (s) => log.push({ type: 'segment', payload: s }),
    onSegmentRemoved: (id) => log.push({ type: 'removed', payload: id }),
    onPartial: () => {},
    onProcessing: () => {},
    onSttStatus: (s) => log.push({ type: 'status', payload: s }),
    onSuggestionStart: (s) => log.push({ type: 'suggestion-start', payload: s }),
    onSuggestionToken: () => {},
    onSuggestionDone: (s) => log.push({ type: 'suggestion-done', payload: s }),
  };
  return { log, events };
}

let gnani: MockGnaniServer | null = null;
let llm: MockLlmServer | null = null;
afterEach(async () => {
  await gnani?.stop();
  await llm?.stop();
  gnani = llm = null;
});

describe('CopilotSession with fixtures and mock servers', () => {
  it('transcribes both sides, removes the echo, auto-suggests on the question', async () => {
    gnani = new MockGnaniServer({ script: SCRIPT });
    llm = new MockLlmServer({
      tokens: ['Premium', ' around ₹1,200', ' monthly hai,', ' 80C benefit bhi milega.'],
    });
    const sttUrl = await gnani.start();
    const llmUrl = await llm.start();
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      contextNote: 'Selling term insurance',
      mode: 'active',
      explainThem: false, // meanings share the mock LLM; this test is about the suggestion
    };
    const { log, events } = recordEvents();
    const session = new CopilotSession({
      stt: new GnaniSttProvider({ apiKey: 'test-key', url: sttUrl }),
      llm: () => new OpenAiCompatibleProvider({ baseUrl: llmUrl, model: 'm' }),
      settings: () => settings,
      events,
    });
    session.start();
    const connected = () =>
      log.filter(
        (e) => e.type === 'status' && (e.payload as { state: string }).state === 'connected',
      );
    await waitFor(() => connected().length === 2, 3000, 'both streams connected');

    // Decode both files first so the two "live" streams start together.
    const ended: Promise<void>[] = [];
    const sources = (['them', 'me'] as const).map((speaker) => {
      let done!: () => void;
      ended.push(new Promise<void>((r) => (done = r)));
      return FileAudioSource.fromWav(readFixture(`${speaker}.wav`), {
        onFrame: (f) => session.pushFrame(speaker, f),
        onEnd: () => done(),
        speed: 4,
      });
    });
    sources.forEach((s) => s.start());
    await Promise.all(ended);
    await waitFor(() => log.some((e) => e.type === 'suggestion-done'), 3000, 'auto suggestion');
    const record = await session.stop();

    // Echo of their greeting on the mic was dropped; real "me" lines kept.
    expect(record.segments.filter((s) => s.speaker === 'me').map((s) => s.text)).toEqual([
      ME_LINES.intro.text,
      ME_LINES.answer.text,
    ]);
    expect(record.segments.filter((s) => s.speaker === 'them').map((s) => s.text)).toEqual([
      THEM_LINES.greeting.text,
      THEM_LINES.question.text,
      THEM_LINES.closing.text,
    ]);
    expect(record.echoesRemoved).toBe(1);
    // The overlay counts echoes from these events, so it must agree with the export.
    expect(log.filter((e) => e.type === 'removed')).toHaveLength(1);

    // Exactly one auto suggestion, for the question, containing the context note.
    expect(record.suggestions).toHaveLength(1);
    expect(record.suggestions[0]).toMatchObject({
      trigger: 'auto',
      question: THEM_LINES.question.text,
      text: 'Premium around ₹1,200 monthly hai, 80C benefit bhi milega.',
    });
    const userPrompt = llm.requests[0]!.body.messages[1]!.content;
    expect(userPrompt).toContain('Selling term insurance');
    expect(userPrompt).toContain(`Them: ${THEM_LINES.question.text}`);
    expect(userPrompt).toContain(`Me: ${ME_LINES.intro.text}`);
  });

  it('does not auto-suggest when disabled, but the hotkey path still works', async () => {
    llm = new MockLlmServer({ tokens: ['Ji', ' haan.'] });
    const llmUrl = await llm.start();
    const { fake, emit } = fakeStt();
    const { log, events } = recordEvents();
    const settings: Settings = { ...DEFAULT_SETTINGS, mode: 'assist' };
    const session = new CopilotSession({
      stt: fake,
      llm: () => new OpenAiCompatibleProvider({ baseUrl: llmUrl, model: 'm' }),
      settings: () => settings,
      events,
    });
    session.start();
    emit('them', 'Kya aap kal call kar sakte ho?');
    await new Promise((r) => setTimeout(r, 50));
    expect(log.some((e) => e.type === 'suggestion-start')).toBe(false);
    const s = await session.requestSuggestion();
    expect(s?.text).toBe('Ji haan.');
    expect(s?.trigger).toBe('hotkey');
    await session.stop();
  });

  it('removes an earlier "me" echo retroactively when "them" arrives later', async () => {
    const { fake, emit } = fakeStt();
    const { log, events } = recordEvents();
    const session = new CopilotSession({
      stt: fake,
      llm: () => {
        throw new Error('unused');
      },
      settings: () => ({ ...DEFAULT_SETTINGS, mode: 'assist' }),
      events,
    });
    session.start();
    emit('me', 'claim kitne din mein settle hota hai');
    emit('them', 'Claim kitne din mein settle hota hai?');
    expect(log.filter((e) => e.type === 'removed')).toHaveLength(1);
    expect(session.transcript.all().map((s) => s.speaker)).toEqual(['them']);
    await session.stop();
  });

  it('clears the pending line when a final transcript is empty', async () => {
    const { fake, emit } = fakeStt();
    const partials: [string, string][] = [];
    const { events } = recordEvents();
    const session = new CopilotSession({
      stt: fake,
      llm: () => {
        throw new Error('unused');
      },
      settings: () => DEFAULT_SETTINGS,
      events: { ...events, onPartial: (sp, t) => partials.push([sp, t]) },
    });
    session.start();
    emit('them', '   ');
    expect(partials).toEqual([['them', '']]);
    expect(session.transcript.size).toBe(0);
    await session.stop();
  });

  it('keeps echoes when dedupe is off and gates silence when enabled', async () => {
    const { fake, emit, sent } = fakeStt();
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      echoDedupe: false,
      mode: 'assist',
      silenceGate: true,
    };
    const session = new CopilotSession({
      stt: fake,
      llm: () => {
        throw new Error('unused');
      },
      settings: () => settings,
      events: recordEvents().events,
    });
    session.start();
    emit('them', 'premium kitna hoga monthly');
    emit('me', 'premium kitna hoga monthly');
    expect(session.transcript.size).toBe(2);
    for (let i = 0; i < 100; i++) session.pushFrame('me', new Uint8Array(1024));
    expect(sent.me).toBe(0); // all silence, gate closed from the start
    await session.stop();
    session.pushFrame('me', new Uint8Array(1024)); // ignored after stop
  });
});

/** In-memory STT provider: tests push transcripts directly. */
function fakeStt() {
  const callbacks = new Map<Speaker, SttStreamCallbacks>();
  const sent = { me: 0, them: 0 };
  let n = 0;
  const fake: SttProvider = {
    name: 'fake',
    openStream(speaker, _opts, cb) {
      callbacks.set(speaker, cb);
      return { send: () => void sent[speaker]++, close: async () => {} };
    },
  };
  const emit = (speaker: Speaker, text: string) =>
    callbacks.get(speaker)!.onTranscript({
      speaker,
      text,
      final: true,
      segmentId: `s${++n}`,
      receivedAt: Date.now() + n,
    });
  return { fake, emit, sent };
}

describe('CopilotSession modes and pause', () => {
  const countingLlm = () => {
    const calls: string[] = [];
    return {
      calls,
      provider: {
        name: 'counting',
        async *streamChat(req: { messages: { role: string; content: unknown }[] }) {
          calls.push(String(req.messages[0]!.content));
          yield 'Ji.';
        },
      },
    };
  };

  it('makes no AI request in silent mode until the user asks', async () => {
    const { fake, emit } = fakeStt();
    const llm = countingLlm();
    const session = new CopilotSession({
      stt: fake,
      llm: () => llm.provider,
      settings: () => ({ ...DEFAULT_SETTINGS, mode: 'silent', explainThem: true }),
      events: recordEvents().events,
    });
    session.start();
    emit('them', 'Kya aap kal tak quotation bhej sakte ho?');
    await new Promise((r) => setTimeout(r, 30));
    expect(llm.calls).toHaveLength(0);
    expect((await session.ask('what did they ask?'))?.text).toBe('Ji.');
    expect(llm.calls).toHaveLength(1);
    await session.stop();
  });

  it('assist explains lines but does not answer on its own; active does both', async () => {
    for (const [mode, answers] of [
      ['assist', 0],
      ['active', 1],
    ] as const) {
      const { fake, emit } = fakeStt();
      const llm = countingLlm();
      const { log, events } = recordEvents();
      const session = new CopilotSession({
        stt: fake,
        llm: () => llm.provider,
        settings: () => ({ ...DEFAULT_SETTINGS, mode, explainThem: true }),
        events,
      });
      session.start();
      emit('them', 'Kya aap kal tak quotation bhej sakte ho?');
      await waitFor(() => llm.calls.length >= 1 + answers, 1000, `${mode} requests`);
      await new Promise((r) => setTimeout(r, 30));
      // An answer pre-empts a meaning in flight, which is then asked again.
      expect(
        llm.calls.filter((c) => c.includes('follow a live call')).length,
      ).toBeGreaterThanOrEqual(1);
      expect(log.filter((e) => e.type === 'suggestion-start')).toHaveLength(answers);
      const record = await session.stop();
      expect(record.mode).toBe(mode);
    }
  });

  it('drops audio while paused and records the pause', async () => {
    const { fake, sent } = fakeStt();
    let t = 1_000;
    const session = new CopilotSession({
      stt: fake,
      llm: () => {
        throw new Error('unused');
      },
      settings: () => ({ ...DEFAULT_SETTINGS, mode: 'silent' }),
      events: recordEvents().events,
      now: () => t,
    });
    session.start();
    session.pushFrame('them', new Uint8Array(1024));
    session.setPaused(true);
    expect(session.isPaused).toBe(true);
    t = 5_000;
    session.pushFrame('them', new Uint8Array(1024));
    session.pushFrame('me', new Uint8Array(1024));
    session.setPaused(false);
    session.pushFrame('them', new Uint8Array(1024));
    expect(sent).toEqual({ me: 0, them: 2 });
    session.setPaused(true); // still paused when stopped: the pause is closed at the end
    t = 7_000;
    const record = await session.stop();
    expect(record.pauses).toEqual([
      { from: 1_000, to: 5_000 },
      { from: 5_000, to: 7_000 },
    ]);
    expect(session.isPaused).toBe(false);
  });
});
