/**
 * A stand-in for Gnani's realtime STT WebSocket, speaking the protocol described in
 * src/core/stt/gnani-protocol.ts. Used by tests, and runnable for offline dev with
 * `npm run mock-gnani` (then set GNANI_STT_URL=ws://localhost:8787).
 *
 * It runs a simple energy VAD on received frames. When an utterance ends it sends
 * `processing`, then `transcript`. Text comes from a script: test fixtures encode each
 * utterance as a tone, and the server picks the script line with the nearest pitch.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { bytesLEToPcm16 } from '../../src/shared/audio/pcm16.ts';
import { frameLevelDb } from '../../src/shared/audio/silence-gate.ts';

export interface ScriptLine {
  freqHz: number;
  text: string;
}

export interface MockGnaniOptions {
  port?: number;
  /** Required value of x-api-key-id. Wrong key → HTTP 401 on upgrade. */
  apiKey?: string;
  script?: ScriptLine[];
  /** Simulated server processing time before a transcript is sent. */
  latencyMs?: number;
  speechThresholdDb?: number;
  /** Silent frames that end an utterance (8 × 32 ms = 256 ms). */
  endSilenceFrames?: number;
  minSpeechFrames?: number;
  /** Reject the first N connection attempts with HTTP 503 (reconnect tests). */
  rejectFirst?: number;
  /** Server drops each connection after this many frames (reconnect tests). */
  dropAfterFrames?: number;
  /** Also send a partial transcript before each final one. */
  sendPartials?: boolean;
  /** Refuse other lang_codes like the real server: an `error` message, then close 1008. */
  languages?: string[];
}

export interface ConnectionRecord {
  headers: Record<string, string | string[] | undefined>;
  frames: number;
  badFrames: number;
  transcripts: string[];
  closeCode?: number;
}

const SAMPLE_RATE = 16_000;

export class MockGnaniServer {
  readonly connections: ConnectionRecord[] = [];
  private readonly opts: Required<
    Omit<MockGnaniOptions, 'script' | 'dropAfterFrames' | 'languages'>
  > &
    Pick<MockGnaniOptions, 'script' | 'dropAfterFrames' | 'languages'>;
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private rejected = 0;
  private segmentCounter = 0;

  constructor(opts: MockGnaniOptions = {}) {
    this.opts = {
      port: 0,
      apiKey: 'test-key',
      latencyMs: 30,
      speechThresholdDb: -40,
      endSilenceFrames: 8,
      minSpeechFrames: 4,
      rejectFirst: 0,
      sendPartials: false,
      ...opts,
    };
  }

