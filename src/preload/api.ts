import type {
  AppState,
  BoloEvent,
  ContextView,
  DemoAudio,
  StartResult,
  StopResult,
  WindowCommand,
} from '../shared/ipc.ts';
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
  window(cmd: WindowCommand): void;
  /**
   * Opens a MessagePort to the main process for one speaker's audio frames. The page
   * receives the other end as a window "message" event (see AUDIO_PORT_MESSAGE).
   */
  openAudioPort(speaker: Speaker): void;
  onEvent(listener: (e: BoloEvent) => void): () => void;
}
