import { readFile, stat } from 'node:fs/promises';
import { parseCalendar, type CalendarEvent } from '../core/calendar/ics.ts';
import type { Logger } from '../core/util/logger.ts';
import type { CalendarView } from '../shared/calendar.ts';
import type { Settings } from '../shared/settings.ts';

const REFRESH_MS = 10 * 60_000;
const MAX_BYTES = 5_000_000;
const DAY = 86_400_000;

/** Signed-in calendar accounts (see accounts.ts). */
export interface AccountEvents {
  hasAccounts(): boolean;
  events(from: number, to: number): Promise<CalendarEvent[]>;
}

/**
 * The user's meetings for today and tomorrow, from signed-in Google/Microsoft accounts
 * and/or a private iCal link or .ics file, read-only, every ten minutes. Descriptions
 * stay in the main process; windows get titles, times and names.
 */
export class CalendarService {
  private events: CalendarEvent[] = [];
  private current: CalendarView = { configured: false, events: [] };
  private timer: ReturnType<typeof setInterval> | null = null;
  private run = 0;
  private readonly getSettings: () => Settings;
  private readonly onView: (view: CalendarView) => void;
  private readonly log: Logger;
  private readonly accounts?: AccountEvents;

  constructor(
    getSettings: () => Settings,
    onView: (view: CalendarView) => void,
    log: Logger,
    accounts?: AccountEvents,
  ) {
    this.getSettings = getSettings;
    this.onView = onView;
    this.log = log;
    this.accounts = accounts;
  }

  get view(): CalendarView {
    return this.current;
  }

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One occurrence, by the key the window sent back. */
  find(key: string): CalendarEvent | undefined {
    return this.events.find((e) => e.key === key);
  }

  async refresh(): Promise<CalendarView> {
    const run = ++this.run;
    const { calendarUrl, calendarFile } = this.getSettings();
    const hasIcs = !!(calendarUrl || calendarFile);
    const hasAccounts = this.accounts?.hasAccounts() ?? false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const from = today.getTime();
    const to = from + 2 * DAY;

    const sources: CalendarEvent[][] = [];
    let error: string | undefined;
    if (hasAccounts) {
      // Per-account problems are shown on the account (see AccountsService).
      sources.push(await this.accounts!.events(from, to));
    }
    if (hasIcs) {
      try {
        const text = calendarUrl ? await download(calendarUrl) : await readIcs(calendarFile);
        sources.push(parseCalendar(text, from, to));
      } catch (err) {
        this.log.warn('calendar could not be read', { error: (err as Error).message });
        error = (err as Error).message;
        // Keep the last good iCal events; say why they may be stale.
        sources.push(this.events.filter((e) => sourceOf(e.key) === 'ics'));
      }
    }
    const events = mergeEvents(sources);
    const view: CalendarView = {
      configured: hasIcs || hasAccounts,
      updatedAt: Date.now(),
      error,
      events: events.map((e) => ({
        key: e.key,
        title: e.title,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        attendees: e.attendees,
        joinUrl: e.joinUrl,
        hasAgenda: !!e.description,
        source: sourceOf(e.key),
      })),
    };
    if (run !== this.run) return this.current; // settings changed meanwhile
    this.events = events;
    this.current = view;
    this.onView(view);
    return view;
  }
}

/** "google:asha@x.com:abc123" → "google:asha@x.com"; an iCal key ("uid@123") → "ics". */
function sourceOf(key: string): string {
  const m = /^((?:google|microsoft):[^:]+):/.exec(key);
  return m ? m[1]! : 'ics';
}

/**
 * All sources in one list by start time. The same meeting from two sources (an account
 * and its own iCal link) is listed once: the first source wins.
 */
export function mergeEvents(sources: readonly (readonly CalendarEvent[])[]): CalendarEvent[] {
  const seen = new Set<string>();
  const out: CalendarEvent[] = [];
  for (const list of sources)
    for (const e of list) {
      const same = `${e.start}|${e.title.trim().toLowerCase()}`;
      if (seen.has(same)) continue;
      seen.add(same);
      out.push(e);
    }
  return out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}

async function download(link: string): Promise<string> {
  const url = link.replace(/^webcal:\/\//i, 'https://');
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'follow' });
  } catch (err) {
    throw new Error(`Could not reach the calendar link (${(err as Error).message}).`, {
      cause: err,
    });
  }
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403 || res.status === 404
        ? 'The calendar link was refused. Copy the private (secret) iCal address again.'
        : `The calendar link answered HTTP ${res.status}.`,
    );
  }
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('The calendar is over 5 MB.');
  if (!text.includes('BEGIN:VCALENDAR')) {
    throw new Error('That link is not an iCal calendar. Use the "iCal format" address.');
  }
  return text;
}

async function readIcs(path: string): Promise<string> {
  const size = (await stat(path)).size;
  if (size > MAX_BYTES) throw new Error('The calendar file is over 5 MB.');
  const text = await readFile(path, 'utf8');
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('That file is not an .ics calendar.');
  return text;
}
