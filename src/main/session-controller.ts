import type { LoadedContext } from '../core/context/context.ts';
import { OpenAiCompatibleProvider } from '../core/llm/openai-compatible.ts';
import { CopilotSession } from '../core/session/copilot-session.ts';
import type { SessionRecord } from '../core/session/types.ts';
import { GNANI_LANGUAGES } from '../core/stt/gnani-protocol.ts';
import { GnaniSttProvider } from '../core/stt/gnani-provider.ts';
import type { SttProvider } from '../core/stt/types.ts';
import { WhisperSttProvider } from '../core/stt/whisper-provider.ts';
import type { Logger } from '../core/util/logger.ts';
import type { BoloEvent, StartResult } from '../shared/ipc.ts';
import type { Settings } from '../shared/settings.ts';
import type { Speaker } from '../shared/transcript/types.ts';
import type { BoloEnv } from './env.ts';

/** Effective LLM config: settings override env defaults. The key is env-only. */
export function llmConfig(settings: Settings, env: BoloEnv) {
  return {
    baseUrl: settings.llmBaseUrl || env.llmBaseUrl,
    model: settings.llmModel || env.llmModel,
    apiKey: env.llmApiKey || undefined,
    reasoningEffort: env.llmReasoningEffort || undefined,
  };
}

/** "English (India)" → "English": the name used when asking the model for a meaning. */
export function languageName(code: string): string {
  const label = GNANI_LANGUAGES.find((l) => l.code === code)?.label ?? 'English';
  return label.replace(/\s*\(.*\)$/, '');
}

/** Owns the current CopilotSession and forwards its events to the overlay. */
export class SessionController {
  private session: CopilotSession | null = null;
  private readonly getEnv: () => BoloEnv;
  private readonly getSettings: () => Settings;
  private readonly getContext: () => LoadedContext | null;
  private readonly emit: (e: BoloEvent) => void;
  private readonly log: Logger;

  constructor(
    getEnv: () => BoloEnv,
    getSettings: () => Settings,
    getContext: () => LoadedContext | null,
    emit: (e: BoloEvent) => void,
    log: Logger,
  ) {
    this.getEnv = getEnv;
    this.getSettings = getSettings;
    this.getContext = getContext;
    this.emit = emit;
    this.log = log;
  }

  get running(): boolean {
    return this.session?.isRunning ?? false;
  }

  get paused(): boolean {
    return this.session?.isPaused ?? false;
  }

  setPaused(paused: boolean): void {
    const s = this.session;
    if (!s?.isRunning) return;
    s.setPaused(paused);
    this.emit({ type: 'paused', paused: s.isPaused });
  }

  start(): StartResult {
    if (this.running) return { ok: true };
    const env = this.getEnv();
    if (env.sttProvider === 'gnani' && !env.gnaniApiKey) {
      return {
        ok: false,
        error: 'GNANI_API_KEY is not set. Add it to your .env file and restart Bolo.',
      };
    }
    // A local Whisper server needs no key, so a missing one is only reported if refused.
    const stt: SttProvider =
      env.sttProvider === 'whisper'
        ? new WhisperSttProvider({
            baseUrl: env.whisperBaseUrl,
            apiKey: env.whisperApiKey || undefined,
            model: env.whisperModel,
            logger: this.log,
          })
        : new GnaniSttProvider({ apiKey: env.gnaniApiKey, url: env.gnaniSttUrl, logger: this.log });
    const emit = this.emit;
    const llm = (vision: boolean) => {
      const settings = this.getSettings();
      const cfg = llmConfig(settings, this.getEnv());
      return new OpenAiCompatibleProvider(
        vision ? { ...cfg, model: settings.llmVisionModel } : cfg,
      );
    };
    const session = new CopilotSession({
      stt,
      llm: () => llm(false),
      llmVision: () => llm(true),
      context: this.getContext,
      myLanguageLabel: () => languageName(this.getSettings().myLanguage),
      settings: this.getSettings,
      logger: this.log,
      events: {
        onSegment: (segment) => emit({ type: 'segment', segment }),
        onSegmentRemoved: (id, reason) => emit({ type: 'segment-removed', id, reason }),
        onPartial: (speaker, text) => emit({ type: 'partial', speaker, text }),
        onProcessing: (speaker) => emit({ type: 'processing', speaker }),
        onSttStatus: (status) => emit({ type: 'stt-status', status }),
        onSuggestionStart: (suggestion) => emit({ type: 'suggestion-start', suggestion }),
        onSuggestionToken: (id, _t, text) => emit({ type: 'suggestion-token', id, text }),
        onSuggestionDone: (suggestion) => emit({ type: 'suggestion-done', suggestion }),
        onMeaning: (id, meaning) => emit({ type: 'segment-meaning', id, meaning }),
        onMention: (mention) => emit({ type: 'mention', mention }),
      },
    });
    session.start();
    this.session = session;
    emit({ type: 'session', running: true });
    return { ok: true };
  }

  pushFrame(speaker: Speaker, frame: Uint8Array): void {
    this.session?.pushFrame(speaker, frame);
  }

  /** The running session, or null after telling the user to start one. */
  private active(): CopilotSession | null {
    if (this.session?.isRunning) return this.session;
    this.emit({ type: 'notice', level: 'info', message: 'Start a session first (▶ Start).' });
    return null;
  }

  requestSuggestion(): void {
    void this.active()?.requestSuggestion();
  }

  /** A typed question. `capture` is called only if the screen was asked for. */
  async ask(text: string, capture?: () => Promise<string>): Promise<void> {
    const session = this.active();
    if (!session) return;
    const image = capture ? await this.capture(capture) : undefined;
    if (capture && !image) return;
    void session.ask(text, image);
  }

  async askScreen(capture: () => Promise<string>): Promise<void> {
    const session = this.active();
    if (!session) return;
    const image = await this.capture(capture);
    if (image) void session.askScreen(image);
  }

  catchUp(): void {
    void this.active()?.catchUp();
  }

  requestMeaning(id: string): void {
    this.session?.requestMeaning(id);
  }

  /** Screen questions need a model the user has said can read images. */
  private async capture(capture: () => Promise<string>): Promise<string | undefined> {
    if (!this.getSettings().llmVisionModel) {
      this.emit({
        type: 'notice',
        level: 'error',
        message: 'Set a vision model in Settings to use the screen.',
      });
      return undefined;
    }
    try {
      return await capture();
    } catch (err) {
      this.emit({
        type: 'notice',
        level: 'error',
        message: `Could not read the screen: ${(err as Error).message}`,
      });
      return undefined;
    }
  }

  async stop(): Promise<SessionRecord | null> {
    const s = this.session;
    if (!s) return null;
    this.session = null;
    const record = await s.stop();
    this.emit({ type: 'paused', paused: false });
    this.emit({ type: 'session', running: false });
    return record;
  }
}
