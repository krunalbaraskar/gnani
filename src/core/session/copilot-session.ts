import { isEcho, findEchoesOf } from '../../shared/suggest/echo-dedupe.ts';
import { detectQuestion } from '../../shared/suggest/question-detector.ts';
import { SilenceGate } from '../../shared/audio/silence-gate.ts';
import { TranscriptBuffer } from '../../shared/transcript/buffer.ts';
import { SPEAKERS, type Speaker, type TranscriptSegment } from '../../shared/transcript/types.ts';
import type { Settings } from '../../shared/settings.ts';
import { selectChunks, type LoadedContext } from '../context/context.ts';
import { GlossEngine } from '../gloss/engine.ts';
import type { LlmProvider } from '../llm/types.ts';
import { SuggestionEngine, type Suggestion, type SuggestRequest } from '../suggest/engine.ts';
import { CATCHUP_MINUTES } from '../suggest/prompt.ts';
import { findMentions, watchTerms } from './mentions.ts';
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
  onMeaning?(id: string, meaning: string): void;
  /** They said the user's name or a watch word. `asked`: and it sounded like a question. */
  onMention?(m: Mention): void;
}

/** A meeting from the user's calendar. */
export interface MeetingInfo {
  title: string;
  attendees: string[];
  /** The invite's description; kept short (see the main process). */
  agenda: string;
}

export interface Mention {
  segmentId: string;
  text: string;
  terms: string[];
  asked: boolean;
  at: number;
}

export interface CopilotSessionDeps {
  stt: SttProvider;
  llm: () => LlmProvider;
  /** Model for requests that carry a screenshot. Defaults to `llm`. */
  llmVision?: () => LlmProvider;
  /** The user's reference files, or null if no folder is loaded. Read on every answer. */
  context?: () => LoadedContext | null;
  /** Name of the language the user reads, e.g. "English", for meanings. */
  myLanguageLabel?: () => string;
  /** Read on every use, so settings changed mid-call apply immediately. */
  settings: () => Settings;
  events: SessionEvents;
  now?: () => number;
  logger?: Logger;
  autoSuggestCooldownMs?: number;
  /** The calendar meeting this session is for, when started from the calendar. */
  meeting?: MeetingInfo;
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
  private readonly gloss: GlossEngine;
  private readonly now: () => number;
  private readonly log: Logger;
  private streams = new Map<Speaker, SttStream>();
  private gates = new Map<Speaker, SilenceGate>();
  private record: SessionRecord;
  private running = false;
  private pausedAt: number | null = null;

