/**
 * What happens to a meeting after it ends: saved to the library, minutes written in the
 * background, edited and searched from the library window. Knows nothing about Electron.
 */
import type {
  MeetingDetail,
  MeetingPatch,
  MeetingSummary,
  MinutesProgressView,
} from '../../shared/meeting.ts';
import type { LlmProvider } from '../llm/types.ts';
import { generateMinutes, type MinutesOptions } from '../minutes/minutes.ts';
import type { SessionRecord } from '../session/types.ts';
import { type Logger, silentLogger } from '../util/logger.ts';
import {
  type MeetingStore,
  newMeeting,
  searchMeetings,
  type StoredMeeting,
  toDetail,
  toSummary,
} from './store.ts';
import { tokenize, type Chunk } from '../context/context.ts';
import { askMeetings, type MeetingAnswer } from './ask.ts';
import { meetingChunks } from './memory.ts';
import { guessSpeakers } from './speakers.ts';
import { cleanSpeakerName } from '../../shared/speakers.ts';

export type MeetingEvent =
  | { type: 'meeting-updated'; summary: MeetingSummary }
  | { type: 'meeting-deleted'; id: string }
  | { type: 'minutes-progress'; id: string; progress: MinutesProgressView }
  // Past meetings answers can now draw on.
  | { type: 'memory-updated'; meetings: number };

export interface MeetingServiceDeps {
  store: MeetingStore;
  /** Throws when no model is configured. */
  llm: () => LlmProvider;
  /** Read when minutes are written, so a name changed since the meeting applies. */
  writer: () => { myName: string; language: string };
  emit: (e: MeetingEvent) => void;
  now?: () => number;
  logger?: Logger;
  minutesOptions?: Omit<MinutesOptions, 'signal' | 'onProgress'>;
}

const LIMITS = { title: 200, notes: 20_000, minutes: 60_000 };

export class MeetingService {
  private readonly deps: MeetingServiceDeps;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly writing = new Map<string, AbortController>();
  private memoryChunks: Chunk[] = [];
  private memoryRun = 0;

  constructor(deps: MeetingServiceDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.log = deps.logger ?? silentLogger;
  }

  isWriting(id: string): boolean {
    return this.writing.has(id);
  }

  /** A finished session becomes a meeting in the library. */
  async saveRecord(record: SessionRecord): Promise<StoredMeeting> {
    const m = newMeeting(record, this.deps.writer().myName);
    await this.deps.store.save(m);
    this.changed(m);
    return m;
  }

  async list(query = ''): Promise<MeetingSummary[]> {
    const words = [...new Set(tokenize(query))];
    return searchMeetings(await this.deps.store.all(), query).map((m) =>
      toSummary(m, this.isWriting(m.id), words),
    );
  }

  async detail(id: string): Promise<MeetingDetail | null> {
    const m = await this.deps.store.get(id);
    return m ? toDetail(m, this.isWriting(id)) : null;
  }

  async update(id: string, patch: MeetingPatch): Promise<MeetingDetail | null> {
    const m = await this.deps.store.get(id);
    if (!m) return null;
    const next: StoredMeeting = { ...m };
    if (typeof patch.title === 'string' && patch.title.trim()) {
      next.title = patch.title.trim().slice(0, LIMITS.title);
      next.titleEdited = true;
    }
    if (typeof patch.notes === 'string') next.notes = patch.notes.slice(0, LIMITS.notes);
    if (typeof patch.themName === 'string') {
      next.speakers = { ...m.speakers, them: cleanSpeakerName(patch.themName) || undefined };
    }
    const line = patch.lineSpeaker;
    const seg = line && m.record.segments.find((s) => s.id === line.id && s.speaker === 'them');
    if (line && seg) {
      const byLine = { ...m.speakers?.byLine };
      const name = cleanSpeakerName(line.name);
      if (name) byLine[seg.id] = name;
      else delete byLine[seg.id];
      next.speakers = {
        ...next.speakers,
        byLine,
        // The user has now decided this line, so it is no longer a guess.
        guessed: (m.speakers?.guessed ?? []).filter((id) => id !== seg.id),
      };
    }
    if (typeof patch.minutes === 'string' && m.minutes) {
      // The user has checked the text, so earlier figure warnings no longer apply.
      next.minutes = {
        ...m.minutes,
        markdown: patch.minutes.slice(0, LIMITS.minutes),
        edited: true,
        unverifiedFigures: [],
      };
    }
    await this.deps.store.save(next);
    this.changed(next);
    return toDetail(next, this.isWriting(id));
  }

  async delete(id: string): Promise<boolean> {
    this.writing.get(id)?.abort();
    const ok = await this.deps.store.delete(id);
    if (ok) {
      this.deps.emit({ type: 'meeting-deleted', id });
      void this.refreshMemory();
    }
    return ok;
  }

