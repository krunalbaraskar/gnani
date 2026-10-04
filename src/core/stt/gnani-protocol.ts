/**
 * Gnani realtime STT wire protocol — the ONE place that encodes what we believe about
 * Gnani's API. Everything else in Bolo talks to the generic SttProvider interface.
 *
 * Source of truth used: the official `gnani-vachana` Python SDK v0.7.9 on PyPI
 * (gnani/stt/client.py, GnaniSTTStreamClient) and its README. docs.gnani.ai could not
 * be reached from the build environment, so every detail below that the SDK doesn't
 * pin down, or that may have changed, is marked TODO(verify-gnani). Check them
 * against https://docs.gnani.ai/api/STT/stt-websocket before relying on them.
 */

/**
 * Streaming endpoint, from the SDK: DEFAULT_BASE_URL + STT_STREAM_ENDPOINT.
 * TODO(verify-gnani): the SDK uses wss://api.vachana.ai/stt/v3/stream. Some Gnani
 * material mentions wss://api.gnani.ai/prisma/v3/stream; the SDK never uses it.
 * Override with GNANI_STT_URL if your account uses a different host.
 */
export const GNANI_DEFAULT_STT_URL = 'wss://api.vachana.ai/stt/v3/stream';

/** From the SDK: 512 PCM16 samples per frame = 1024 bytes = 32 ms at 16 kHz. */
export const GNANI_FRAME_BYTES = 1024;
export const GNANI_SAMPLE_RATE = 16_000;

/** Wait this long for the server's `connected` message after the socket opens. */
export const GNANI_CONNECT_TIMEOUT_MS = 10_000;

/**
 * Value of the `lang_code` header that asks the server to auto-detect among several
 * languages. TODO(verify-gnani): SDK v0.3–0.7.5 sent a comma-separated list of codes
 * as `lang_code` (GnaniSTTStreamClient.AUTO_DETECT); v0.7.8+ removed that option and
 * only accepts single codes. It may no longer work.
 */
export const GNANI_AUTO_DETECT = 'bn-IN,en-IN,gu-IN,hi-IN,kn-IN,ml-IN,mr-IN,pa-IN,ta-IN,te-IN';

export interface GnaniLanguage {
  code: string;
  label: string;
  /** Present when the option rests on an unverified assumption. */
  experimental?: boolean;
  /** Supports `x-format: transcribe` (numbers/currency as digits). SDK: hi-IN, en-IN only. */
  supportsItn?: boolean;
}

/** From SDK v0.7.9 STREAM_SUPPORTED_LANGUAGES, plus the two experimental options. */
export const GNANI_LANGUAGES: readonly GnaniLanguage[] = [
  { code: 'hi-IN', label: 'Hindi (handles Hinglish)', supportsItn: true },
  { code: 'en-IN', label: 'English (India)', supportsItn: true },
  { code: 'ta-IN', label: 'Tamil' },
  { code: 'te-IN', label: 'Telugu' },
  { code: 'kn-IN', label: 'Kannada' },
  { code: 'ml-IN', label: 'Malayalam' },
  { code: 'mr-IN', label: 'Marathi' },
  { code: 'bn-IN', label: 'Bengali' },
  { code: 'gu-IN', label: 'Gujarati' },
  { code: 'pa-IN', label: 'Punjabi' },
  // TODO(verify-gnani): "Hinglish (Code-mixed, experimental)" was in the SDK's
  // streaming language list up to v0.7.5 and removed in v0.7.8. Test whether the
  // server still accepts it and whether it beats hi-IN on Hinglish audio.
  { code: 'en-hi-in-cm', label: 'Hinglish code-mixed (experimental)', experimental: true },
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
 * Handshake = HTTP upgrade headers only; the SDK sends no JSON config message after
 * connecting. Header names copied verbatim from GnaniSTTStreamClient.connect().
 * TODO(verify-gnani): confirm no initial config/start message is required, and
 * whether header names are case-sensitive (SDK REST uses X-API-Key-ID, WS uses
 * lowercase x-api-key-id; HTTP headers are case-insensitive so this should be fine).
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
 * Parses one text frame from the server. Message shapes per the SDK's
 * _parse_stream_message():
 *   {"type":"connected","message":..,"timestamp":..,"config":{"sample_rate","chunk_size"}}
 *   {"type":"processing","timestamp":..}            VAD saw end of speech
 *   {"type":"transcript","text","audio_duration_ms","segment_id","segment_index",
 *    "latency","timestamp"}                          final text for one segment
 *   {"type":"error","message","timestamp"}
 *   {"type":"speech_start"|"speech_end"|"vad_start"|"vad_end"}
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
    // TODO(verify-gnani): the SDK only knows final "transcript" messages — no
    // partial/interim results. We also accept "partial"/"interim" types and an
    // `is_final: false` flag in case the server offers them; check the docs.
    case 'transcript':
    case 'partial':
    case 'interim':
      return {
        kind: 'transcript',
        text: String(p['text'] ?? ''),
        final: type === 'transcript' && p['is_final'] !== false,
        segmentId: String(p['segment_id'] ?? ''),
        // SDK types segment_index as str; accept either.
        segmentIndex: num(p['segment_index']),
        audioDurationMs: num(p['audio_duration_ms']),
        // TODO(verify-gnani): SDK documents `latency` as server-side processing ms.
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
 * HTTP status codes on the upgrade request that mean "don't retry".
 * TODO(verify-gnani): the SDK doesn't say how a bad key is reported — HTTP 401/403 on
 * the upgrade, or an `error` message followed by a close. We treat both 401/403 and
 * an error message containing "auth"/"key"/"unauthor" before `connected` as fatal.
 */
export const GNANI_FATAL_HTTP_STATUSES = new Set([400, 401, 403]);

export function isFatalGnaniError(message: string): boolean {
  return /auth|api[\s_-]?key|unauthori[sz]ed|forbidden|invalid key/i.test(message);
}

/**
 * TODO(verify-gnani): the SDK ends a stream by simply closing the socket — there is
 * no "end of audio" message. Close code 1000 is what the Python websockets library
 * sends. If the docs define a flush/end message, send it in GnaniStream.close().
 */
export const GNANI_NORMAL_CLOSE_CODE = 1000;
