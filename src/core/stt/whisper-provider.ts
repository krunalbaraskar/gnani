/**
 * Speech-to-text through any OpenAI-compatible /audio/transcriptions endpoint: Groq's free
 * Whisper, OpenAI, or a local Whisper server. Those endpoints take whole files, not a live
 * stream, so this cuts the audio into utterances with a simple energy detector and sends
 * each one when the speaker pauses. A stand-in for testing without a Gnani key.
 */
import { frameLevelDb } from '../../shared/audio/silence-gate.ts';
import { encodeWav16 } from '../../shared/audio/wav.ts';
import { bytesLEToPcm16, pcm16ToFloat } from '../../shared/audio/pcm16.ts';
import type { Speaker } from '../../shared/transcript/types.ts';
import { type Logger, silentLogger } from '../util/logger.ts';
import { GNANI_AUTO_DETECT } from './gnani-protocol.ts';
import type { SttProvider, SttStream, SttStreamCallbacks, SttStreamOptions } from './types.ts';

export const WHISPER_DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
export const WHISPER_DEFAULT_MODEL = 'whisper-large-v3';

const FRAME_MS = 32; // 1024-byte PCM16 frames at 16 kHz
const SAMPLE_RATE = 16_000;

export interface WhisperConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  logger?: Logger;
  fetch?: typeof fetch;
  now?: () => number;
  /** Frames louder than this count as speech. */
  speechDb?: number;
  /** A pause this long ends an utterance. */
  endSilenceMs?: number;
  /** A monologue is cut and sent at this length. */
  maxUtteranceMs?: number;
  /** Utterances with less speech than this are dropped: Whisper invents text for noise. */
  minSpeechMs?: number;
  requestTimeoutMs?: number;
}

/** "hi-IN" → "hi". Gnani's auto-detect → let Whisper detect. */
export function whisperLanguage(code: string): string | undefined {
  if (code === GNANI_AUTO_DETECT) return undefined;
  return /^([a-z]{2})(?:-|$)/i.exec(code)?.[1]?.toLowerCase();
}

export class WhisperSttProvider implements SttProvider {
  readonly name = 'whisper';
  private readonly cfg: WhisperConfig;

  constructor(cfg: WhisperConfig) {
    if (!cfg.baseUrl) throw new Error('Speech-to-text base URL is not set');
    this.cfg = cfg;
  }

  openStream(
    speaker: Speaker,
    options: SttStreamOptions,
    callbacks: SttStreamCallbacks,
  ): SttStream {
    return new WhisperStream(speaker, options, callbacks, this.cfg);
  }
}

class WhisperStream implements SttStream {
  private readonly preRoll: Uint8Array[] = [];
  private utterance: Uint8Array[] | null = null;
  private speechFrames = 0;
  private silentRun = 0;
  private lastSpeechAt = 0;
  private counter = 0;
  /** Transcriptions run one at a time, so lines arrive in the order they were spoken. */
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;
  private readonly log: Logger;
  private readonly now: () => number;
  private readonly speechDb: number;
  private readonly endSilenceFrames: number;
  private readonly maxFrames: number;
  private readonly minSpeechFrames: number;

  private readonly speaker: Speaker;
  private readonly options: SttStreamOptions;
  private readonly cb: SttStreamCallbacks;
  private readonly cfg: WhisperConfig;

  constructor(
    speaker: Speaker,
    options: SttStreamOptions,
    cb: SttStreamCallbacks,
    cfg: WhisperConfig,
  ) {
    this.speaker = speaker;
    this.options = options;
    this.cb = cb;
    this.cfg = cfg;
    this.log = cfg.logger ?? silentLogger;
    this.now = cfg.now ?? Date.now;
    this.speechDb = cfg.speechDb ?? -45;
    this.endSilenceFrames = Math.ceil((cfg.endSilenceMs ?? 700) / FRAME_MS);
    this.maxFrames = Math.ceil((cfg.maxUtteranceMs ?? 20_000) / FRAME_MS);
    this.minSpeechFrames = Math.ceil((cfg.minSpeechMs ?? 250) / FRAME_MS);
    // There is no connection to open: the endpoint is called once per utterance.
    queueMicrotask(() => {
      if (!this.stopped) this.cb.onStatus({ speaker, state: 'connected' });
    });
  }

