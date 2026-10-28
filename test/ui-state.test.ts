import { describe, expect, it } from 'vitest';
import {
  initialUiState,
  levelFromDb,
  MAX_UI_SEGMENTS,
  uiReducer,
  type UiState,
} from '../src/renderer/src/state.ts';
import type { AppState } from '../src/shared/ipc.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';

const app: AppState = {
  settings: DEFAULT_SETTINGS,
  languages: [],
  keys: { stt: true, llm: false },
  stt: { name: 'Gnani', keyVar: 'GNANI_API_KEY', url: 'wss://x' },
  llm: { baseUrl: 'http://x', model: 'm' },
  platform: 'win32',
  clickThrough: false,
  sessionRunning: false,
  sessionPaused: false,
  memoryMeetings: 0,
  calendar: { configured: false, events: [] },
  demoAudioDir: '/tmp/demo',
  context: { dir: '', files: [], skipped: [] },
  shareProtection: 'unverified',
};

const seg = (id: string, speaker: 'me' | 'them', at: number) => ({ id, speaker, text: id, at });

describe('uiReducer', () => {
  it('opens settings on first run (consent not yet given)', () => {
    expect(uiReducer(initialUiState, { type: 'init', app }).panel).toBe('settings');
    const ok = { ...app, settings: { ...DEFAULT_SETTINGS, consentAcknowledged: true } };
    expect(uiReducer(initialUiState, { type: 'init', app: ok }).panel).toBe('live');
  });

  it('adds segments in time order, clears partials, records latency', () => {
    let s: UiState = uiReducer(initialUiState, {
      type: 'event',
      event: { type: 'partial', speaker: 'them', text: 'prem' },
    });
    s = uiReducer(s, {
      type: 'event',
      event: { type: 'segment', segment: { ...seg('b', 'them', 2), endToEndLatencyMs: 420 } },
    });
    s = uiReducer(s, { type: 'event', event: { type: 'segment', segment: seg('a', 'me', 1) } });
    expect(s.segments.map((x) => x.id)).toEqual(['a', 'b']);
    expect(s.partial.them).toBe('');
    expect(s.latency.them.e2e).toBe(420);
  });

  it('removes echo segments and counts them', () => {
    let s = uiReducer(initialUiState, {
      type: 'event',
      event: { type: 'segment', segment: seg('me:1', 'me', 1) },
    });
    s = uiReducer(s, {
      type: 'event',
      event: { type: 'segment-removed', id: 'me:1', reason: 'echo' },
    });
    expect(s.segments).toEqual([]);
    expect(s.echoesRemoved).toBe(1);
  });

  it('caps the number of segments kept in the UI', () => {
    let s = initialUiState;
    for (let i = 0; i < MAX_UI_SEGMENTS + 5; i++) {
      s = uiReducer(s, {
        type: 'event',
        event: { type: 'segment', segment: seg(`s${i}`, 'them', i) },
      });
    }
    expect(s.segments).toHaveLength(MAX_UI_SEGMENTS);
    expect(s.segments[0]!.id).toBe('s5');
  });

  it('streams suggestion tokens only into the current suggestion', () => {
    const start = { id: 'sug-1', trigger: 'hotkey' as const, text: '', startedAt: 0 };
    let s = uiReducer(initialUiState, {
      type: 'event',
      event: { type: 'suggestion-start', suggestion: start },
    });
    s = uiReducer(s, {
      type: 'event',
      event: { type: 'suggestion-token', id: 'sug-1', text: 'Ji' },
    });
    s = uiReducer(s, {
      type: 'event',
      event: { type: 'suggestion-token', id: 'old', text: 'stale' },
    });
    expect(s.suggestion?.text).toBe('Ji');
    s = uiReducer(s, {
      type: 'event',
      event: { type: 'suggestion-done', suggestion: { ...start, text: 'Ji haan.' } },
    });
    expect(s.suggestion?.text).toBe('Ji haan.');
  });

  it('keeps a status error until the state changes', () => {
    let s = uiReducer(initialUiState, {
      type: 'event',
      event: {
        type: 'stt-status',
        status: { speaker: 'me', state: 'connected', error: 'bad frame' },
      },
    });
    s = uiReducer(s, {
      type: 'event',
      event: { type: 'stt-status', status: { speaker: 'me', state: 'connected' } },
    });
    expect(s.stt.me.error).toBe('bad frame');
    s = uiReducer(s, {
      type: 'event',
      event: { type: 'stt-status', status: { speaker: 'me', state: 'reconnecting' } },
    });
    expect(s.stt.me.error).toBeUndefined();
  });

  it('resets on session end and on start', () => {
    let s = uiReducer(
      { ...initialUiState, running: true, starting: true },
      { type: 'event', event: { type: 'session', running: false } },
    );
    expect(s.running).toBe(false);
    expect(s.stt.me.state).toBe('idle');
    s = uiReducer({ ...s, segments: [seg('x', 'me', 1)] }, { type: 'starting' });
    expect(s.segments).toEqual([]);
    expect(uiReducer(s, { type: 'start-failed', error: 'no key' }).notice?.message).toBe('no key');
  });
});

describe('levelFromDb', () => {
  it('maps -60..0 dB to 0..1', () => {
    expect(levelFromDb(-Infinity)).toBe(0);
    expect(levelFromDb(-60)).toBe(0);
    expect(levelFromDb(-30)).toBe(0.5);
    expect(levelFromDb(3)).toBe(1);
  });
});

describe('pending line', () => {
  it('an empty partial clears the processing placeholder', () => {
    let s = uiReducer(initialUiState, {
      type: 'event',
      event: { type: 'processing', speaker: 'me' },
    });
    expect(s.processing.me).toBe(true);
    s = uiReducer(s, { type: 'event', event: { type: 'partial', speaker: 'me', text: '' } });
    expect(s.processing.me).toBe(false);
  });
});
