import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { SttStatus, SttTranscript } from '../src/core/stt/types.ts';
import { WhisperSttProvider, whisperLanguage } from '../src/core/stt/whisper-provider.ts';
import { floatToPcm16Bytes } from '../src/shared/audio/pcm16.ts';
import { waitFor } from './helpers/wait.ts';

/** One 32 ms frame: a 300 Hz tone (speech) or digital silence. */
function frame(loud: boolean): Uint8Array {
  const f = new Float32Array(512);
  if (loud)
    for (let i = 0; i < f.length; i++) f[i] = 0.3 * Math.sin((2 * Math.PI * 300 * i) / 16000);
  return floatToPcm16Bytes(f);
}
const speech = (n: number) => Array.from({ length: n }, () => frame(true));
const silence = (n: number) => Array.from({ length: n }, () => frame(false));

interface Req {
  auth?: string;
  body: string; // multipart, read as latin1
}

/** A stand-in /audio/transcriptions endpoint. `reply` decides each response in turn. */
async function mockServer(
  reply: (n: number) => {
    status: number;
    text?: string;
    delayMs?: number;
    headers?: Record<string, string>;
  },
) {
  const requests: Req[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      requests.push({
        auth: req.headers.authorization,
        body: Buffer.concat(chunks).toString('latin1'),
      });
      const r = reply(requests.length);
      if (r.delayMs) await new Promise((ok) => setTimeout(ok, r.delayMs));
      res.writeHead(r.status, { 'content-type': 'application/json', ...r.headers });
      res.end(
        JSON.stringify(r.status === 200 ? { text: r.text ?? '' } : { error: { message: 'no' } }),
      );
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests };
}

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((ok) => s.close(ok));
  }
});

function open(url: string, language = 'hi-IN', apiKey = 'k') {
  const transcripts: SttTranscript[] = [];
  const statuses: SttStatus[] = [];
  let processing = 0;
  const stream = new WhisperSttProvider({
    baseUrl: url,
    apiKey,
    model: 'whisper-large-v3',
  }).openStream(
    'them',
    { language },
    {
      onTranscript: (t) => transcripts.push(t),
      onStatus: (s) => statuses.push(s),
      onProcessing: () => processing++,
    },
  );
  const feed = (frames: Uint8Array[]) => frames.forEach((f) => stream.send(f));
  return { stream, feed, transcripts, statuses, processing: () => processing };
}