  /** Writes (or rewrites) the minutes. Resolves when done; failures are saved, not thrown. */
  async writeMinutes(id: string): Promise<void> {
    // Registered before any await, so a delete or rewrite right after this call sees it.
    this.writing.get(id)?.abort();
    const abort = new AbortController();
    this.writing.set(id, abort);
    const m = await this.deps.store.get(id);
    if (!m || abort.signal.aborted) {
      if (this.writing.get(id) === abort) this.writing.delete(id);
      return;
    }
    this.changed(m);
    const w = this.deps.writer();
    let result: Awaited<ReturnType<typeof generateMinutes>> | null = null;
    let error: string | undefined;
    try {
      result = await generateMinutes(
        this.deps.llm(),
        {
          record: m.record,
          myName: w.myName,
          language: w.language,
          agenda: m.record.contextNote,
          notes: m.notes,
          title: m.titleEdited ? m.title : undefined,
          names: m.speakers,
          attendees: m.record.attendees,
        },
        {
          ...this.deps.minutesOptions,
          signal: abort.signal,
          onProgress: (progress) => this.deps.emit({ type: 'minutes-progress', id, progress }),
        },
      );
    } catch (err) {
      error = (err as Error).message;
    }
    if (this.writing.get(id) !== abort) return; // replaced or deleted meanwhile
    this.writing.delete(id);
    // Re-read: notes or the title may have been edited while the model was writing.
    const latest = await this.deps.store.get(id);
    if (!latest) return;
    const next: StoredMeeting = result
      ? {
          ...latest,
          title: latest.titleEdited ? latest.title : result.title,
          minutes: {
            markdown: result.markdown,
            generatedAt: this.now(),
            edited: false,
            unverifiedFigures: result.unverifiedFigures,
          },
          minutesError: undefined,
        }
      : { ...latest, minutesError: abort.signal.aborted ? 'Cancelled.' : error };
    if (error) this.log.warn('minutes failed', { id, error });
    await this.deps.store.save(next);
    this.changed(next);
  }

  cancelMinutes(id: string): void {
    this.writing.get(id)?.abort();
  }

  /**
   * Minutes and notes of past meetings, as answer chunks. Kept ready (answers are built
   * synchronously during a call) and rebuilt whenever a meeting changes.
   */
  get memory(): readonly Chunk[] {
    return this.memoryChunks;
  }

  async refreshMemory(): Promise<void> {
    const run = ++this.memoryRun;
    const chunks = meetingChunks(await this.deps.store.all());
    if (run !== this.memoryRun) return;
    this.memoryChunks = chunks;
    this.deps.emit({ type: 'memory-updated', meetings: new Set(chunks.map((c) => c.file)).size });
  }

  /**
   * Names "them" lines from cues in the conversation. Lines the user named stay as they
   * are; earlier guesses are replaced. Returns how many lines got a name.
   */
  async guessSpeakers(id: string, signal?: AbortSignal): Promise<number> {
    const m = await this.deps.store.get(id);
    if (!m) return 0;
    const guesses = await guessSpeakers(this.deps.llm(), m.record.segments, {
      myName: this.deps.writer().myName,
      attendees: m.record.attendees,
      names: m.speakers,
      signal,
    });
    const latest = (await this.deps.store.get(id)) ?? m;
    const guessed = new Set(latest.speakers?.guessed ?? []);
    const byLine: Record<string, string> = {};
    // Keep what the user set; drop old guesses; add the new ones.
    for (const [lineId, name] of Object.entries(latest.speakers?.byLine ?? {}))
      if (!guessed.has(lineId)) byLine[lineId] = name;
    const fresh = Object.keys(guesses).filter((lineId) => !(lineId in byLine));
    for (const lineId of fresh) byLine[lineId] = guesses[lineId]!;
    const next: StoredMeeting = {
      ...latest,
      speakers: { ...latest.speakers, byLine, guessed: fresh },
    };
    await this.deps.store.save(next);
    this.changed(next);
    return fresh.length;
  }

  /** "Ask your meetings" from the library. */
  async ask(
    question: string,
    opts: { budget: number; signal?: AbortSignal; onText?: (text: string) => void },
  ): Promise<MeetingAnswer> {
    return askMeetings(this.deps.llm(), await this.deps.store.all(), question, {
      ...opts,
      myName: this.deps.writer().myName,
    });
  }

  private changed(m: StoredMeeting): void {
    this.deps.emit({ type: 'meeting-updated', summary: toSummary(m, this.isWriting(m.id)) });
    void this.refreshMemory();
  }
}
