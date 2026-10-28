/**
 * Google Calendar and Microsoft Graph events as Bolo calendar events (the same shape the
 * iCal parser produces). Pure: the main process does the requests.
 */
import type { CalendarEvent } from '../calendar/ics.ts';

const JOIN_LINK =
  /https:\/\/(?:meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s"<>\\]+/i;

/** HTML descriptions (both providers allow them) as plain text. */
export function plainText(v: string): string {
  return v
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

function uniqueNames(names: (string | undefined)[]): string[] {
  const out = new Map<string, string>();
  for (const n of names) {
    const name = n?.trim();
    if (name) out.set(name.toLowerCase(), name);
  }
  return [...out.values()];
}

/** "2026-10-28" (an all-day date) as local midnight. */
function localDate(d: string): number {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, day ?? 1).getTime();
}

export function googleEventsUrl(apiBase: string, from: number, to: number): string {
  const q = new URLSearchParams({
    timeMin: new Date(from).toISOString(),
    timeMax: new Date(to).toISOString(),
    singleEvents: 'true', // recurring meetings come as separate occurrences
    orderBy: 'startTime',
    maxResults: '100',
  });
  return `${apiBase}/calendars/primary/events?${q}`;
}

interface GPerson {
  email?: string;
  displayName?: string;
  resource?: boolean;
  responseStatus?: string;
}

/** Google Calendar `events.list` items. `source` is the account id. */
export function mapGoogleEvents(json: unknown, source: string): CalendarEvent[] {
  const items = ((json as { items?: unknown[] })?.items ?? []) as Record<string, unknown>[];
  const out: CalendarEvent[] = [];
  for (const it of items) {
    if (it['status'] === 'cancelled') continue;
    const start = it['start'] as { dateTime?: string; date?: string } | undefined;
    const end = it['end'] as { dateTime?: string; date?: string } | undefined;
    const allDay = !start?.dateTime && !!start?.date;
    const s = start?.dateTime
      ? Date.parse(start.dateTime)
      : start?.date
        ? localDate(start.date)
        : NaN;
    const e = end?.dateTime
      ? Date.parse(end.dateTime)
      : end?.date
        ? localDate(end.date)
        : s + 30 * 60_000;
    if (!Number.isFinite(s)) continue;
    const attendees = ((it['attendees'] as GPerson[] | undefined) ?? []).filter(
      (a) => !a.resource && a.responseStatus !== 'declined',
    );
    const organizer = it['organizer'] as GPerson | undefined;
    const description = plainText(String(it['description'] ?? ''));
    const conference = (
      it['conferenceData'] as { entryPoints?: { entryPointType?: string; uri?: string }[] }
    )?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri;
    const id = String(it['id'] ?? '');
    out.push({
      key: `${source}:${id}`,
      uid: id,
      title: String(it['summary'] ?? '').trim() || '(no title)',
      start: s,
      end: Number.isFinite(e) ? e : s + 30 * 60_000,
      allDay,
      description,
      attendees: uniqueNames(
        [organizer, ...attendees].map(
          (p) => p?.displayName || (p?.email ? nameFromEmail(p.email) : undefined),
        ),
      ),
      joinUrl:
        [it['hangoutLink'], conference].find(
          (u): u is string => typeof u === 'string' && u.startsWith('https://'),
        ) ?? JOIN_LINK.exec([it['location'], description].join(' '))?.[0],
    });
  }
  return out;
}

export function graphEventsUrl(apiBase: string, from: number, to: number): string {
  const q = new URLSearchParams({
    startDateTime: new Date(from).toISOString(),
    endDateTime: new Date(to).toISOString(),
    $top: '100',
    $orderby: 'start/dateTime',
    $select:
      'id,subject,start,end,isAllDay,isCancelled,attendees,organizer,bodyPreview,onlineMeeting,onlineMeetingUrl,location',
  });
  return `${apiBase}/me/calendarView?${q}`;
}

/** Ask Graph for times in UTC, so they parse without a time-zone table. */
export const GRAPH_HEADERS = { Prefer: 'outlook.timezone="UTC"' };

interface GraphPerson {
  emailAddress?: { name?: string; address?: string };
  type?: string;
  status?: { response?: string };
}

function graphTime(t: { dateTime?: string } | undefined): number {
  const v = t?.dateTime;
  if (!v) return NaN;
  // UTC (see GRAPH_HEADERS), sent without a zone suffix and with 7 fraction digits.
  return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : `${v.replace(/(\.\d{3})\d*$/, '$1')}Z`);
}

/** Microsoft Graph `calendarView` items. */
export function mapGraphEvents(json: unknown, source: string): CalendarEvent[] {
  const items = ((json as { value?: unknown[] })?.value ?? []) as Record<string, unknown>[];
  const out: CalendarEvent[] = [];
  for (const it of items) {
    if (it['isCancelled'] === true) continue;
    const allDay = it['isAllDay'] === true;
    const startRaw = it['start'] as { dateTime?: string } | undefined;
    const endRaw = it['end'] as { dateTime?: string } | undefined;
    const s = allDay
      ? localDate(String(startRaw?.dateTime ?? '').slice(0, 10))
      : graphTime(startRaw);
    const e = allDay ? localDate(String(endRaw?.dateTime ?? '').slice(0, 10)) : graphTime(endRaw);
    if (!Number.isFinite(s)) continue;
    const people = [
      it['organizer'] as GraphPerson,
      ...((it['attendees'] as GraphPerson[] | undefined) ?? []),
    ]
      .filter((p) => p && p.type !== 'resource' && p.status?.response !== 'declined')
      .map(
        (p) =>
          p.emailAddress?.name ||
          (p.emailAddress?.address ? nameFromEmail(p.emailAddress.address) : undefined),
      );
    const description = plainText(String(it['bodyPreview'] ?? ''));
    const online = (it['onlineMeeting'] as { joinUrl?: string } | null)?.joinUrl;
    const id = String(it['id'] ?? '');
    out.push({
      key: `${source}:${id}`,
      uid: id,
      title: String(it['subject'] ?? '').trim() || '(no title)',
      start: s,
      end: Number.isFinite(e) ? e : s + 30 * 60_000,
      allDay,
      description,
      attendees: uniqueNames(people),
      joinUrl:
        [online, it['onlineMeetingUrl']].find(
          (u): u is string => typeof u === 'string' && u.startsWith('https://'),
        ) ??
        JOIN_LINK.exec(
          [(it['location'] as { displayName?: string })?.displayName, description].join(' '),
        )?.[0],
    });
  }
  return out;
}