  async start(): Promise<string> {
    this.http = createServer((_req, res) => res.writeHead(426).end());
    this.wss = new WebSocketServer({ noServer: true });
    this.http.on('upgrade', (req, socket, head) => {
      const reject = (status: number, text: string) => {
        socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
        socket.destroy();
      };
      if (req.headers['x-api-key-id'] !== this.opts.apiKey) return reject(401, 'Unauthorized');
      if (this.rejected < this.opts.rejectFirst) {
        this.rejected++;
        return reject(503, 'Service Unavailable');
      }
      this.wss!.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, req));
    });
    await new Promise<void>((resolve) => this.http!.listen(this.opts.port, '127.0.0.1', resolve));
    const { port } = this.http.address() as AddressInfo;
    return `ws://127.0.0.1:${port}/stt/v3/stream`;
  }

  async stop(): Promise<void> {
    for (const c of this.wss?.clients ?? []) c.terminate();
    this.wss?.close();
    await new Promise<void>((resolve) =>
      this.http ? this.http.close(() => resolve()) : resolve(),
    );
  }

  /** Resolves once the given total number of transcripts has been sent. */
  async waitForTranscripts(count: number, timeoutMs = 10_000): Promise<void> {
    const start = Date.now();
    while (this.connections.reduce((n, c) => n + c.transcripts.length, 0) < count) {
      if (Date.now() - start > timeoutMs)
        throw new Error(`timed out waiting for ${count} transcripts`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const record: ConnectionRecord = {
      headers: req.headers,
      frames: 0,
      badFrames: 0,
      transcripts: [],
    };
    this.connections.push(record);
    const lang = String(req.headers['lang_code'] ?? '');
    if (this.opts.languages && !this.opts.languages.includes(lang)) {
      ws.send(JSON.stringify({ type: 'error', message: `does not support languages: ${lang}` }));
      ws.close(1008);
      return;
    }
    const sampleRate = Number(req.headers['x-sample-rate'] ?? SAMPLE_RATE);
    ws.send(
      JSON.stringify({
        type: 'connected',
        message: 'Connected to STT stream',
        timestamp: new Date().toISOString(),
        config: { sample_rate: sampleRate, chunk_size: 512 },
      }),
    );

    let speech: Int16Array[] = [];
    let speechFrames = 0;
    let silentRun = 0;

    ws.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const frame = new Uint8Array(data as Buffer);
      record.frames++;
      if (frame.length !== 1024) {
        record.badFrames++;
        ws.send(JSON.stringify({ type: 'error', message: `bad frame size ${frame.length}` }));
        return;
      }
      if (this.opts.dropAfterFrames && record.frames >= this.opts.dropAfterFrames) {
        ws.terminate();
        return;
      }
      const voiced = frameLevelDb(frame) >= this.opts.speechThresholdDb;
      if (voiced) {
        if (speechFrames === 0) ws.send(JSON.stringify({ type: 'speech_start' }));
        speech.push(bytesLEToPcm16(frame));
        speechFrames++;
        silentRun = 0;
        return;
      }
      if (speechFrames === 0) return;
      silentRun++;
      if (silentRun < this.opts.endSilenceFrames) return;
      const utterance = speech;
      const frames = speechFrames;
      speech = [];
      speechFrames = 0;
      silentRun = 0;
      if (frames < this.opts.minSpeechFrames) return;
      this.finishUtterance(ws, record, utterance, sampleRate);
    });

    ws.on('close', (code) => {
      record.closeCode = code;
    });
  }

  private finishUtterance(
    ws: WebSocket,
    record: ConnectionRecord,
    frames: Int16Array[],
    rate: number,
  ): void {
    const index = ++this.segmentCounter;
    const text = this.pickText(frames, rate, index);
    const durationMs = Math.round((frames.length * 512 * 1000) / rate);
    ws.send(JSON.stringify({ type: 'speech_end' }));
    ws.send(JSON.stringify({ type: 'processing', timestamp: new Date().toISOString() }));
    const segmentId = `seg_${index.toString(16).padStart(8, '0')}`;
    if (this.opts.sendPartials) {
      const words = text.split(' ');
      ws.send(
        JSON.stringify({
          type: 'partial',
          text: words.slice(0, Math.ceil(words.length / 2)).join(' '),
          segment_id: segmentId,
          is_final: false,
        }),
      );
    }
    setTimeout(() => {
      if (ws.readyState !== ws.OPEN) return;
      record.transcripts.push(text);
      ws.send(
        JSON.stringify({
          type: 'transcript',
          text,
          audio_duration_ms: durationMs,
          segment_id: segmentId,
          segment_index: String(index), // the SDK types this as a string
          latency: this.opts.latencyMs,
          timestamp: new Date().toISOString(),
        }),
      );
    }, this.opts.latencyMs);
  }

  private pickText(frames: Int16Array[], rate: number, index: number): string {
    const script = this.opts.script;
    if (!script?.length) {
      return `[mock] utterance ${index} (${((frames.length * 512) / rate).toFixed(1)}s)`;
    }
    const freq = estimateFrequency(frames, rate);
    let best = script[0]!;
    for (const line of script) {
      if (Math.abs(line.freqHz - freq) < Math.abs(best.freqHz - freq)) best = line;
    }
    return best.text;
  }
}

/** Zero-crossing pitch estimate over the middle of the utterance. */
export function estimateFrequency(frames: Int16Array[], rate: number): number {
  const all = new Int16Array(frames.reduce((n, f) => n + f.length, 0));
  let o = 0;
  for (const f of frames) {
    all.set(f, o);
    o += f.length;
  }
  const from = Math.floor(all.length * 0.2);
  const to = Math.floor(all.length * 0.8);
  let crossings = 0;
  for (let i = from + 1; i < to; i++) if (all[i - 1]! < 0 !== all[i]! < 0) crossings++;
  return (crossings / 2) * (rate / Math.max(1, to - from));
}
