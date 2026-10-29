import type {
  AppState,
  EchoEvent,
  ContextView,
  DemoAudio,
  ExportFormat,
  ExportResult,
  ActionItemView,
  TodoItem,
  AppSection,
  OverlayPanel,
  ConnectResult,
  NewMeetingResult,
  StartResult,
  StopResult,
  WindowCommand,
} from '../shared/ipc.ts';
import type {
  MeetingAnswerView,
  MeetingDetail,
  MeetingPatch,
  MeetingSummary,
} from '../shared/meeting.ts';
import type { CalendarView } from '../shared/calendar.ts';
import type { Settings } from '../shared/settings.ts';
import type { Speaker } from '../shared/transcript/types.ts';

/** The whole surface the renderer can reach, exposed as window.echo. */
export interface EchoApi {
  getState(): Promise<AppState>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  /** `eventKey`: start the call for this calendar meeting (its title, people and agenda). */
  startSession(eventKey?: string): Promise<StartResult>;
  /** Opens the native file dialog for an .ics file; the renderer never supplies a path. */
  chooseCalendarFile(clear?: boolean): Promise<CalendarView>;
  refreshCalendar(): Promise<CalendarView>;
  /** Opens the meeting's Meet/Zoom/Teams link in the browser. */
  openJoinLink(eventKey: string): void;
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
  /** A recap of the last few minutes, shown in the answer card. */
  catchUp(): void;
  /** "Ask your meetings": progress arrives as ask-progress events with this askId. */
  askMeetings(question: string, askId: number): Promise<MeetingAnswerView | { error: string }>;
  /** Off the record: stop sending audio to speech-to-text until resumed. */
  setPaused(paused: boolean): void;
  /** Opens (or focuses) the main window at Meetings, optionally at one meeting. */
  openLibrary(meetingId?: string): void;
  /**
   * Starts a call from any window: the overlay captures the audio, so this asks it to
   * start (for a calendar event, if given) and brings it into view.
   */
  requestStart(eventKey?: string): void;
  /** Shows the overlay with its panel open at a tab, e.g. 'settings' for audio input. */
  showOverlayPanel(panel: OverlayPanel): void;
  /** Opens (or focuses) the main window at a section. */
  openApp(section?: AppSection): void;
  /**
   * Signs in to a calendar account in the system browser (OAuth with PKCE). Resolves when
   * the user finishes or gives up; tokens stay in the main process, encrypted.
   */
  connectAccount(provider: 'google' | 'microsoft'): Promise<ConnectResult>;
  disconnectAccount(accountId: string): Promise<void>;
  /**
   * Makes a new Google Meet (google) or Teams (microsoft) meeting on the connected account,
   * opens it in the browser, copies the link and starts listening.
   */
  createMeeting(provider: 'google' | 'microsoft'): Promise<NewMeetingResult>;
  /** Action items from all meetings' minutes, open ones first, newest meeting first. */
  listActionItems(): Promise<ActionItemView[]>;
  /** Ticks or unticks one action item in that meeting's minutes. */
  toggleActionItem(meetingId: string, index: number, done: boolean): Promise<boolean>;
  /** To-dos the user added by hand, open ones first. */
  listTodos(): Promise<TodoItem[]>;
  /** Null when the text is empty. */
  addTodo(text: string): Promise<TodoItem | null>;
  setTodoDone(id: string, done: boolean): Promise<boolean>;
  deleteTodo(id: string): Promise<boolean>;
  listMeetings(query: string): Promise<MeetingSummary[]>;
  getMeeting(id: string): Promise<MeetingDetail | null>;
  updateMeeting(id: string, patch: MeetingPatch): Promise<MeetingDetail | null>;
  /** Asks the user to confirm in a native dialog first. */
  deleteMeeting(id: string): Promise<boolean>;
  writeMinutes(id: string): void;
  cancelMinutes(id: string): void;
  /** Names "them" lines from cues in the conversation; guesses stay marked until confirmed. */
  guessSpeakers(id: string): Promise<{ named: number } | { error: string }>;
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
  onEvent(listener: (e: EchoEvent) => void): () => void;
}
