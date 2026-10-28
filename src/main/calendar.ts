import { readFile, stat } from 'node:fs/promises';
import { parseCalendar, type CalendarEvent } from '../core/calendar/ics.ts';
import type { Logger } from '../core/util/logger.ts';
import type { CalendarView } from '../shared/calendar.ts';
import type { Settings } from '../shared/settings.ts';

const REFRESH_MS = 10 * 60_000;
const MAX_BYTES = 5_000_000;
const DAY = 86_400_000;

/**
 * Reads the user's calendar (private iCal link or .ics file), read-only, every ten
 * minutes. Descriptions stay in the main process; windows get titles, times and names.
 */
export class CalendarService {
  private events: CalendarEvent[] = [];
  private current: CalendarView = { configured: false, events: [] };
  private timer: ReturnType<typeof setInterval> | null = null;
  private run = 0;
  private readonly getSettings: () => Settings;
  private readonly onView: (view: CalendarView) => void;
  private readonly log: Logger;

  constructor(getSettings: () => Settings, onView: (view: CalendarView) => void, log: Logger) {
    this.getSettings = getSettings;
    this.onView = onView;
    this.log = log;
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
    let view: CalendarView;
    let events: CalendarEvent[] = [];
    if (!calendarUrl && !calendarFile) {
      view = { configured: false, events: [] };
    } else {
      try {
        const text = calendarUrl ? await download(calendarUrl) : await readIcs(calendarFile);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        events = parseCalendar(text, today.getTime(), today.getTime() + 2 * DAY);
        view = {
          configured: true,
          updatedAt: Date.now(),
          events: events.map((e) => ({
            key: e.key,
            title: e.title,
            start: e.start,
            end: e.end,
            allDay: e.allDay,
            attendees: e.attendees,
            joinUrl: e.joinUrl,
            hasAgenda: !!e.description,
            source: 'ics',
          })),
        };
      } catch (err) {
        this.log.warn('calendar could not be read', { error: (err as Error).message });
        // Keep showing the last good list; say why it may be stale.
        view = { ...this.current, configured: true, error: (err as Error).message };
        events = this.events;
      }
    }
    if (run !== this.run) return this.current; // settings changed meanwhile
    this.events = events;
    this.current = view;
    this.onView(view);
    return view;
  }
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
