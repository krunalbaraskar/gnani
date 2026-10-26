/** Types and channel names shared by main, preload and renderer. No runtime deps. */
import type { MeetingSummary, MinutesProgressView } from './meeting.ts';
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
  chooseContextDir: 'bolo:choose-context-dir',
  reloadContext: 'bolo:reload-context',
  ask: 'bolo:ask',
  askScreen: 'bolo:ask-screen',
  requestMeaning: 'bolo:request-meaning',
  setPaused: 'bolo:set-paused',
  openLibrary: 'bolo:open-library',
  listMeetings: 'bolo:list-meetings',
  getMeeting: 'bolo:get-meeting',
  updateMeeting: 'bolo:update-meeting',
  deleteMeeting: 'bolo:delete-meeting',
  writeMinutes: 'bolo:write-minutes',
  cancelMinutes: 'bolo:cancel-minutes',
  exportMeeting: 'bolo:export-meeting',
  copyMinutes: 'bolo:copy-minutes',
  emailMinutes: 'bolo:email-minutes',
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

/** The context folder as the overlay shows it. File contents never reach the renderer. */
export interface ContextView {
  dir: string;
  files: { name: string; info: string }[];
  skipped: { name: string; reason: string }[];
  /** Set when the folder itself could not be read. */
  error?: string;
}

/**
 * Whether other people can see the overlay when the screen is shared:
 * hidden = checked by hand on this platform and OS build · unverified = may be visible ·
 * demo = protection deliberately off so the overlay can be recorded (BOLO_RECORDABLE=1).
 */
export type ShareProtection = 'hidden' | 'unverified' | 'demo';

export interface AppState {
  settings: Settings;
  languages: LanguageOption[];
  /** Whether keys were found — the keys themselves never leave the main process. */
  keys: { stt: boolean; llm: boolean };
  /** The speech-to-text service in use: Gnani, or a Whisper endpoint for testing. */
  stt: { name: string; keyVar: string; url: string };
  /** Effective LLM endpoint and model after applying env defaults. */
  llm: { baseUrl: string; model: string };
  platform: string;
  clickThrough: boolean;
  sessionRunning: boolean;
  sessionPaused: boolean;
  /** Where demo WAVs are looked for (see npm run demo-audio). */
  demoAudioDir: string;
  context: ContextView;
  shareProtection: ShareProtection;
}

export interface SuggestionView {
  id: string;
  trigger: 'hotkey' | 'auto' | 'typed' | 'screen';
  question?: string;
  /** The question the user typed, if any. */
  asked?: string;
  text: string;
  startedAt: number;
  finishedAt?: number;
  firstTokenMs?: number;
  error?: string;
  cancelled?: boolean;
  /** Set when the answer has finished: how far it can be trusted. */
  verdict?: 'files' | 'call' | 'reply' | 'missing' | 'unverified' | 'screen';
  sources?: string[];
  usedScreen?: boolean;
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
  | { type: 'segment-meaning'; id: string; meaning: string }
  | { type: 'context'; context: ContextView }
  | { type: 'partial'; speaker: Speaker; text: string }
  | { type: 'processing'; speaker: Speaker }
  | { type: 'stt-status'; status: SttStatusView }
  | { type: 'suggestion-start'; suggestion: SuggestionView }
  | { type: 'suggestion-token'; id: string; text: string }
  | { type: 'suggestion-done'; suggestion: SuggestionView }
  | { type: 'click-through'; enabled: boolean }
  | { type: 'session'; running: boolean }
  | { type: 'paused'; paused: boolean }
  | { type: 'notice'; level: 'info' | 'error'; message: string }
  // Library window only.
  | { type: 'meeting-updated'; summary: MeetingSummary }
  | { type: 'meeting-deleted'; id: string }
  | { type: 'minutes-progress'; id: string; progress: MinutesProgressView }
  | { type: 'open-meeting'; id: string };

export type StartResult = { ok: true } | { ok: false; error: string };

export interface StopResult {
  /** The meeting as saved in the library. */
  meetingId?: string;
  /** Also written to the export folder, when one is set. */
  exported?: { markdown: string; json: string };
  /** Minutes are being written in the background. */
  writingMinutes?: boolean;
  error?: string;
}

export type ExportFormat = 'md' | 'pdf';

export type ExportResult = { path: string } | { error: string } | null;

export type WindowCommand =
  | { kind: 'hide' }
  | { kind: 'toggle-click-through' }
  | { kind: 'resize'; width: number; height: number }
  | { kind: 'quit' };

export interface DemoAudio {
  me: ArrayBuffer | null;
  them: ArrayBuffer | null;
}
