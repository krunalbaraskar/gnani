import { afterEach, describe, expect, it } from 'vitest';
import { GnaniSttProvider } from '../src/core/stt/gnani-provider.ts';
import type { SttStatus, SttTranscript } from '../src/core/stt/types.ts';
import { floatToPcm16Bytes } from '../src/shared/audio/pcm16.ts';
import { MockGnaniServer } from './mock/mock-gnani-server.ts';
import { sine } from './helpers/signals.ts';
import { waitFor } from './helpers/wait.ts';

const tone = (freq: number) => floatToPcm16Bytes(sine(freq, 16_000, 0.032, 0.4));
const silence = () => new Uint8Array(1024);

/** 20 frames of tone then 12 of silence: one utterance for the mock VAD. */
function utterance(freq: number): Uint8Array[] {
  return [...Array.from({ length: 20 }, () => tone(freq)), ...Array.from({ length: 12 }, silence)];
}

function collector() {
  const transcripts: SttTranscript[] = [];
  const statuses: SttStatus[] = [];
  return {
    transcripts,
    statuses,
    states: () => statuses.map((s) => s.state),
    cb: {
      onTranscript: (t: SttTranscript) => transcripts.push(t),
      onStatus: (s: SttStatus) => statuses.push(s),
    },
  };
}

let server: MockGnaniServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
});

