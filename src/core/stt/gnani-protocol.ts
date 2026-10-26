/**
 * Gnani realtime STT wire protocol — the ONE place that encodes what we believe about
 * Gnani's API. Everything else in Bolo talks to the generic SttProvider interface.
 *
 * Taken from the official `gnani-vachana` Python SDK v0.7.9 on PyPI (gnani/stt/client.py,
 * GnaniSTTStreamClient), then checked against the live API with a real key on
 * 2026-10-23. What is still unconfirmed is marked TODO(verify-gnani).
 */

/**
 * Streaming endpoint, from the SDK: DEFAULT_BASE_URL + STT_STREAM_ENDPOINT. Works with a
 * real key. Override with GNANI_STT_URL if your account uses a different host.
 */
export const GNANI_DEFAULT_STT_URL = 'wss://api.vachana.ai/stt/v3/stream';

/** 512 PCM16 samples per frame = 1024 bytes = 32 ms at 16 kHz (server: chunk_size 512). */
export const GNANI_FRAME_BYTES = 1024;
export const GNANI_FRAME_MS = 32;
export const GNANI_SAMPLE_RATE = 16_000;

/** Wait this long for the server's `connected` message after the socket opens. */
export const GNANI_CONNECT_TIMEOUT_MS = 10_000;

/**
 * `lang_code` that asks the server to detect the language. The comma-separated list
 * older SDKs sent is now refused ("exactly one locale is required", close 1008);
 * `indic-auto` is in the server's own list of supported codes and is accepted.
 * TODO(verify-gnani): how accurate indic-auto is has not been tested.
 */
export const GNANI_AUTO_DETECT = 'indic-auto';

export interface GnaniLanguage {
  code: string;
  label: string;
  /** Present when the option rests on an unverified assumption. */
  experimental?: boolean;
  /** Supports `x-format: transcribe` (numbers/currency as digits). SDK: hi-IN, en-IN only. */
  supportsItn?: boolean;
}

/**
 * From SDK v0.7.9 STREAM_SUPPORTED_LANGUAGES, plus auto-detect. The live server also
 * lists as-IN (Assamese). It refuses `en-hi-in-cm` (Hinglish, dropped from the SDK in
 * v0.7.8); for Hinglish use hi-IN, which writes English words in Devanagari.
 */
export const GNANI_LANGUAGES: readonly GnaniLanguage[] = [
  { code: 'hi-IN', label: 'Hindi', supportsItn: true },
  { code: 'en-IN', label: 'English (India)', supportsItn: true },
  { code: 'ta-IN', label: 'Tamil' },
  { code: 'te-IN', label: 'Telugu' },
  { code: 'kn-IN', label: 'Kannada' },
  { code: 'ml-IN', label: 'Malayalam' },
  { code: 'mr-IN', label: 'Marathi' },
  { code: 'bn-IN', label: 'Bengali' },
  { code: 'gu-IN', label: 'Gujarati' },
  { code: 'pa-IN', label: 'Punjabi' },
  { code: GNANI_AUTO_DETECT, label: 'Auto-detect (experimental)', experimental: true },
];

export interface GnaniConnectOptions {
  apiKey: string;
  language: string;
  requestId: string;
  sampleRate?: number;
  /** true → `x-format: transcribe` (inverse text normalisation). */
  formatNumbers?: boolean;
}

/**
 * Handshake = HTTP upgrade headers only, no JSON start message (confirmed live). Header
 * names copied verbatim from GnaniSTTStreamClient.connect().
 */
export function buildGnaniHeaders(o: GnaniConnectOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'x-api-key-id': o.apiKey,
    lang_code: o.language,
    'x-sample-rate': String(o.sampleRate ?? GNANI_SAMPLE_RATE),
    'x-api-request-id': o.requestId,
  };
  if (o.formatNumbers) headers['x-format'] = 'transcribe';
  return headers;
}

/** Same as the SDK's resolve_request_id: `req_` + 12 hex chars. */
export function makeRequestId(random: () => number = Math.random): string {
  let hex = '';
  for (let i = 0; i < 12; i++) hex += Math.floor(random() * 16).toString(16);
  return `req_${hex}`;
}