describe('WhisperSttProvider', () => {
  it('sends one utterance after a pause and returns its text', async () => {
    const { url, requests } = await mockServer(() => ({ status: 200, text: ' kitna stock hai? ' }));
    const s = open(url);
    s.feed([...silence(5), ...speech(20), ...silence(25)]);
    await waitFor(() => s.transcripts.length === 1);
    expect(s.processing()).toBe(1);
    expect(s.transcripts[0]).toMatchObject({
      speaker: 'them',
      text: 'kitna stock hai?',
      final: true,
    });
    // 5 pre-roll frames + 20 speech + the 22 silent frames that ended it.
    expect(s.transcripts[0]!.audioDurationMs).toBe((5 + 20 + 22) * 32);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.auth).toBe('Bearer k');
    expect(requests[0]!.body).toContain('RIFF');
    expect(requests[0]!.body).toMatch(/name="language"\r\n\r\nhi\r\n/);
    expect(requests[0]!.body).toMatch(/name="model"\r\n\r\nwhisper-large-v3\r\n/);
    expect(s.statuses[0]?.state).toBe('connected');
  });

  it('sends nothing for silence or a short click: Whisper would invent words', async () => {
    const { url, requests } = await mockServer(() => ({ status: 200, text: 'Thank you.' }));
    const s = open(url);
    s.feed([...silence(30), ...speech(3), ...silence(30)]);
    await s.stream.close();
    expect(requests).toHaveLength(0);
    expect(s.transcripts).toHaveLength(0);
  });

  it('sends what was being said when the call stops', async () => {
    const { url } = await mockServer(() => ({ status: 200, text: 'aur rate?' }));
    const s = open(url);
    s.feed(speech(15));
    await s.stream.close();
    expect(s.transcripts.map((t) => t.text)).toEqual(['aur rate?']);
    expect(s.statuses.at(-1)?.state).toBe('closed');
  });

  it('keeps lines in the order they were spoken, even if the first is slow', async () => {
    const { url } = await mockServer((n) => ({
      status: 200,
      text: `line ${n}`,
      delayMs: n === 1 ? 80 : 0,
    }));
    const s = open(url);
    s.feed([...speech(10), ...silence(25), ...speech(10), ...silence(25)]);
    await waitFor(() => s.transcripts.length === 2);
    expect(s.transcripts.map((t) => t.text)).toEqual(['line 1', 'line 2']);
  });

  it('cuts a long monologue instead of waiting for a pause', async () => {
    const { url, requests } = await mockServer(() => ({ status: 200, text: 'x' }));
    const s = open(url);
    // 20 s cap, then 20 more frames: the remainder is its own utterance.
    s.feed(speech(Math.ceil(20_000 / 32) + 20));
    await waitFor(() => requests.length === 1);
    await s.stream.close();
    expect(requests).toHaveLength(2);
  });

  it('a refused key is fatal: red status, no more requests, placeholder cleared', async () => {
    const { url, requests } = await mockServer(() => ({ status: 401 }));
    const s = open(url);
    s.feed([...speech(10), ...silence(25)]);
    await waitFor(() => s.transcripts.length === 1);
    expect(s.transcripts[0]!.text).toBe('');
    expect(s.statuses.at(-1)).toMatchObject({ state: 'error' });
    expect(s.statuses.at(-1)?.error).toMatch(/rejected the key \(HTTP 401\)/);
    expect(s.statuses.at(-1)?.error).not.toContain('k'.repeat(2));
    s.feed([...speech(10), ...silence(25)]);
    await new Promise((ok) => setTimeout(ok, 50));
    expect(requests).toHaveLength(1);
  });

  it('waits out a short rate limit and retries the utterance once', async () => {
    const { url, requests } = await mockServer((n) =>
      n === 1
        ? { status: 429, headers: { 'retry-after': '0.05' } }
        : { status: 200, text: 'ji haan' },
    );
    const s = open(url);
    s.feed([...speech(10), ...silence(25)]);
    await waitFor(() => s.transcripts.length === 1);
    expect(s.transcripts[0]!.text).toBe('ji haan');
    expect(requests).toHaveLength(2);
    expect(s.statuses.map((x) => x.state)).toEqual(['connected', 'reconnecting', 'connected']);
  });

  it('reports other failures without stopping the stream', async () => {
    const { url } = await mockServer((n) =>
      n === 1 ? { status: 500 } : { status: 200, text: 'ok' },
    );
    const s = open(url);
    s.feed([...speech(10), ...silence(25), ...speech(10), ...silence(25)]);
    await waitFor(() => s.transcripts.length === 2);
    expect(s.transcripts.map((t) => t.text)).toEqual(['', 'ok']);
    expect(s.statuses.find((x) => x.error)?.error).toMatch(/HTTP 500/);
  });

  it('sends no Authorization header to a local server without a key', async () => {
    const { url, requests } = await mockServer(() => ({ status: 200, text: 'x' }));
    const s = open(url, 'hi-IN', '');
    s.feed([...speech(10), ...silence(25)]);
    await waitFor(() => requests.length === 1);
    expect(requests[0]!.auth).toBeUndefined();
  });
});

describe('whisperLanguage', () => {
  it('maps Gnani language codes to Whisper ones', () => {
    expect(whisperLanguage('hi-IN')).toBe('hi');
    expect(whisperLanguage('ta-IN')).toBe('ta');
    expect(whisperLanguage('indic-auto')).toBeUndefined();
  });
});
