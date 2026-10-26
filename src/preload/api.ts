import type {
  AppState,
  BoloEvent,
  ContextView,
  DemoAudio,
  ExportFormat,
  ExportResult,
  StartResult,
  StopResult,
  WindowCommand,
} from '../shared/ipc.ts';
import type { MeetingDetail, MeetingPatch, MeetingSummary } from '../shared/meeting.ts';
import type { Settings } from '../shared/settings.ts';
import type { Speaker } from '../shared/transcript/types.ts';

/** The whole surface the renderer can reach, exposed as window.bolo. */
export interface BoloApi {
  getState(): Promise<AppState>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  startSession(): Promise<StartResult>;
  stopSession(): Promise<StopResult>;
  requestSuggestion(): void;
  chooseExportDir(): Promise<string | null>;
  openExportDir(): void;
  readDemoAudio(): Promise<DemoAudio>;
  /** Opens the native folder dialog; the renderer never supplies a path. */
  chooseContextDir(): Promise<ContextView>;
  reloadContext(): Promise<ContextView>;
  /** A typed question; `withScreen` attaches a screenshot taken by the main process. */
  ask(text: string, withScreen: boolean): void;
  askScreen(): void;
  requestMeaning(segmentId: string): void;
  /** Off the record: stop sending audio to speech-to-text until resumed. */
  setPaused(paused: boolean): void;
  /** Opens (or focuses) the meeting library, optionally at one meeting. */
  openLibrary(meetingId?: string): void;
  listMeetings(query: string): Promise<MeetingSummary[]>;
  getMeeting(id: string): Promise<MeetingDetail | null>;
  updateMeeting(id: string, patch: MeetingPatch): Promise<MeetingDetail | null>;
  /** Asks the user to confirm in a native dialog first. */
  deleteMeeting(id: string): Promise<boolean>;
  writeMinutes(id: string): void;
  cancelMinutes(id: string): void;
  /** Save dialog in the main process; the renderer never supplies a path. */
  exportMeeting(id: string, format: ExportFormat): Promise<ExportResult>;
  /** Copies the minutes as plain text, ready for an email or chat. */
  copyMinutes(id: string): Promise<boolean>;
  /** Copies the minutes and opens a new email in the default mail app. */
  emailMinutes(id: string): void;
  window(cmd: WindowCommand): void;
  /**
   * Opens a MessagePort to the main process for one speaker's audio frames. The page
   * receives the other end as a window "message" event (see AUDIO_PORT_MESSAGE).
   */
  openAudioPort(speaker: Speaker): void;
  onEvent(listener: (e: BoloEvent) => void): () => void;
}
