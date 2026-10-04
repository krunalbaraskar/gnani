import { OpenAiCompatibleProvider } from '../core/llm/openai-compatible.ts';
import { CopilotSession } from '../core/session/copilot-session.ts';
import type { SessionRecord } from '../core/session/types.ts';
import { GnaniSttProvider } from '../core/stt/gnani-provider.ts';
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
  };
}

/** Owns the current CopilotSession and forwards its events to the overlay. */
export class SessionController {
  private session: CopilotSession | null = null;
  private readonly getEnv: () => BoloEnv;
  private readonly getSettings: () => Settings;
  private readonly emit: (e: BoloEvent) => void;
  private readonly log: Logger;

  constructor(
    getEnv: () => BoloEnv,
    getSettings: () => Settings,
    emit: (e: BoloEvent) => void,
    log: Logger,
  ) {
    this.getEnv = getEnv;
    this.getSettings = getSettings;
    this.emit = emit;
    this.log = log;
  }

  get running(): boolean {
    return this.session?.isRunning ?? false;
  }

  start(): StartResult {
    if (this.running) return { ok: true };
    const env = this.getEnv();
    if (!env.gnaniApiKey) {
      return {
        ok: false,
        error: 'GNANI_API_KEY is not set. Add it to your .env file and restart Bolo.',
      };
    }
    const emit = this.emit;
    const session = new CopilotSession({
      stt: new GnaniSttProvider({
        apiKey: env.gnaniApiKey,
        url: env.gnaniSttUrl,
        logger: this.log,
      }),
      llm: () => {
        const cfg = llmConfig(this.getSettings(), this.getEnv());
        return new OpenAiCompatibleProvider(cfg);
      },
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

  requestSuggestion(): void {
    if (!this.session?.isRunning) {
      this.emit({ type: 'notice', level: 'info', message: 'Start a session first (▶ Start).' });
      return;
    }
    void this.session.requestSuggestion();
  }

  async stop(): Promise<SessionRecord | null> {
    const s = this.session;
    if (!s) return null;
    this.session = null;
    const record = await s.stop();
    this.emit({ type: 'session', running: false });
    return record;
  }
}