  send(frame: Uint8Array): void {
    if (this.stopped) return;
    const speech = frameLevelDb(frame) > this.speechDb;
    if (!this.utterance) {
      if (!speech) {
        // Keep ~250 ms before speech starts, so the first syllable isn't clipped.
        this.preRoll.push(frame);
        if (this.preRoll.length > 8) this.preRoll.shift();
        return;
      }
      this.utterance = this.preRoll.splice(0);
      this.speechFrames = 0;
      this.silentRun = 0;
    }
    this.utterance.push(frame);
    if (speech) {
      this.speechFrames++;
      this.silentRun = 0;
      this.lastSpeechAt = this.now();
    } else {
      this.silentRun++;
    }
    if (this.silentRun >= this.endSilenceFrames || this.utterance.length >= this.maxFrames) {
      this.flush();
    }
  }

  async close(): Promise<void> {
    if (this.stopped) return;
    this.flush(); // whatever was being said when the call stopped
    this.stopped = true;
    await Promise.race([this.queue, new Promise((r) => setTimeout(r, 8000))]);
    this.cb.onStatus({ speaker: this.speaker, state: 'closed' });
  }

  private flush(): void {
    const frames = this.utterance;
    this.utterance = null;
    if (!frames || this.speechFrames < this.minSpeechFrames) return;
    const id = ++this.counter;
    const lastSpeechAt = this.lastSpeechAt;
    this.cb.onProcessing?.(this.speaker);
    this.queue = this.queue.then(() => this.transcribe(frames, id, lastSpeechAt));
  }

  private async transcribe(frames: Uint8Array[], id: number, lastSpeechAt: number) {
    const pcm = new Uint8Array(frames.length * frames[0]!.length);
    frames.forEach((f, i) => pcm.set(f, i * f.length));
    const wav = encodeWav16([pcm16ToFloat(bytesLEToPcm16(pcm))], SAMPLE_RATE);

    let text = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await this.request(wav);
      if ('text' in result) {
        text = result.text;
        break;
      }
      if (result.retryInMs !== undefined && attempt === 1) {
        // Rate limited: wait as told (briefly) and try this utterance once more.
        this.cb.onStatus({
          speaker: this.speaker,
          state: 'reconnecting',
          retryInMs: result.retryInMs,
          error: result.error,
        });
        await new Promise((r) => setTimeout(r, result.retryInMs));
        this.cb.onStatus({ speaker: this.speaker, state: 'connected' });
        continue;
      }
      if (result.fatal) this.stopped = true;
      this.cb.onStatus({
        speaker: this.speaker,
        state: result.fatal ? 'error' : 'connected',
        error: result.error,
      });
      break;
    }
    // An empty final clears the "…" placeholder even when nothing was recognised.
    const receivedAt = this.now();
    this.cb.onTranscript({
      speaker: this.speaker,
      text,
      final: true,
      segmentId: `w${id}`,
      segmentIndex: id,
      audioDurationMs: frames.length * FRAME_MS,
      endToEndLatencyMs: Math.max(0, receivedAt - lastSpeechAt),
      receivedAt,
    });
  }

  private async request(
    wav: Uint8Array,
  ): Promise<{ text: string } | { error: string; fatal?: boolean; retryInMs?: number }> {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
    form.append('model', this.cfg.model);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    const language = whisperLanguage(this.options.language);
    if (language) form.append('language', language);

    const url = `${this.cfg.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;
    let res: Response;
    try {
      res = await (this.cfg.fetch ?? fetch)(url, {
        method: 'POST',
        headers: this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {},
        body: form,
        signal: AbortSignal.timeout(this.cfg.requestTimeoutMs ?? 20_000),
      });
    } catch (err) {
      this.log.warn('transcription request failed', { speaker: this.speaker });
      return { error: `Could not reach speech-to-text: ${(err as Error).message}` };
    }
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { text?: string };
      return { text: (body.text ?? '').trim() };
    }
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    const status = res.status;
    if (status === 401 || status === 403) {
      return { error: `Speech-to-text rejected the key (HTTP ${status})`, fatal: true };
    }
    if (status === 429) {
      const after = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(after) && after > 0 ? after * 1000 : 2000;
      const error = 'Speech-to-text rate limit reached (HTTP 429)';
      return wait <= 10_000 ? { error, retryInMs: wait } : { error };
    }
    return { error: `Speech-to-text failed (HTTP ${status}): ${detail || 'no details'}` };
  }
}