describe('GnaniSttProvider against the mock server', () => {
  it('connects with the right headers and turns utterances into final transcripts', async () => {
    server = new MockGnaniServer({ script: [{ freqHz: 400, text: 'premium kitna hoga?' }] });
    const url = await server.start();
    const c = collector();
    const stream = new GnaniSttProvider({ apiKey: 'test-key', url }).openStream(
      'them',
      { language: 'hi-IN' },
      c.cb,
    );

    await waitFor(() => c.states().includes('connected'), 3000, 'connected');
    const headers = server.connections[0]!.headers;
    expect(headers['lang_code']).toBe('hi-IN');
    expect(headers['x-sample-rate']).toBe('16000');
    expect(headers['x-api-request-id']).toMatch(/^req_/);

    for (const f of utterance(400)) stream.send(f);
    await waitFor(() => c.transcripts.length === 1, 3000, 'transcript');
    expect(c.transcripts[0]).toMatchObject({
      speaker: 'them',
      text: 'premium kitna hoga?',
      final: true,
      segmentIndex: 1,
      serverLatencyMs: 30,
    });
    expect(c.transcripts[0]!.endToEndLatencyMs).toBeGreaterThanOrEqual(0);
    expect(server.connections[0]!.badFrames).toBe(0);

    await stream.close();
    expect(c.states().at(-1)).toBe('closed');
    // The client's close can resolve before the server's own 'close' event fires (Windows).
    const conn = server.connections[0]!;
    await waitFor(() => conn.closeCode !== undefined, 2000, 'server close');
    expect(conn.closeCode).toBe(1000);
  });

  it('rejects frames that are not 1024 bytes', async () => {
    server = new MockGnaniServer();
    const url = await server.start();
    const stream = new GnaniSttProvider({ apiKey: 'test-key', url }).openStream(
      'me',
      { language: 'hi-IN' },
      collector().cb,
    );
    expect(() => stream.send(new Uint8Array(1000))).toThrow(/1024/);
    await stream.close();
  });

  it('reports a bad API key as a fatal error without retrying', async () => {
    server = new MockGnaniServer({ apiKey: 'right' });
    const url = await server.start();
    const c = collector();
    const stream = new GnaniSttProvider({
      apiKey: 'wrong',
      url,
      backoff: { baseMs: 10 },
    }).openStream('me', { language: 'hi-IN' }, c.cb);
    await waitFor(() => c.states().includes('error'), 3000, 'error');
    expect(c.statuses.find((s) => s.state === 'error')?.error).toMatch(/401/);
    await new Promise((r) => setTimeout(r, 100));
    expect(c.states()).not.toContain('reconnecting');
    await stream.close();
  });

  it('stops on a language the server refuses (close 1008) instead of retrying', async () => {
    server = new MockGnaniServer({ languages: ['hi-IN'] });
    const url = await server.start();
    const c = collector();
    const stream = new GnaniSttProvider({
      apiKey: 'test-key',
      url,
      backoff: { baseMs: 10 },
    }).openStream('me', { language: 'en-hi-in-cm' }, c.cb);
    await waitFor(() => c.states().includes('error'), 3000, 'error');
    expect(c.statuses.at(-1)?.error).toMatch(/does not support languages/);
    await new Promise((r) => setTimeout(r, 100));
    expect(server.connections).toHaveLength(1);
    expect(c.states()).not.toContain('reconnecting');
    await stream.close();
  });

  it('sends audio queued while connecting two frames at a time, not as a burst', async () => {
    server = new MockGnaniServer();
    const url = await server.start();
    const c = collector();
    const stream = new GnaniSttProvider({ apiKey: 'test-key', url }).openStream(
      'them',
      { language: 'hi-IN' },
      c.cb,
    );
    for (let i = 0; i < 10; i++) stream.send(silence());
    await waitFor(() => c.states().includes('connected'), 3000, 'connected');
    await new Promise((r) => setTimeout(r, 50));
    expect(server.connections[0]!.frames).toBe(0);
    stream.send(silence());
    await waitFor(() => server!.connections[0]!.frames === 2, 1000, 'two frames');
    await new Promise((r) => setTimeout(r, 50));
    expect(server.connections[0]!.frames).toBe(2);
    await stream.close();
  });

  it('reconnects with backoff when the server is unavailable', async () => {
    server = new MockGnaniServer({ rejectFirst: 2 });
    const url = await server.start();
    const c = collector();
    const stream = new GnaniSttProvider({
      apiKey: 'test-key',
      url,
      backoff: { baseMs: 20, jitter: 0 },
    }).openStream('them', { language: 'hi-IN' }, c.cb);
    await waitFor(() => c.states().includes('connected'), 3000, 'connected');
    const retries = c.statuses.filter(
      (s) => s.state === 'reconnecting' && s.retryInMs !== undefined,
    );
    expect(retries.map((s) => [s.attempt, s.retryInMs])).toEqual([
      [1, 20],
      [2, 40],
    ]);
    await stream.close();
  });

  it('reconnects after the connection drops mid-stream and keeps transcribing', async () => {
    server = new MockGnaniServer({
      dropAfterFrames: 40,
      script: [{ freqHz: 400, text: 'after reconnect' }],
    });
    const url = await server.start();
    const c = collector();
    const stream = new GnaniSttProvider({
      apiKey: 'test-key',
      url,
      backoff: { baseMs: 10, jitter: 0 },
    }).openStream('them', { language: 'hi-IN' }, c.cb);
    await waitFor(() => c.states().includes('connected'), 3000, 'connected');
    for (let i = 0; i < 45; i++) stream.send(silence());
    await waitFor(
      () => server!.connections.length === 2 && c.states().at(-1) === 'connected',
      3000,
      'reconnect',
    );
    for (const f of utterance(400)) stream.send(f);
    await waitFor(() => c.transcripts.length === 1, 3000, 'transcript');
    expect(c.transcripts[0]!.text).toBe('after reconnect');
    await stream.close();
  });

  it('gives up after maxReconnectAttempts', async () => {
    server = new MockGnaniServer({ rejectFirst: 100 });
    const url = await server.start();
    const c = collector();
    const stream = new GnaniSttProvider({
      apiKey: 'test-key',
      url,
      backoff: { baseMs: 5, jitter: 0 },
      maxReconnectAttempts: 2,
    }).openStream('them', { language: 'hi-IN' }, c.cb);
    await waitFor(() => c.states().includes('error'), 3000, 'error');
    expect(c.statuses.at(-1)?.error).toMatch(/Gave up/);
    await stream.close();
  });

  it('close() waits for a transcript that is still being processed', async () => {
    server = new MockGnaniServer({ latencyMs: 200, script: [{ freqHz: 400, text: 'last words' }] });
    const url = await server.start();
    const c = collector();
    const stream = new GnaniSttProvider({ apiKey: 'test-key', url }).openStream(
      'me',
      { language: 'hi-IN' },
      c.cb,
    );
    await waitFor(() => c.states().includes('connected'), 3000, 'connected');
    for (const f of utterance(400)) stream.send(f);
    // Wait until the server has started processing, then close immediately.
    await new Promise((r) => setTimeout(r, 60));
    await stream.close();
    expect(c.transcripts.map((t) => t.text)).toEqual(['last words']);
  });

  it('close() mid-sentence sends silence so the server still finalizes the line', async () => {
    server = new MockGnaniServer({ script: [{ freqHz: 400, text: 'cut off' }] });
    const url = await server.start();
    const c = collector();
    const stream = new GnaniSttProvider({ apiKey: 'test-key', url }).openStream(
      'me',
      { language: 'hi-IN' },
      c.cb,
    );
    await waitFor(() => c.states().includes('connected'), 3000, 'connected');
    // Speech with no trailing silence: like pressing Stop while someone is talking.
    for (let i = 0; i < 20; i++) stream.send(tone(400));
    await new Promise((r) => setTimeout(r, 100)); // speech_start has arrived
    await stream.close();
    expect(c.transcripts.map((t) => t.text)).toEqual(['cut off']);
    expect(c.states().at(-1)).toBe('closed');
  });

  it('surfaces partial transcripts as non-final', async () => {
    server = new MockGnaniServer({
      sendPartials: true,
      script: [{ freqHz: 400, text: 'one two three four' }],
    });
    const url = await server.start();
    const c = collector();
    const stream = new GnaniSttProvider({ apiKey: 'test-key', url }).openStream(
      'them',
      { language: 'hi-IN' },
      c.cb,
    );
    await waitFor(() => c.states().includes('connected'), 3000, 'connected');
    for (const f of utterance(400)) stream.send(f);
    await waitFor(() => c.transcripts.some((t) => t.final), 3000, 'final');
    expect(c.transcripts.map((t) => [t.text, t.final])).toEqual([
      ['one two', false],
      ['one two three four', true],
    ]);
    await stream.close();
  });
});