/** Copy of headers that is safe to log. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return { ...headers, 'x-api-key-id': headers['x-api-key-id'] ? '***' : '(missing)' };
}

export type GnaniServerEvent =
  | { kind: 'connected'; message: string; sampleRate?: number; chunkSize?: number }
  | { kind: 'processing' }
  | { kind: 'vad'; event: string }
  | {
      kind: 'transcript';
      text: string;
      final: boolean;
      segmentId: string;
      segmentIndex?: number;
      audioDurationMs?: number;
      latencyMs?: number;
      timestamp?: string;
    }
  | { kind: 'error'; message: string }
  | { kind: 'unknown'; type: string };

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/**
 * Parses one text frame from the server. Shapes seen from the live server:
 *   {"type":"connected","message","request_id","config":{"sample_rate","chunk_size",
 *    "partials_enabled":false,"language_code","format",..}}
 *   {"type":"speech_start","utterance_id","timestamp"}
 *   {"type":"transcript","text","audio_duration_ms","segment_id","segment_index":1,
 *    "utterance_id","is_final":true,"latency","timestamp","output":{"literal"}}
 *   {"type":"error","message","timestamp"} (+ "timeout_reason":"idle" after 60 s of no speech)
 * The SDK also knows "processing" and "speech_end"/"vad_start"/"vad_end"; the live server
 * didn't send them, but they are still handled.
 */
export function parseGnaniMessage(raw: string): GnaniServerEvent {
  let p: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { kind: 'unknown', type: 'non-object' };
    p = parsed as Record<string, unknown>;
  } catch {
    return { kind: 'unknown', type: 'invalid-json' };
  }
  const type = typeof p['type'] === 'string' ? p['type'] : '';
  switch (type) {
    case 'connected': {
      const config = (p['config'] ?? {}) as Record<string, unknown>;
      return {
        kind: 'connected',
        message: String(p['message'] ?? ''),
        sampleRate: num(config['sample_rate']),
        chunkSize: num(config['chunk_size']),
      };
    }
    case 'processing':
      return { kind: 'processing' };
    case 'speech_start':
    case 'speech_end':
    case 'vad_start':
    case 'vad_end':
      return { kind: 'vad', event: type };
    // The live server reports partials_enabled:false and sent only final transcripts.
    // "partial"/"interim" types and `is_final: false` are accepted in case that changes.
    case 'transcript':
    case 'partial':
    case 'interim':
      return {
        kind: 'transcript',
        text: String(p['text'] ?? ''),
        final: type === 'transcript' && p['is_final'] !== false,
        segmentId: String(p['segment_id'] ?? ''),
        // The live server sends a number; the SDK types it as str. Accept either.
        segmentIndex: num(p['segment_index']),
        audioDurationMs: num(p['audio_duration_ms']),
        // TODO(verify-gnani): SDK documents `latency` as server-side processing ms. Live
        // values (144–269) fit that, but the meaning is unconfirmed.
        latencyMs: num(p['latency']),
        timestamp: typeof p['timestamp'] === 'string' ? p['timestamp'] : undefined,
      };
    case 'error':
      return { kind: 'error', message: String(p['message'] ?? 'unknown server error') };
    default:
      return { kind: 'unknown', type };
  }
}

/**
 * HTTP status codes on the upgrade request that mean "don't retry". A bad key is
 * HTTP 401 with {"detail":{"error_code":"INVALID_API_KEY",..}} (confirmed live). An
 * error message about auth before `connected` is also treated as fatal.
 */
export const GNANI_FATAL_HTTP_STATUSES = new Set([400, 401, 403]);

export function isFatalGnaniError(message: string): boolean {
  return /auth|api[\s_-]?key|unauthori[sz]ed|forbidden|invalid key/i.test(message);
}

/**
 * A setting the server refuses (unsupported or malformed language) is an `error`
 * message, then close 1008. Retrying with the same settings can't succeed.
 */
export const GNANI_POLICY_CLOSE_CODE = 1008;

/**
 * There is no end-of-audio message: closing the socket, waiting 8 s without audio, and
 * sending {"type":"end"} all lose an unfinished utterance (tested live). The server only
 * finalizes it after hearing trailing silence (~1.5 s was enough), so GnaniStream.close()
 * sends silence first. The server also ends a stream after 60 s without speech (error
 * with timeout_reason "idle", close 1001), pings or not; that is reconnected.
 */
export const GNANI_NORMAL_CLOSE_CODE = 1000;
