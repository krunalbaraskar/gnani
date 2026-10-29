/** Types and channel names shared by main, preload and renderer. No runtime deps. */
import type { CalendarView } from './calendar.ts';
import type {
  ActionItemView,
  ConnectResult,
  DetectedMeeting,
  IntegrationsView,
  NewMeetingResult,
  TodoItem,
} from './integrations.ts';
import type { MeetingSummary, MinutesProgressView } from './meeting.ts';
import type { Settings } from './settings.ts';
import type { Speaker, TranscriptSegment } from './transcript/types.ts';

export const IPC = {
  getState: 'echo:get-state',
  updateSettings: 'echo:update-settings',
  startSession: 'echo:start-session',
  stopSession: 'echo:stop-session',
  requestSuggestion: 'echo:request-suggestion',
  chooseExportDir: 'echo:choose-export-dir',
  openExportDir: 'echo:open-export-dir',
  readDemoAudio: 'echo:read-demo-audio',
  chooseContextDir: 'echo:choose-context-dir',
  reloadContext: 'echo:reload-context',
  ask: 'echo:ask',
  askScreen: 'echo:ask-screen',
  requestMeaning: 'echo:request-meaning',
  catchUp: 'echo:catch-up',
  askMeetings: 'echo:ask-meetings',
  guessSpeakers: 'echo:guess-speakers',
  chooseCalendarFile: 'echo:choose-calendar-file',
  refreshCalendar: 'echo:refresh-calendar',
  openJoinLink: 'echo:open-join-link',
  setPaused: 'echo:set-paused',
  openLibrary: 'echo:open-library',
  openApp: 'echo:open-app',
  requestStart: 'echo:request-start',
  showOverlayPanel: 'echo:show-overlay-panel',
  connectAccount: 'echo:connect-account',
  disconnectAccount: 'echo:disconnect-account',
  createMeeting: 'echo:create-meeting',
  listActionItems: 'echo:list-action-items',
  toggleActionItem: 'echo:toggle-action-item',
  listTodos: 'echo:list-todos',
  addTodo: 'echo:add-todo',
  setTodoDone: 'echo:set-todo-done',
  deleteTodo: 'echo:delete-todo',
  listMeetings: 'echo:list-meetings',
  getMeeting: 'echo:get-meeting',
  updateMeeting: 'echo:update-meeting',
  deleteMeeting: 'echo:delete-meeting',
  writeMinutes: 'echo:write-minutes',
  cancelMinutes: 'echo:cancel-minutes',
  exportMeeting: 'echo:export-meeting',
  copyMinutes: 'echo:copy-minutes',
  emailMinutes: 'echo:email-minutes',
  window: 'echo:window',
  audioPort: 'echo:audio-port',
  event: 'echo:event',
} as const;

/** Message the preload posts to the page to hand over a frame port. */
export const AUDIO_PORT_MESSAGE = 'echo:audio-port';

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
 * demo = protection deliberately off so the overlay can be recorded (ECHO_RECORDABLE=1).
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
  /** When the running call started (epoch ms), for timers in any window; null when idle. */
  sessionStartedAt: number | null;
  /** Where demo WAVs are looked for (see npm run demo-audio). */
  demoAudioDir: string;
  context: ContextView;
  /** Past meetings whose minutes or notes answers can use (when useMeetings is on). */
  memoryMeetings: number;
  calendar: CalendarView;
  shareProtection: ShareProtection;
  integrations: IntegrationsView;
  /** A call another app is in right now (see settings.autoDetect), or null. */
  detected: DetectedMeeting | null;
}

/** Tabs of the overlay's panel. */
export type OverlayPanel = 'live' | 'transcript' | 'context' | 'settings';

/** Sections of the main window. */
export type AppSection = 'home' | 'todo' | 'meetings' | 'ask' | 'settings';

export interface SuggestionView {
  id: string;
  trigger: 'hotkey' | 'auto' | 'typed' | 'screen' | 'catchup';
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
  verdict?: 'files' | 'call' | 'reply' | 'missing' | 'unverified' | 'screen' | 'recap';
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

export type EchoEvent =
  | { type: 'segment'; segment: TranscriptSegment }
  | { type: 'segment-removed'; id: string; reason: 'echo' }
  | { type: 'segment-meaning'; id: string; meaning: string }
  | { type: 'mention'; mention: MentionView }
  | { type: 'context'; context: ContextView }
  | { type: 'partial'; speaker: Speaker; text: string }
  | { type: 'processing'; speaker: Speaker }
  | { type: 'stt-status'; status: SttStatusView }
  | { type: 'suggestion-start'; suggestion: SuggestionView }
  | { type: 'suggestion-token'; id: string; text: string }
  | { type: 'suggestion-done'; suggestion: SuggestionView }
  | { type: 'click-through'; enabled: boolean }
  | { type: 'session'; running: boolean; startedAt?: number }
  | { type: 'paused'; paused: boolean }
  | { type: 'notice'; level: 'info' | 'error'; message: string }
  // Library window only.
  | { type: 'meeting-updated'; summary: MeetingSummary }
  | { type: 'meeting-deleted'; id: string }
  | { type: 'minutes-progress'; id: string; progress: MinutesProgressView }
  | { type: 'open-meeting'; id: string }
  | { type: 'ask-progress'; askId: number; text: string }
  | { type: 'memory-updated'; meetings: number }
  | { type: 'calendar'; calendar: CalendarView }
  | { type: 'integrations'; integrations: IntegrationsView }
  | { type: 'detected'; meeting: DetectedMeeting | null }
  /** The main window should show this section (and meeting, for "meetings"). */
  | { type: 'navigate'; section: AppSection; meetingId?: string }
  /** Overlay only: start a call (audio is captured there), for a calendar event if given. */
  | { type: 'start-request'; eventKey?: string }
  /** Overlay only: open the panel at this tab (e.g. Settings → Audio from the main window). */
  | { type: 'overlay-panel'; panel: OverlayPanel };

export type { ActionItemView, ConnectResult, NewMeetingResult, TodoItem };

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

/** They said the user's name or a watch word (see core/session/mentions.ts). */
export interface MentionView {
  segmentId: string;
  text: string;
  terms: string[];
  /** It sounded like a question. */
  asked: boolean;
  at: number;
}
