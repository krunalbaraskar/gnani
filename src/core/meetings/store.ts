/**
 * The meeting library: one JSON file per meeting in a folder on this machine, kept in
 * memory once read. Nothing here leaves the computer.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  defaultMeetingTitle,
  MEETING_ID,
  type MeetingDetail,
  type MeetingSummary,
  type MinutesState,
} from '../../shared/meeting.ts';
import type { MeetingMode } from '../../shared/settings.ts';
import { cleanText } from '../../shared/transcript/format.ts';
import { cleanSpeakerName, type SpeakerNames } from '../../shared/speakers.ts';
import { tokenize } from '../context/context.ts';
import { parseActionItems } from '../minutes/minutes.ts';
import type { SessionRecord } from '../session/types.ts';
import { type Logger, silentLogger } from '../util/logger.ts';

export interface StoredMinutes {
  markdown: string;
  generatedAt: number;
  edited: boolean;
  unverifiedFigures: string[];
}

export interface StoredMeeting {
  version: 1;
  id: string;
  title: string;
  /** The user named it: a regenerated write-up keeps this title. */
  titleEdited: boolean;
  record: SessionRecord;
  notes: string;
  minutes?: StoredMinutes;
  minutesError?: string;
  /** Names on the "them" side (see shared/speakers.ts). */
  speakers?: SpeakerNames;
}

export function meetingId(startedAt: number): string {
  return `m${Math.round(startedAt)}`;
}

/**
 * A finished session as a library entry. A meeting started from the calendar keeps the
 * invite's title, and a 1:1 invite names the other side.
 */
export function newMeeting(record: SessionRecord, myName = ''): StoredMeeting {
  const others = (record.attendees ?? []).filter(
    (a) => a.trim().toLowerCase() !== myName.trim().toLowerCase(),
  );
  return {
    version: 1,
    id: meetingId(record.startedAt),
    title: record.title?.trim() || defaultMeetingTitle(record.startedAt),
    titleEdited: !!record.title?.trim(),
    record,
    notes: '',
    ...(others.length === 1 ? { speakers: { them: others[0] } } : {}),
  };
}

function durationOf(r: SessionRecord): number {
  return Math.max(0, (r.endedAt ?? r.segments.at(-1)?.at ?? r.startedAt) - r.startedAt);
}

/** The text a meeting is found by. */
function searchText(m: StoredMeeting): string {
  return [
    m.title,
    m.minutes?.markdown ?? '',
    m.notes,
    m.record.contextNote,
    ...(m.record.attendees ?? []),
    m.speakers?.them ?? '',
    ...Object.values(m.speakers?.byLine ?? {}),
    ...m.record.segments.map((s) => s.text),
  ].join('\n');
}

