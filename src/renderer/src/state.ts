/** Overlay UI state. A pure reducer, so it is unit-tested in Node. */
import type { AppState, BoloEvent, SttStatusView, SuggestionView } from '../../shared/ipc.ts';
import type { Settings } from '../../shared/settings.ts';
import type { Speaker, TranscriptSegment } from '../../shared/transcript/types.ts';

export const MAX_UI_SEGMENTS = 400;

export interface Notice {
  id: number;
  level: 'info' | 'error';
  message: string;
}

export interface UiState {
  app: AppState | null;
  running: boolean;
  starting: boolean;
  capturing: boolean;
  segments: TranscriptSegment[];
  partial: Record<Speaker, string>;
  processing: Record<Speaker, boolean>;
  stt: Record<Speaker, SttStatusView>;
  latency: Record<Speaker, { server?: number; e2e?: number }>;
  levels: Record<Speaker, number>;
  suggestion: SuggestionView | null;
  clickThrough: boolean;
  echoesRemoved: number;
  notice: Notice | null;
  panel: 'live' | 'settings';
}

export type UiAction =
  | { type: 'init'; app: AppState }
  | { type: 'event'; event: BoloEvent }
  | { type: 'settings'; settings: Settings }
  | { type: 'starting' }
  | { type: 'start-failed'; error: string }
  | { type: 'capturing'; capturing: boolean }
  | { type: 'level'; speaker: Speaker; level: number }
  | { type: 'notice'; level: 'info' | 'error'; message: string }
  | { type: 'dismiss-notice' }
  | { type: 'panel'; panel: 'live' | 'settings' }
  | { type: 'clear-transcript' };

const idle = (speaker: Speaker): SttStatusView => ({ speaker, state: 'idle' });

export const initialUiState: UiState = {
  app: null,
  running: false,
  starting: false,
  capturing: false,
  segments: [],
  partial: { me: '', them: '' },
  processing: { me: false, them: false },
  stt: { me: idle('me'), them: idle('them') },
  latency: { me: {}, them: {} },
  levels: { me: 0, them: 0 },
  suggestion: null,
  clickThrough: false,
  echoesRemoved: 0,
  notice: null,
  panel: 'live',
};

let noticeId = 0;

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'init':
      return {
        ...state,
        app: action.app,
        running: action.app.sessionRunning,
        clickThrough: action.app.clickThrough,
        // First run: show settings so the consent notice and keys are seen.
        panel: action.app.settings.consentAcknowledged ? state.panel : 'settings',
      };
    case 'settings':
      return state.app ? { ...state, app: { ...state.app, settings: action.settings } } : state;
    case 'starting':
      return {
        ...state,
        starting: true,
        segments: [],
        suggestion: null,
        echoesRemoved: 0,
        partial: { me: '', them: '' },
        latency: { me: {}, them: {} },
      };
    case 'start-failed':
      return {
        ...state,
        starting: false,
        notice: { id: ++noticeId, level: 'error', message: action.error },
      };
    case 'capturing':
      return {
        ...state,
        capturing: action.capturing,
        levels: action.capturing ? state.levels : { me: 0, them: 0 },
      };
    case 'level':
      return { ...state, levels: { ...state.levels, [action.speaker]: action.level } };
    case 'notice':
      return { ...state, notice: { id: ++noticeId, level: action.level, message: action.message } };
    case 'dismiss-notice':
      return { ...state, notice: null };
    case 'panel':
      return { ...state, panel: action.panel };
    case 'clear-transcript':
      return { ...state, segments: [], suggestion: null };
    case 'event':
      return applyEvent(state, action.event);
  }
}

function applyEvent(state: UiState, e: BoloEvent): UiState {
  switch (e.type) {
    case 'segment': {
      const s = e.segment;
      const segments = [...state.segments, s].sort((a, b) => a.at - b.at).slice(-MAX_UI_SEGMENTS);
      const latency = {
        ...state.latency,
        [s.speaker]: { server: s.serverLatencyMs, e2e: s.endToEndLatencyMs },
      };
      return {
        ...state,
        segments,
        latency,
        partial: { ...state.partial, [s.speaker]: '' },
        processing: { ...state.processing, [s.speaker]: false },
      };
    }
    case 'segment-removed':
      return {
        ...state,
        segments: state.segments.filter((s) => s.id !== e.id),
        echoesRemoved: state.echoesRemoved + 1,
      };
    case 'partial':
      return {
        ...state,
        partial: { ...state.partial, [e.speaker]: e.text },
        // An empty partial means "nothing pending" (e.g. an echo was dropped).
        processing: e.text ? state.processing : { ...state.processing, [e.speaker]: false },
      };
    case 'processing':
      return { ...state, processing: { ...state.processing, [e.speaker]: true } };
    case 'stt-status': {
      // Keep the last error visible until the state changes.
      const prev = state.stt[e.status.speaker];
      const status = {
        ...e.status,
        error: e.status.error ?? (prev.state === e.status.state ? prev.error : undefined),
      };
      return { ...state, stt: { ...state.stt, [e.status.speaker]: status } };
    }
    case 'suggestion-start':
      return { ...state, suggestion: e.suggestion };
    case 'suggestion-token':
      return state.suggestion?.id === e.id
        ? { ...state, suggestion: { ...state.suggestion, text: e.text } }
        : state;
    case 'suggestion-done':
      return state.suggestion?.id === e.suggestion.id || !state.suggestion
        ? { ...state, suggestion: e.suggestion }
        : state;
    case 'click-through':
      return { ...state, clickThrough: e.enabled };
    case 'session':
      return {
        ...state,
        running: e.running,
        starting: false,
        processing: { me: false, them: false },
        stt: e.running ? state.stt : { me: idle('me'), them: idle('them') },
        app: state.app ? { ...state.app, sessionRunning: e.running } : state.app,
      };
    case 'notice':
      return { ...state, notice: { id: ++noticeId, level: e.level, message: e.message } };
  }
}

/** dBFS → 0..1 for a level meter (-60 dB and below = 0). */
export function levelFromDb(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db + 60) / 60));
}
