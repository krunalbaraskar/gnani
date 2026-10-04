import { describe, expect, it } from 'vitest';
import { backoffDelay } from '../src/core/stt/backoff.ts';
import {
  buildGnaniHeaders,
  GNANI_LANGUAGES,
  isFatalGnaniError,
  makeRequestId,
  parseGnaniMessage,
  redactHeaders,
} from '../src/core/stt/gnani-protocol.ts';

describe('buildGnaniHeaders', () => {
  it('matches the SDK header names', () => {
    expect(buildGnaniHeaders({ apiKey: 'k', language: 'hi-IN', requestId: 'req_1' })).toEqual({
      'x-api-key-id': 'k',
      lang_code: 'hi-IN',
      'x-sample-rate': '16000',
      'x-api-request-id': 'req_1',
    });
  });
  it('adds x-format only for number formatting', () => {
    expect(
      buildGnaniHeaders({ apiKey: 'k', language: 'en-IN', requestId: 'r', formatNumbers: true })[
        'x-format'
      ],
    ).toBe('transcribe');
  });
  it('redacts the key for logging', () => {
    expect(
      redactHeaders(buildGnaniHeaders({ apiKey: 'secret', language: 'hi-IN', requestId: 'r' }))[
        'x-api-key-id'
      ],
    ).toBe('***');
  });
});

describe('makeRequestId', () => {
  it('uses the SDK format', () => {
    expect(makeRequestId()).toMatch(/^req_[0-9a-f]{12}$/);
  });
});

describe('parseGnaniMessage', () => {
  it('parses connected with config', () => {
    expect(
      parseGnaniMessage(
        '{"type":"connected","message":"ok","config":{"sample_rate":16000,"chunk_size":512}}',
      ),
    ).toEqual({ kind: 'connected', message: 'ok', sampleRate: 16000, chunkSize: 512 });
  });

  it('parses a final transcript with string segment_index', () => {
    expect(
      parseGnaniMessage(
        JSON.stringify({
          type: 'transcript',
          text: 'premium kitna hoga',
          audio_duration_ms: 1200,
          segment_id: 'abc',
          segment_index: '3',
          latency: 180,
          timestamp: '2026-01-01T00:00:00Z',
        }),
      ),
    ).toEqual({
      kind: 'transcript',
      text: 'premium kitna hoga',
      final: true,
      segmentId: 'abc',
      segmentIndex: 3,
      audioDurationMs: 1200,
      latencyMs: 180,
      timestamp: '2026-01-01T00:00:00Z',
    });
  });

  it('treats partial/interim messages and is_final:false as non-final', () => {
    expect(parseGnaniMessage('{"type":"partial","text":"prem"}')).toMatchObject({ final: false });
    expect(parseGnaniMessage('{"type":"transcript","text":"x","is_final":false}')).toMatchObject({
      final: false,
    });
  });

  it('parses processing, VAD, error and unknown messages', () => {
    expect(parseGnaniMessage('{"type":"processing"}')).toEqual({ kind: 'processing' });
    expect(parseGnaniMessage('{"type":"speech_end"}')).toEqual({
      kind: 'vad',
      event: 'speech_end',
    });
    expect(parseGnaniMessage('{"type":"error","message":"bad"}')).toEqual({
      kind: 'error',
      message: 'bad',
    });
    expect(parseGnaniMessage('{"type":"new_thing"}')).toEqual({
      kind: 'unknown',
      type: 'new_thing',
    });
    expect(parseGnaniMessage('not json')).toEqual({ kind: 'unknown', type: 'invalid-json' });
    expect(parseGnaniMessage('42')).toEqual({ kind: 'unknown', type: 'non-object' });
  });
});

describe('isFatalGnaniError', () => {
  it('recognises auth failures only', () => {
    expect(isFatalGnaniError('Invalid API key')).toBe(true);
    expect(isFatalGnaniError('Unauthorized')).toBe(true);
    expect(isFatalGnaniError('bad frame size 1000')).toBe(false);
  });
});

describe('GNANI_LANGUAGES', () => {
  it('lists the ten SDK streaming languages plus experimental options', () => {
    expect(GNANI_LANGUAGES.filter((l) => !l.experimental)).toHaveLength(10);
    expect(GNANI_LANGUAGES[0]!.code).toBe('hi-IN');
  });
});

describe('backoffDelay', () => {
  it('doubles from the base and caps at the max', () => {
    const noJitter = { jitter: 0 };
    expect([1, 2, 3, 4, 10].map((a) => backoffDelay(a, noJitter))).toEqual([
      500, 1000, 2000, 4000, 15_000,
    ]);
  });
  it('stays within the jitter band', () => {
    expect(backoffDelay(3, {}, () => 0)).toBe(1600);
    expect(backoffDelay(3, {}, () => 1)).toBe(2400);
  });
});
