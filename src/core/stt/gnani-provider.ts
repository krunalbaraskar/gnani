import WebSocket from 'ws';
import type { Speaker } from '../../shared/transcript/types.ts';
import { frameLevelDb } from '../../shared/audio/silence-gate.ts';
import { type Logger, silentLogger } from '../util/logger.ts';
import { backoffDelay, type BackoffOptions } from './backoff.ts';
import {
  buildGnaniHeaders,
  GNANI_CONNECT_TIMEOUT_MS,
  GNANI_DEFAULT_STT_URL,
  GNANI_FATAL_HTTP_STATUSES,
  GNANI_FRAME_BYTES,
  GNANI_NORMAL_CLOSE_CODE,
  isFatalGnaniError,
  makeRequestId,
  parseGnaniMessage,
} from './gnani-protocol.ts';
import type {
  SttConnectionState,
  SttProvider,
  SttStream,
  SttStreamCallbacks,
  SttStreamOptions,
} from './types.ts';

export interface GnaniProviderOptions {
  apiKey: string;
  url?: string;
  backoff?: Partial<BackoffOptions>;
  /** Give up after this many consecutive failed reconnects (default: never). */
  maxReconnectAttempts?: number;
  /** Ping interval used to detect dead connections. */
  heartbeatMs?: number;
  /** How long close() waits for a transcript the server is still processing. */
  closeGraceMs?: number;
  /** Frames kept while (re)connecting and sent once connected (~0.5 s). */
  preConnectFrames?: number;
  /** Frames at or above this level count as speech for latency measurement. */
  voicedThresholdDb?: number;
  logger?: Logger;
  now?: () => number;
}

export class GnaniSttProvider implements SttProvider {
  readonly name = 'gnani';
  private readonly opts: GnaniProviderOptions;

  constructor(opts: GnaniProviderOptions) {
    if (!opts.apiKey) throw new Error('GNANI_API_KEY is not set');
    this.opts = opts;
  }

  openStream(
    speaker: Speaker,
    options: SttStreamOptions,
    callbacks: SttStreamCallbacks,
  ): SttStream {
    const stream = new GnaniStream(speaker, options, callbacks, this.opts);
    stream.connect();
    return stream;
  }
}

/** One WebSocket per speaker, with reconnect, heartbeat and latency measurement. */
export class GnaniStream implements SttStream {
  private ws: WebSocket | null = null;
  private state: SttConnectionState = 'idle';
  private attempt = 0;
  private closing = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private awaitingPong = false;
  private pending: Uint8Array[] = [];
  private dropped = 0;
  private lastVoicedAt = 0;
  private inFlight = 0; // utterances the server is transcribing
  private inFlightWaiters: (() => void)[] = [];
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly speaker: Speaker;
  private readonly streamOpts: SttStreamOptions;
  private readonly cb: SttStreamCallbacks;
  private readonly opts: GnaniProviderOptions;

  constructor(
    speaker: Speaker,
    streamOpts: SttStreamOptions,
    cb: SttStreamCallbacks,
    opts: GnaniProviderOptions,
  ) {
    this.speaker = speaker;
    this.streamOpts = streamOpts;
    this.cb = cb;
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.log = opts.logger ?? silentLogger;
  }

  connect(): void {
    if (this.closing) return;
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const url = this.opts.url ?? GNANI_DEFAULT_STT_URL;
    const headers = buildGnaniHeaders({
      apiKey: this.opts.apiKey,
      language: this.streamOpts.language,
      requestId: makeRequestId(),
      formatNumbers: this.streamOpts.formatNumbers,
    });
    this.log.info('stt connecting', {
      speaker: this.speaker,
      url,
      language: this.streamOpts.language,
    });

    const ws = new WebSocket(url, { headers, handshakeTimeout: GNANI_CONNECT_TIMEOUT_MS });
    this.ws = ws;
    let gotConnected = false;

    ws.on('unexpected-response', (_req, res) => {
      const status = res.statusCode ?? 0;
      res.resume();
      const fatal = GNANI_FATAL_HTTP_STATUSES.has(status);
      this.log.warn('stt handshake rejected', { speaker: this.speaker, status });
      this.fail(`Server rejected connection (HTTP ${status})`, fatal);
      ws.terminate();
    });

    ws.on('open', () => {
      this.connectTimer = setTimeout(() => {
        this.fail('Timed out waiting for the server to accept the stream', false);
        ws.terminate();
      }, GNANI_CONNECT_TIMEOUT_MS);
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const event = parseGnaniMessage(data.toString());
      switch (event.kind) {
        case 'connected':
          gotConnected = true;
          this.onConnected();
          break;
        case 'processing':
          this.inFlight++;
          this.cb.onProcessing?.(this.speaker);
          break;
        case 'transcript': {
          if (event.final) this.settleInFlight();
          const receivedAt = this.now();
          const e2e = this.lastVoicedAt ? receivedAt - this.lastVoicedAt : undefined;
          this.cb.onTranscript({
            speaker: this.speaker,
            text: event.text,
            final: event.final,
            segmentId: event.segmentId || `${this.speaker}-${receivedAt}`,
            segmentIndex: event.segmentIndex,
            audioDurationMs: event.audioDurationMs,
            serverLatencyMs: event.latencyMs,
            endToEndLatencyMs: e2e !== undefined && e2e >= 0 && e2e < 30_000 ? e2e : undefined,
            receivedAt,
          });
          break;
        }
        case 'error': {
          this.log.warn('stt server error', { speaker: this.speaker, message: event.message });
          const fatal = !gotConnected && isFatalGnaniError(event.message);
          if (fatal) {
            this.fail(event.message, true);
            ws.terminate();
          } else {
            this.cb.onStatus({ speaker: this.speaker, state: this.state, error: event.message });
          }
          break;
        }
        case 'vad':
          break;
        case 'unknown':
          this.log.warn('stt unknown message', { speaker: this.speaker, type: event.type });
          break;
      }
    });

    ws.on('pong', () => {
      this.awaitingPong = false;
    });

    ws.on('error', (err) => {
      // 'close' follows; just record why.
      this.log.warn('stt socket error', { speaker: this.speaker, error: err.message });
    });

    ws.on('close', (code) => {
      if (this.ws !== ws) return; // superseded
      this.clearConnectionTimers();
      this.ws = null;
      this.settleInFlight(true);
      if (this.closing || this.state === 'error') {
        if (this.state !== 'error') this.setState('closed');
        return;
      }
      this.log.warn('stt connection closed', { speaker: this.speaker, code });
      this.scheduleReconnect();
    });
  }