  constructor(deps: CopilotSessionDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.log = deps.logger ?? silentLogger;
    const s = deps.settings();
    this.record = {
      startedAt: this.now(),
      sttLanguage: s.sttLanguage,
      outputLanguage: s.outputLanguage,
      contextNote: this.note(s),
      ...(deps.meeting ? { title: deps.meeting.title, attendees: deps.meeting.attendees } : {}),
      audioMode: s.audioMode,
      segments: [],
      suggestions: [],
      echoesRemoved: 0,
      mode: s.mode,
      pauses: [],
    };
    this.gloss = new GlossEngine(
      deps.llm,
      (id, meaning) => {
        if (this.transcript.setMeaning(id, meaning)) deps.events.onMeaning?.(id, meaning);
      },
      { now: this.now, logger: this.log },
    );
    this.engine = new SuggestionEngine(
      (vision) => (vision && deps.llmVision ? deps.llmVision() : deps.llm()),
      {
        // An answer never waits behind a meaning request.
        onStart: (x) => {
          this.gloss.hold();
          deps.events.onSuggestionStart(x);
        },
        onToken: (id, t, all) => deps.events.onSuggestionToken(id, t, all),
        onDone: (x) => {
          // A cancelled answer finishes after its replacement has started.
          if (!this.engine.busy) this.gloss.release();
          deps.events.onSuggestionDone(x);
        },
      },
      { now: this.now, logger: this.log, autoCooldownMs: deps.autoSuggestCooldownMs },
    );
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isPaused(): boolean {
    return this.pausedAt !== null;
  }

  /** Off the record: audio is dropped before the STT until resumed. Streams stay open. */
  setPaused(paused: boolean): void {
    if (!this.running || paused === this.isPaused) return;
    if (paused) {
      this.pausedAt = this.now();
      for (const speaker of SPEAKERS) this.deps.events.onPartial(speaker, '');
    } else {
      this.record.pauses!.push({ from: this.pausedAt!, to: this.now() });
      this.pausedAt = null;
    }
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
    if (!this.running || !stream || this.pausedAt !== null) return;
    if (!this.deps.settings().silenceGate) {
      stream.send(frame);
      return;
    }
    for (const f of this.gates.get(speaker)!.process(frame)) stream.send(f);
  }

  requestSuggestion(): Promise<Suggestion | null> {
    return this.engine.request(this.suggestRequest('hotkey'));
  }

  /** A question typed into the Ask box, optionally with a screenshot (data URL). */
  ask(text: string, image?: string): Promise<Suggestion | null> {
    if (!this.running) return Promise.resolve(null);
    return this.engine.request({
      ...this.suggestRequest(image ? 'screen' : 'typed', text),
      asked: text,
      image,
    });
  }

  /** "Catch me up": a recap of the last few minutes. Runs in every mode: the user asked. */
  catchUp(): Promise<Suggestion | null> {
    if (!this.running) return Promise.resolve(null);
    const s = this.deps.settings();
    return this.engine.request({
      segments: this.transcript.getRecent(CATCHUP_MINUTES, this.now()),
      contextNote: this.note(s),
      outputLanguage: s.outputLanguage,
      trigger: 'catchup',
      myName: s.myName,
    });
  }

  /** "Answer from my screen": no typed question, just the screenshot. */
  askScreen(image: string): Promise<Suggestion | null> {
    if (!this.running) return Promise.resolve(null);
    return this.engine.request({ ...this.suggestRequest('screen'), image });
  }

  /** The user clicked a "them" line to have it explained (again). */
  requestMeaning(id: string): void {
    const seg = this.transcript.all().find((s) => s.id === id && s.speaker === 'them');
    if (seg && this.running) this.gloss.requestAgain(seg.id, seg.text, this.myLanguage());
  }

  async stop(): Promise<SessionRecord> {
    if (!this.running) return this.snapshot();
    this.setPaused(false);
    this.running = false;
    // allSettled: a stream that fails to close must not skip the cancels below or lose the record.
    await Promise.allSettled([...this.streams.values()].map((s) => s.close()));
    this.streams.clear();
    this.engine.cancel();
    this.gloss.stop();
    this.record.endedAt = this.now();
    return this.snapshot();
  }

  snapshot(): SessionRecord {
    return {
      ...this.record,
      mode: this.deps.settings().mode,
      pauses: [...(this.record.pauses ?? [])],
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
    if (!seg.text) {
      // Nothing recognised (noise, a cough): clear the "…" placeholder.
      this.deps.events.onPartial(t.speaker, '');
      return;
    }

    if (settings.echoDedupe) {
      if (seg.speaker === 'me') {
        const recentThem = this.transcript.since(seg.at - ECHO_WINDOW_MS, 'them');
        if (isEcho(seg, recentThem, { windowMs: ECHO_WINDOW_MS })) {
          this.record.echoesRemoved++;
          this.deps.events.onPartial('me', '');
          // Never shown, but the overlay counts removed echoes from this event.
          this.deps.events.onSegmentRemoved(seg.id, 'echo');
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

    const mentioned =
      seg.speaker === 'them'
        ? findMentions(seg.text, watchTerms(settings.myName, settings.watchWords))
        : [];
    if (mentioned.length) seg.mentions = mentioned;

    this.transcript.add(seg);
    this.deps.events.onSegment(seg);

    if (mentioned.length) {
      this.deps.events.onMention?.({
        segmentId: seg.id,
        text: seg.text,
        terms: mentioned,
        asked: detectQuestion(seg.text).isQuestion,
        at: seg.at,
      });
    }

    // Silent mode makes no AI request the user did not ask for.
    if (seg.speaker === 'them' && settings.mode !== 'silent' && settings.explainThem) {
      this.gloss.enqueue(seg.id, seg.text, this.myLanguage());
    }
    if (
      seg.speaker === 'them' &&
      settings.mode === 'active' &&
      detectQuestion(seg.text).isQuestion
    ) {
      // Built when it runs, so a held question is answered with the transcript as it is then.
      void this.engine.requestAuto(() => this.suggestRequest('auto', seg.text));
    }
  }

  /** The user's note, plus the calendar invite's title, people and agenda. */
  private note(s: Settings): string {
    const m = this.deps.meeting;
    if (!m) return s.contextNote;
    return [
      s.contextNote.trim(),
      `Meeting: ${m.title}`,
      m.attendees.length ? `Invited: ${m.attendees.join(', ')}` : '',
      m.agenda.trim() ? `Agenda (from the invite):\n${m.agenda.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private myLanguage(): string {
    return this.deps.myLanguageLabel?.() ?? 'English';
  }

  /** `question`: what the answer is about (their question, or the user's typed one). */
  private suggestRequest(trigger: SuggestRequest['trigger'], question?: string): SuggestRequest {
    const s = this.deps.settings();
    const context = this.deps.context?.() ?? null;
    const contextLoaded = !!context && context.files.length > 0;
    const lastThem = this.transcript
      .since(0, 'them')
      .slice(-3)
      .map((t) => t.text);
    return {
      segments: this.transcript.getRecent(s.transcriptMinutes, this.now()),
      contextNote: this.note(s),
      outputLanguage: s.outputLanguage,
      trigger,
      question: trigger === 'auto' ? question : undefined,
      contextLoaded,
      chunks: contextLoaded
        ? selectChunks(
            context.chunks,
            [question ?? '', ...lastThem].join(' '),
            s.contextBudgetChars,
          )
        : undefined,
    };
  }
}
