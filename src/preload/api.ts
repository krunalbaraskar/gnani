import type {
  AppState,
  BoloEvent,
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
  window(cmd: WindowCommand): void;
  /**
   * Opens a MessagePort to the main process for one speaker's audio frames. The page
   * receives the other end as a window "message" event (see AUDIO_PORT_MESSAGE).
   */
  openAudioPort(speaker: Speaker): void;
  onEvent(listener: (e: BoloEvent) => void): () => void;
}
