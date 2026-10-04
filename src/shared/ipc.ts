/** Types and channel names shared by main, preload and renderer. No runtime deps. */
import type { Settings } from './settings.ts';
import type { Speaker, TranscriptSegment } from './transcript/types.ts';

export const IPC = {
  getState: 'bolo:get-state',
  updateSettings: 'bolo:update-settings',
  startSession: 'bolo:start-session',
  stopSession: 'bolo:stop-session',
  requestSuggestion: 'bolo:request-suggestion',
  chooseExportDir: 'bolo:choose-export-dir',
  openExportDir: 'bolo:open-export-dir',
  readDemoAudio: 'bolo:read-demo-audio',
  window: 'bolo:window',
  audioPort: 'bolo:audio-port',
  event: 'bolo:event',
} as const;

/** Message the preload posts to the page to hand over a frame port. */
export const AUDIO_PORT_MESSAGE = 'bolo:audio-port';

export interface LanguageOption {
  code: string;
  label: string;
  experimental?: boolean;
  supportsItn?: boolean;
}

export interface AppState {
  settings: Settings;
  languages: LanguageOption[];
  /** Whether keys were found — the keys themselves never leave the main process. */
  keys: { gnani: boolean; llm: boolean };
  /** Effective LLM endpoint and model after applying env defaults. */
  llm: { baseUrl: string; model: string };
  sttUrl: string;
  platform: string;
  clickThrough: boolean;
  sessionRunning: boolean;
  /** Where demo WAVs are looked for (see npm run demo-audio). */
  demoAudioDir: string;
}

export interface SuggestionView {
  id: string;
  trigger: 'hotkey' | 'auto';
  question?: string;
  text: string;
  startedAt: number;
  finishedAt?: number;
  firstTokenMs?: number;
  error?: string;
  cancelled?: boolean;
}

export interface SttStatusView {
  speaker: Speaker;
  state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';
  attempt?: number;
  retryInMs?: number;
  error?: string;
  droppedFrames?: number;
}

export type BoloEvent =
  | { type: 'segment'; segment: TranscriptSegment }
  | { type: 'segment-removed'; id: string; reason: 'echo' }
  | { type: 'partial'; speaker: Speaker; text: string }
  | { type: 'processing'; speaker: Speaker }
  | { type: 'stt-status'; status: SttStatusView }
  | { type: 'suggestion-start'; suggestion: SuggestionView }
  | { type: 'suggestion-token'; id: string; text: string }
  | { type: 'suggestion-done'; suggestion: SuggestionView }
  | { type: 'click-through'; enabled: boolean }
  | { type: 'session'; running: boolean }
  | { type: 'notice'; level: 'info' | 'error'; message: string };

export type StartResult = { ok: true } | { ok: false; error: string };

export interface StopResult {
  exported?: { markdown: string; json: string };
  error?: string;
}

export type WindowCommand =
  | { kind: 'hide' }
  | { kind: 'toggle-click-through' }
  | { kind: 'resize'; width: number; height: number }
  | { kind: 'quit' };

export interface DemoAudio {
  me: ArrayBuffer | null;
  them: ArrayBuffer | null;
}
