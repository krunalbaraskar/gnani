/**
 * Just enough iCalendar (RFC 5545) to list the user's meetings: events with their time,
 * title, description, attendees and join link; time zones; and the recurrence rules
 * calendars actually use for meetings (daily, weekly on given days, monthly on a date,
 * with interval, count, until, exceptions and moved occurrences). Pure: no I/O.
 */

export interface CalendarEvent {
  /** UID plus start, unique per occurrence. */
  key: string;
  uid: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  description: string;
  /** Display names (or email names) of the people invited, organiser included. */
  attendees: string[];
  /** A Meet / Zoom / Teams link, if the invite has one. */
  joinUrl?: string;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface Stamp {
  wall: { y: number; mo: number; d: number; h: number; mi: number; s: number };
  /** "Z" = UTC, an IANA zone, or "" = the computer's own time. */
  zone: string;
  allDay: boolean;
}

/** Outlook writes Windows zone names; these are the ones Indian users meet with most. */
const WINDOWS_ZONES: Record<string, string> = {
  'India Standard Time': 'Asia/Kolkata',
  UTC: 'UTC',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Singapore Standard Time': 'Asia/Singapore',
  'Arabian Standard Time': 'Asia/Dubai',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'Sri Lanka Standard Time': 'Asia/Colombo',
  'Nepal Standard Time': 'Asia/Kathmandu',
  'Bangladesh Standard Time': 'Asia/Dhaka',
};

function validZone(zone: string): string {
  const z = WINDOWS_ZONES[zone] ?? zone.replace(/^\/+/, '');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return z;
  } catch {
    return ''; // unknown: treat as the computer's own time
  }
}

/** Milliseconds a zone is ahead of UTC at `utc`. */
function zoneOffset(utc: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(utc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return (
    Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) -
    utc
  );
}

function toEpoch(s: Stamp): number {
  const { y, mo, d, h, mi, s: sec } = s.wall;
  if (s.zone === 'Z') return Date.UTC(y, mo - 1, d, h, mi, sec);
  if (!s.zone || s.allDay) return new Date(y, mo - 1, d, h, mi, sec).getTime();
  const guess = Date.UTC(y, mo - 1, d, h, mi, sec);
  // Twice, so a time near a daylight-saving change settles on the right offset.
  const first = guess - zoneOffset(guess, s.zone);
  return guess - zoneOffset(first, s.zone);
}

function parseStamp(p: Prop): Stamp | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(p.value.trim());
  if (!m) return null;
  const allDay = !m[4] || p.params['VALUE'] === 'DATE';
  return {
    wall: {
      y: +m[1]!,
      mo: +m[2]!,
      d: +m[3]!,
      h: allDay ? 0 : +m[4]!,
      mi: allDay ? 0 : +m[5]!,
      s: allDay ? 0 : +m[6]!,
    },
    zone: m[7] ? 'Z' : validZone(p.params['TZID'] ?? ''),
    allDay,
  };
}

/** The same wall-clock time `days` later (calendar arithmetic, no time zone). */
function addDays(s: Stamp, days: number): Stamp {
  const d = new Date(Date.UTC(s.wall.y, s.wall.mo - 1, s.wall.d + days));
  return {
    ...s,
    wall: { ...s.wall, y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate() },
  };
}

function addMonths(s: Stamp, months: number): Stamp | null {
  const d = new Date(Date.UTC(s.wall.y, s.wall.mo - 1 + months, s.wall.d));
  // "The 31st of every month" skips months without one.
  if (d.getUTCDate() !== s.wall.d) return null;
  return { ...s, wall: { ...s.wall, y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1 } };
}

const weekday = (s: Stamp) => new Date(Date.UTC(s.wall.y, s.wall.mo - 1, s.wall.d)).getUTCDay();
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** Unfolds continuation lines and splits each into name, parameters and value. */
export function parseLines(text: string): Prop[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
  const out: Prop[] = [];
  for (const line of lines) {
    // The value starts at the first colon outside a quoted parameter.
    let quoted = false;
    let colon = -1;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') quoted = !quoted;
      else if (line[i] === ':' && !quoted) {
        colon = i;
        break;
      }
    }
    if (colon < 0) continue;
    const [name = '', ...rawParams] = line.slice(0, colon).split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    const params: Record<string, string> = {};
    for (const p of rawParams) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
    }
    out.push({ name: name.toUpperCase(), params, value: line.slice(colon + 1) });
  }
  return out;
}