/** Around the first query word found, or the start of the minutes/transcript. */
/** Minutes as plain prose for a preview: no headings, date line, list markers or task boxes. */
function plainMinutes(md: string): string {
  return md
    .replace(/^#.*$/gm, '')
    .replace(/\*\*Date:\*\*.*$/m, '')
    .replace(/^\s*[-*]\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/[#*_`]/g, '');
}

function snippetOf(m: StoredMeeting, words: readonly string[]): string {
  const sources = [
    m.minutes ? plainMinutes(m.minutes.markdown) : '',
    ...m.record.segments.map((s) => s.text),
    m.notes,
  ];
  for (const w of words) {
    for (const src of sources) {
      const i = src.toLowerCase().indexOf(w);
      if (i < 0) continue;
      const from = Math.max(0, i - 50);
      return (from > 0 ? '…' : '') + cleanText(src.slice(from, i + 90).replace(/[#*_`]/g, ''));
    }
  }
  return cleanText(sources.find((s) => s.trim()) ?? '').slice(0, 140);
}

export function toSummary(
  m: StoredMeeting,
  writing: boolean,
  words: readonly string[] = [],
): MeetingSummary {
  const state: MinutesState = writing
    ? 'writing'
    : m.minutes
      ? 'ready'
      : m.minutesError
        ? 'failed'
        : 'none';
  return {
    id: m.id,
    title: m.title,
    startedAt: m.record.startedAt,
    durationMs: durationOf(m.record),
    mode: m.record.mode as MeetingMode | undefined,
    lines: m.record.segments.length,
    actionItems: m.minutes ? parseActionItems(m.minutes.markdown).length : 0,
    minutes: state,
    snippet: snippetOf(m, words),
  };
}

export function toDetail(m: StoredMeeting, writing: boolean): MeetingDetail {
  return {
    ...toSummary(m, writing),
    segments: m.record.segments,
    suggestions: m.record.suggestions,
    notes: m.notes,
    agenda: m.record.contextNote,
    minutesView: m.minutes,
    minutesError: m.minutesError,
    pauses: m.record.pauses ?? [],
    speakers: m.speakers ?? {},
    attendees: m.record.attendees ?? [],
  };
}

/**
 * Meetings containing every query word (as a word prefix), best first: title hits, then
 * minutes, then how often the words occur. An empty query lists everything, newest first.
 */
export function searchMeetings(meetings: readonly StoredMeeting[], query: string): StoredMeeting[] {
  const words = [...new Set(tokenize(query))];
  const newest = [...meetings].sort((a, b) => b.record.startedAt - a.record.startedAt);
  if (!words.length) return newest;
  const scored: { m: StoredMeeting; score: number }[] = [];
  for (const m of newest) {
    const tokens = tokenize(searchText(m));
    const title = tokenize(m.title);
    const minutes = tokenize(m.minutes?.markdown ?? '');
    let score = 0;
    let all = true;
    for (const w of words) {
      const hits = tokens.filter((t) => t.startsWith(w)).length;
      if (!hits) {
        all = false;
        break;
      }
      score += Math.log(1 + hits);
      if (title.some((t) => t.startsWith(w))) score += 5;
      if (minutes.some((t) => t.startsWith(w))) score += 2;
    }
    if (all) scored.push({ m, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((x) => x.m);
}

/** Validates a meeting read from disk; anything unexpected is skipped, never trusted. */
export function parseStoredMeeting(json: unknown): StoredMeeting | null {
  const m = json as Partial<StoredMeeting> | null;
  if (!m || typeof m !== 'object' || m.version !== 1) return null;
  if (typeof m.id !== 'string' || !MEETING_ID.test(m.id)) return null;
  const r = m.record;
  if (!r || typeof r.startedAt !== 'number' || !Array.isArray(r.segments)) return null;
  return {
    version: 1,
    id: m.id,
    title:
      typeof m.title === 'string' && m.title.trim() ? m.title : defaultMeetingTitle(r.startedAt),
    titleEdited: m.titleEdited === true,
    record: { ...r, suggestions: Array.isArray(r.suggestions) ? r.suggestions : [] },
    notes: typeof m.notes === 'string' ? m.notes : '',
    minutes:
      m.minutes && typeof m.minutes.markdown === 'string'
        ? {
            markdown: m.minutes.markdown,
            generatedAt: Number(m.minutes.generatedAt) || 0,
            edited: m.minutes.edited === true,
            unverifiedFigures: Array.isArray(m.minutes.unverifiedFigures)
              ? m.minutes.unverifiedFigures.filter((x) => typeof x === 'string')
              : [],
          }
        : undefined,
    minutesError: typeof m.minutesError === 'string' ? m.minutesError : undefined,
    speakers: parseSpeakers(m.speakers),
  };
}

function parseSpeakers(v: unknown): SpeakerNames | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const s = v as Record<string, unknown>;
  const byLine: Record<string, string> = {};
  if (s['byLine'] && typeof s['byLine'] === 'object')
    for (const [id, name] of Object.entries(s['byLine'] as Record<string, unknown>))
      if (typeof name === 'string' && cleanSpeakerName(name)) byLine[id] = cleanSpeakerName(name);
  return {
    them: typeof s['them'] === 'string' ? cleanSpeakerName(s['them']) || undefined : undefined,
    byLine,
    guessed: Array.isArray(s['guessed'])
      ? s['guessed'].filter((id): id is string => typeof id === 'string' && id in byLine)
      : [],
  };
}

export class MeetingStore {
  private readonly dir: string;
  private readonly log: Logger;
  private cache: Map<string, StoredMeeting> | null = null;

  constructor(dir: string, logger: Logger = silentLogger) {
    this.dir = dir;
    this.log = logger;
  }

  private file(id: string): string {
    if (!MEETING_ID.test(id)) throw new Error('bad meeting id');
    return join(this.dir, `${id}.json`);
  }

  private async load(): Promise<Map<string, StoredMeeting>> {
    if (this.cache) return this.cache;
    const map = new Map<string, StoredMeeting>();
    let names: string[] = [];
    try {
      names = await readdir(this.dir);
    } catch {
      // No library yet.
    }
    for (const name of names) {
      if (!/^m\d+\.json$/.test(name)) continue;
      try {
        const m = parseStoredMeeting(JSON.parse(await readFile(join(this.dir, name), 'utf8')));
        if (m) map.set(m.id, m);
        else this.log.warn('skipped unreadable meeting', { name });
      } catch (err) {
        this.log.warn('skipped unreadable meeting', { name, error: (err as Error).message });
      }
    }
    this.cache = map;
    return map;
  }

  async all(): Promise<StoredMeeting[]> {
    return [...(await this.load()).values()];
  }

  async get(id: string): Promise<StoredMeeting | null> {
    if (!MEETING_ID.test(id)) return null;
    return (await this.load()).get(id) ?? null;
  }

  async save(m: StoredMeeting): Promise<void> {
    const map = await this.load();
    await mkdir(this.dir, { recursive: true });
    const file = this.file(m.id);
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(m, null, 2) + '\n', 'utf8');
    await rename(tmp, file); // atomic replace, so a crash can't leave half a file
    map.set(m.id, m);
  }

  async delete(id: string): Promise<boolean> {
    const map = await this.load();
    if (!map.has(id)) return false;
    await rm(this.file(id), { force: true });
    map.delete(id);
    return true;
  }
}
