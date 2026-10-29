/** The user's calendar as the windows see it. Types and pure helpers only. */

export interface CalendarEventView {
  /** Unique per occurrence; what "Start with Echo" sends back. */
  key: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  attendees: string[];
  joinUrl?: string;
  /** The invite has a description, which becomes the meeting's agenda. */
  hasAgenda: boolean;
  /** Where it came from: a signed-in account ("google:asha@gmail.com"), or "ics". */
  source: string;
}

export interface CalendarView {
  /** A calendar link or file is set. */
  configured: boolean;
  /** Today and tomorrow. */
  events: CalendarEventView[];
  updatedAt?: number;
  error?: string;
}

/** Offered from this long before a meeting starts until it ends. */
export const STARTING_SOON_MS = 10 * 60_000;

/**
 * The meeting to offer now: one that is on, or starts within ten minutes, and that the
 * user has not waved away (so the next of two back-to-back meetings still shows).
 */
export function meetingNow(
  events: readonly CalendarEventView[],
  now: number,
  skip: ReadonlySet<string> = new Set(),
): { event: CalendarEventView; startsInMs: number } | null {
  const event = events.find(
    (e) => !e.allDay && !skip.has(e.key) && e.start - STARTING_SOON_MS <= now && now < e.end,
  );
  return event ? { event, startsInMs: event.start - now } : null;
}

/** "45 min", "2 h", "21 h 43 min". */
function duration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function startsInLabel(ms: number): string {
  if (ms <= 0)
    return ms > -60_000 ? 'starting now' : `started ${duration(Math.round(-ms / 60_000))} ago`;
  return `starts in ${duration(Math.ceil(ms / 60_000))}`;
}