  send(frame: Uint8Array): void {
    if (this.closing || this.state === 'error') return;
    if (frame.length !== GNANI_FRAME_BYTES) {
      throw new Error(`frames must be ${GNANI_FRAME_BYTES} bytes, got ${frame.length}`);
    }
    if (frameLevelDb(frame) >= (this.opts.voicedThresholdDb ?? -50)) this.lastVoicedAt = this.now();
    const ws = this.ws;
    if (this.state === 'connected' && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(frame);
      return;
    }
    // Keep a short tail while connecting so the first words aren't lost.
    this.pending.push(frame);
    const max = this.opts.preConnectFrames ?? 16;
    while (this.pending.length > max) {
      this.pending.shift();
      this.dropped++;
    }
  }

  async close(): Promise<void> {
    if (this.closing) return;
    // Let an utterance that's already being transcribed come back first.
    if (this.inFlight > 0 && this.state === 'connected') {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, this.opts.closeGraceMs ?? 2000);
        this.inFlightWaiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    if (!ws) {
      if (this.state !== 'error') this.setState('closed');
      return;
    }
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => {
        ws.terminate();
        resolve();
      }, 2000);
      ws.once('close', () => {
        clearTimeout(force);
        resolve();
      });
      if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
      else ws.close(GNANI_NORMAL_CLOSE_CODE);
    });
  }

  private onConnected(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    this.attempt = 0;
    this.setState('connected');
    const ws = this.ws;
    if (ws) for (const f of this.pending) ws.send(f);
    this.pending = [];
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    const every = this.opts.heartbeatMs ?? 15_000;
    this.awaitingPong = false;
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws) return;
      if (this.awaitingPong) {
        this.log.warn('stt heartbeat missed, reconnecting', { speaker: this.speaker });
        ws.terminate();
        return;
      }
      this.awaitingPong = true;
      ws.ping();
    }, every);
  }

  private scheduleReconnect(): void {
    this.attempt++;
    const max = this.opts.maxReconnectAttempts;
    if (max !== undefined && this.attempt > max) {
      this.fail(`Gave up after ${max} reconnect attempts`, true);
      return;
    }
    const delay = backoffDelay(this.attempt, this.opts.backoff);
    this.state = 'reconnecting';
    this.cb.onStatus({
      speaker: this.speaker,
      state: 'reconnecting',
      attempt: this.attempt,
      retryInMs: delay,
      droppedFrames: this.dropped,
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private fail(message: string, fatal: boolean): void {
    if (fatal) {
      this.state = 'error';
      this.cb.onStatus({ speaker: this.speaker, state: 'error', error: message });
    } else {
      this.cb.onStatus({ speaker: this.speaker, state: this.state, error: message });
    }
  }

  private settleInFlight(all = false): void {
    this.inFlight = all ? 0 : Math.max(0, this.inFlight - 1);
    if (this.inFlight === 0) {
      const waiters = this.inFlightWaiters;
      this.inFlightWaiters = [];
      waiters.forEach((w) => w());
    }
  }

  private clearConnectionTimers(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.connectTimer = null;
    this.heartbeatTimer = null;
  }

  private setState(state: SttConnectionState): void {
    this.state = state;
    this.cb.onStatus({ speaker: this.speaker, state, droppedFrames: this.dropped || undefined });
  }
}
