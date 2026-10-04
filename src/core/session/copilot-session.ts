import { isEcho, findEchoesOf } from '../../shared/suggest/echo-dedupe.ts';
import { detectQuestion } from '../../shared/suggest/question-detector.ts';
import { SilenceGate } from '../../shared/audio/silence-gate.ts';
import { TranscriptBuffer } from '../../shared/transcript/buffer.ts';
import { SPEAKERS, type Speaker, type TranscriptSegment } from '../../shared/transcript/types.ts';
import type { Settings } from '../../shared/settings.ts';
import type { LlmProvider } from '../llm/types.ts';
import { SuggestionEngine, type Suggestion } from '../suggest/engine.ts';
import type { SttProvider, SttStatus, SttStream, SttTranscript } from '../stt/types.ts';
import { type Logger, silentLogger } from '../util/logger.ts';
import type { SessionRecord } from './types.ts';

/** How far back echo dedupe looks, in both directions. */
const ECHO_WINDOW_MS = 5000;

export interface SessionEvents {
  onSegment(seg: TranscriptSegment): void;
  onSegmentRemoved(id: string, reason: 'echo'): void;
  onPartial(speaker: Speaker, text: string): void;
  onProcessing(speaker: Speaker): void;
  onSttStatus(status: SttStatus): void;
  onSuggestionStart(s: Suggestion): void;
  onSuggestionToken(id: string, token: string, textSoFar: string): void;
  onSuggestionDone(s: Suggestion): void;
}

export interface CopilotSessionDeps {
  stt: SttProvider;
  llm: () => LlmProvider;
  /** Read on every use, so settings changed mid-call apply immediately. */
  settings: () => Settings;
  events: SessionEvents;
  now?: () => number;
  logger?: Logger;
  autoSuggestCooldownMs?: number;
}

/**
 * One call/meeting: two STT streams (me = mic, them = system audio), the transcript,
 * echo dedupe, auto-suggest on questions, and the suggestion engine. Knows nothing
 * about Electron, so it is tested end to end in Node.
 */
export class CopilotSession {
  readonly transcript = new TranscriptBuffer();
  private readonly deps: CopilotSessionDeps;
  private readonly engine: SuggestionEngine;
  private readonly now: () => number;
  private readonly log: Logger;
  private streams = new Map<Speaker, SttStream>();
  private gates = new Map<Speaker, SilenceGate>();
  private record: SessionRecord;
  private running = false;

  constructor(deps: CopilotSessionDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.log = deps.logger ?? silentLogger;
    const s = deps.settings();
    this.record = {
      startedAt: this.now(),
      sttLanguage: s.sttLanguage,
      outputLanguage: s.outputLanguage,
      contextNote: s.contextNote,
      audioMode: s.audioMode,
      segments: [],
      suggestions: [],
      echoesRemoved: 0,
    };
    this.engine = new SuggestionEngine(
      deps.llm,
      {
        onStart: (x) => deps.events.onSuggestionStart(x),
        onToken: (id, t, all) => deps.events.onSuggestionToken(id, t, all),
        onDone: (x) => deps.events.onSuggestionDone(x),
      },
      { now: this.now, logger: this.log, autoCooldownMs: deps.autoSuggestCooldownMs },
    );
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.record.startedAt = this.now();
    const s = this.deps.settings();
    for (const speaker of SPEAKERS) {
      this.gates.set(speaker, new SilenceGate({ thresholdDb: s.silenceThresholdDb }));
      const stream = this.deps.stt.openStream(
        speaker,
        { language: s.sttLanguage, formatNumbers: s.formatNumbers },
        {
          onTranscript: (t) => this.onTranscript(t),
          onStatus: (st) => this.deps.events.onSttStatus(st),
          onProcessing: (sp) => this.deps.events.onProcessing(sp),
        },
      );
      this.streams.set(speaker, stream);
    }
  }

  /** One 1024-byte PCM16 frame from the capture pipeline. */
  pushFrame(speaker: Speaker, frame: Uint8Array): void {
    const stream = this.streams.get(speaker);
    if (!this.running || !stream) return;
    if (!this.deps.settings().silenceGate) {
      stream.send(frame);
      return;
    }
    for (const f of this.gates.get(speaker)!.process(frame)) stream.send(f);
  }

  requestSuggestion(): Promise<Suggestion | null> {
    return this.engine.request(this.suggestRequest('hotkey'));
  }

  async stop(): Promise<SessionRecord> {
    if (!this.running) return this.snapshot();
    this.running = false;
    await Promise.all([...this.streams.values()].map((s) => s.close()));
    this.streams.clear();
    this.engine.cancel();
    this.record.endedAt = this.now();
    return this.snapshot();
  }

  snapshot(): SessionRecord {
    return {
      ...this.record,
      segments: this.transcript.all(),
      suggestions: [...this.engine.history],
    };
  }

  private onTranscript(t: SttTranscript): void {
    if (!t.final) {
      this.deps.events.onPartial(t.speaker, t.text);
      return;
    }
    const settings = this.deps.settings();
    const seg: TranscriptSegment = {
      id: `${t.speaker}:${t.segmentId}`,
      speaker: t.speaker,
      text: t.text.trim(),
      at: t.receivedAt,
      audioDurationMs: t.audioDurationMs,
      serverLatencyMs: t.serverLatencyMs,
      endToEndLatencyMs: t.endToEndLatencyMs,
    };
    if (!seg.text) return;

    if (settings.echoDedupe) {
      if (seg.speaker === 'me') {
        const recentThem = this.transcript.since(seg.at - ECHO_WINDOW_MS, 'them');
        if (isEcho(seg, recentThem, { windowMs: ECHO_WINDOW_MS })) {
          this.record.echoesRemoved++;
          this.deps.events.onPartial('me', '');
          this.log.info('dropped echo segment', { id: seg.id });
          return;
        }
      } else {
        // An echo may have reached us before the original: remove it retroactively.
        const recentMe = this.transcript.since(seg.at - ECHO_WINDOW_MS, 'me');
        for (const id of findEchoesOf(seg, recentMe, { windowMs: ECHO_WINDOW_MS })) {
          this.transcript.remove(id);
          this.record.echoesRemoved++;
          this.deps.events.onSegmentRemoved(id, 'echo');
        }
      }
    }

    this.transcript.add(seg);
    this.deps.events.onSegment(seg);

    if (seg.speaker === 'them' && settings.autoSuggest && detectQuestion(seg.text).isQuestion) {
      void this.engine.request(this.suggestRequest('auto', seg.text));
    }
  }

  private suggestRequest(trigger: 'hotkey' | 'auto', question?: string) {
    const s = this.deps.settings();
    return {
      segments: this.transcript.getRecent(s.transcriptMinutes, this.now()),
      contextNote: s.contextNote,
      outputLanguage: s.outputLanguage,
      trigger,
      question,
    };
  }
}