function personName(p: Prop): string | null {
  const type = (p.params['CUTYPE'] ?? '').toUpperCase();
  if (type === 'ROOM' || type === 'RESOURCE') return null;
  const cn = p.params['CN']?.trim();
  if (cn && !cn.includes('@')) return cn;
  const email = (cn ?? p.value).replace(/^mailto:/i, '').trim();
  const local = email.split('@')[0] ?? '';
  // "rohan.mehta" → "Rohan Mehta"
  return local
    ? local
        .split(/[._-]+/)
        .filter(Boolean)
        .map((w) => w[0]!.toUpperCase() + w.slice(1))
        .join(' ')
    : null;
}

const JOIN_LINK =
  /https:\/\/(?:meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s"<>\\]+/i;

function plainText(v: string): string {
  return unescapeText(v)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface RawEvent {
  props: Prop[];
}

function get(e: RawEvent, name: string): Prop | undefined {
  return e.props.find((p) => p.name === name);
}

/**
 * Every occurrence that overlaps [from, to), sorted by start. Cancelled events and
 * cancelled or moved occurrences are handled; all-day events are kept but marked.
 */
export function parseCalendar(text: string, from: number, to: number): CalendarEvent[] {
  const raw: RawEvent[] = [];
  let cur: RawEvent | null = null;
  let depth = 0; // VALARM and other blocks nested inside an event are skipped
  for (const p of parseLines(text)) {
    if (p.name === 'BEGIN' && p.value.toUpperCase() === 'VEVENT') {
      cur = { props: [] };
      depth = 0;
    } else if (cur && p.name === 'BEGIN') depth++;
    else if (cur && p.name === 'END' && depth > 0) depth--;
    else if (cur && p.name === 'END' && p.value.toUpperCase() === 'VEVENT') {
      raw.push(cur);
      cur = null;
    } else if (cur && depth === 0) cur.props.push(p);
  }

  // Occurrences moved or cancelled one at a time: UID → original starts.
  const overridden = new Map<string, Set<number>>();
  for (const e of raw) {
    const rid = get(e, 'RECURRENCE-ID');
    const uid = get(e, 'UID')?.value ?? '';
    const stamp = rid && parseStamp(rid);
    if (stamp) {
      if (!overridden.has(uid)) overridden.set(uid, new Set());
      overridden.get(uid)!.add(toEpoch(stamp));
    }
  }

  const out: CalendarEvent[] = [];
  for (const e of raw) {
    if ((get(e, 'STATUS')?.value ?? '').toUpperCase() === 'CANCELLED') continue;
    const startProp = get(e, 'DTSTART');
    const start = startProp && parseStamp(startProp);
    if (!start) continue;
    const endProp = get(e, 'DTEND');
    const endStamp = endProp && parseStamp(endProp);
    const length = endStamp
      ? toEpoch(endStamp) - toEpoch(start)
      : start.allDay
        ? 86_400_000
        : (parseDuration(get(e, 'DURATION')?.value ?? '') ?? 30 * 60_000);
    const uid = get(e, 'UID')?.value ?? '';
    const description = plainText(get(e, 'DESCRIPTION')?.value ?? '');
    const people = e.props
      .filter((p) => p.name === 'ATTENDEE' || p.name === 'ORGANIZER')
      .map(personName)
      .filter((n): n is string => !!n);
    const base = {
      uid,
      title: unescapeText(get(e, 'SUMMARY')?.value ?? '').trim() || '(no title)',
      allDay: start.allDay,
      description,
      attendees: [...new Map(people.map((n) => [n.toLowerCase(), n])).values()],
      joinUrl: JOIN_LINK.exec(
        [get(e, 'URL')?.value, get(e, 'LOCATION')?.value, description].join(' '),
      )?.[0],
    };
    const excluded = new Set(
      e.props
        .filter((p) => p.name === 'EXDATE')
        .flatMap((p) => p.value.split(',').map((v) => parseStamp({ ...p, value: v })))
        .filter((s): s is Stamp => !!s)
        .map(toEpoch),
    );
    const isOverride = !!get(e, 'RECURRENCE-ID');
    const rrule = isOverride ? undefined : get(e, 'RRULE')?.value;
    const moved = isOverride ? undefined : overridden.get(uid);
    for (const occ of occurrences(start, rrule, from, to)) {
      const s = toEpoch(occ);
      if (excluded.has(s) || moved?.has(s)) continue;
      if (s + length <= from || s >= to) continue;
      out.push({ ...base, key: `${uid}@${s}`, start: s, end: s + length });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}

function parseDuration(v: string): number | null {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const [w = 0, d = 0, h = 0, mi = 0, s = 0] = m.slice(1).map((x) => Number(x ?? 0));
  return ((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + s) * 1000;
}

/** Start stamps of a series, from the first, until `to` (or the rule ends). */
function* occurrences(
  start: Stamp,
  rrule: string | undefined,
  from: number,
  to: number,
): Generator<Stamp> {
  if (!rrule) {
    yield start;
    return;
  }
  const rule = Object.fromEntries(
    rrule.split(';').map((kv) => {
      const [k = '', v = ''] = kv.split('=');
      return [k.toUpperCase(), v.toUpperCase()];
    }),
  );
  const freq = rule['FREQ'];
  const interval = Math.max(1, Number(rule['INTERVAL']) || 1);
  const count = Number(rule['COUNT']) || Infinity;
  const untilStamp = rule['UNTIL']
    ? parseStamp({ name: 'UNTIL', params: {}, value: rule['UNTIL'] })
    : null;
  const until = untilStamp
    ? toEpoch(untilStamp.zone ? untilStamp : { ...untilStamp, zone: start.zone })
    : Infinity;
  const byDay = (rule['BYDAY'] ?? '')
    .split(',')
    .map((d) => DAYS.indexOf(d.slice(-2)))
    .filter((d) => d >= 0);

  let n = 0;
  const emit = function* (s: Stamp) {
    const t = toEpoch(s);
    if (t > until || n >= count) return false;
    n++;
    yield s;
    return true;
  };
  // A long-running series without a count starts near `from` instead of at its first
  // meeting (a daily stand-up from 2022 is still listed today). Months are counted as 31
  // days, so the skip never goes past `from`.
  const DAY = 86_400_000;
  const period = { DAILY: 1, WEEKLY: 7, MONTHLY: 31 }[freq as string] ?? 0;
  const behind = from - toEpoch(start);
  const first =
    count === Infinity && period && behind > 0
      ? Math.max(0, Math.floor(behind / (period * interval * DAY)) - 1)
      : 0;
  // A guard against runaway rules: at most ~3 years of daily occurrences after `first`.
  for (let step = first; step < first + 1100; step++) {
    if (freq === 'DAILY') {
      const s = addDays(start, step * interval);
      if (toEpoch(s) >= to) return;
      if (!(yield* emit(s))) return;
    } else if (freq === 'WEEKLY') {
      const weekStart = addDays(start, step * 7 * interval - weekday(start));
      if (toEpoch(weekStart) >= to) return;
      const days = byDay.length ? [...byDay].sort((a, b) => a - b) : [weekday(start)];
      for (const d of days) {
        const s = addDays(weekStart, d);
        if (toEpoch(s) < toEpoch(start)) continue;
        if (!(yield* emit(s))) return;
      }
    } else if (freq === 'MONTHLY' && !byDay.length) {
      const s = addMonths(start, step * interval);
      if (!s) continue;
      if (toEpoch(s) >= to) return;
      if (!(yield* emit(s))) return;
    } else {
      // Yearly and "second Tuesday of the month" rules: show the first occurrence only.
      yield start;
      return;
    }
  }
}
