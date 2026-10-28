import { describe, expect, it } from 'vitest';
import { parseCalendar, parseLines } from '../src/core/calendar/ics.ts';
import { meetingNow, startsInLabel } from '../src/shared/calendar.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

function cal(...events: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n');
}
function vevent(lines: string[]): string {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
}

describe('parseLines', () => {
  it('unfolds continuation lines and keeps colons inside quoted parameters', () => {
    const [p] = parseLines('ATTENDEE;CN="Mehta: Sales";ROLE=REQ\r\n -PARTICIPANT:mailto:m@x.com');
    expect(p).toEqual({
      name: 'ATTENDEE',
      params: { CN: 'Mehta: Sales', ROLE: 'REQ-PARTICIPANT' },
      value: 'mailto:m@x.com',
    });
  });
});

describe('parseCalendar', () => {
  const from = utc(2026, 10, 28);
  const to = from + 2 * DAY;

  it('reads a meeting: UTC time, title, description, people and join link', () => {
    const [e] = parseCalendar(
      cal(
        vevent([
          'UID:abc',
          'SUMMARY:Pricing review\\, Q4',
          'DTSTART:20261028T093000Z',
          'DTEND:20261028T101500Z',
          'DESCRIPTION:Agenda:\\n1. Rates<br>2. Delivery\\nJoin: https://meet.google.com/abc-defg-hij',
          'ORGANIZER;CN=Krunal Baraskar:mailto:krunal@x.com',
          'ATTENDEE;CN=Rohan Mehta;PARTSTAT=ACCEPTED:mailto:rohan@x.com',
          'ATTENDEE:mailto:priya.shah@x.com',
          'ATTENDEE;CUTYPE=ROOM;CN=Board room:mailto:room@x.com',
          'BEGIN:VALARM',
          'DESCRIPTION:Reminder',
          'END:VALARM',
        ]),
      ),
      from,
      to,
    );
    expect(e).toMatchObject({
      key: `abc@${utc(2026, 10, 28, 9, 30)}`,
      title: 'Pricing review, Q4',
      start: utc(2026, 10, 28, 9, 30),
      end: utc(2026, 10, 28, 10, 15),
      allDay: false,
      description: 'Agenda:\n1. Rates\n2. Delivery\nJoin: https://meet.google.com/abc-defg-hij',
      attendees: ['Krunal Baraskar', 'Rohan Mehta', 'Priya Shah'],
      joinUrl: 'https://meet.google.com/abc-defg-hij',
    });
  });

  it('converts zone times, Outlook zone names included', () => {
    const events = parseCalendar(
      cal(
        vevent([
          'UID:a',
          'SUMMARY:A',
          'DTSTART;TZID=Asia/Kolkata:20261028T150000',
          'DURATION:PT45M',
        ]),
        vevent(['UID:b', 'SUMMARY:B', 'DTSTART;TZID=India Standard Time:20261028T160000']),
        vevent(['UID:c', 'SUMMARY:C', 'DTSTART;TZID=America/New_York:20261028T080000']),
      ),
      from,
      to,
    );
    expect(events.map((e) => [e.title, e.start, e.end - e.start])).toEqual([
      ['A', utc(2026, 10, 28, 9, 30), 45 * 60_000],
      ['B', utc(2026, 10, 28, 10, 30), 30 * 60_000],
      ['C', utc(2026, 10, 28, 12), 30 * 60_000], // New York is UTC-4 in late October
    ]);
  });

  it('reads floating and all-day times as the computer’s local time', () => {
    const events = parseCalendar(
      cal(
        vevent(['UID:f', 'SUMMARY:Floating', 'DTSTART:20261028T110000']),
        vevent([
          'UID:d',
          'SUMMARY:Holiday',
          'DTSTART;VALUE=DATE:20261029',
          'DTEND;VALUE=DATE:20261030',
        ]),
      ),
      new Date(2026, 9, 28).getTime(),
      new Date(2026, 9, 30).getTime(),
    );
    expect(events.map((e) => [e.title, e.start, e.allDay])).toEqual([
      ['Floating', new Date(2026, 9, 28, 11).getTime(), false],
      ['Holiday', new Date(2026, 9, 29).getTime(), true],
    ]);
  });

  it('expands a weekly series that began years ago, with exceptions and a moved meeting', () => {
    const events = parseCalendar(
      cal(
        vevent([
          'UID:standup',
          'SUMMARY:Stand-up',
          'DTSTART:20220103T043000Z', // a Monday in 2022
          'DTEND:20220103T044500Z',
          'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,TH',
          'EXDATE:20261029T043000Z', // Thursday cancelled
        ]),
        vevent([
          'UID:standup',
          'RECURRENCE-ID:20261028T043000Z', // Wednesday moved an hour later
          'SUMMARY:Stand-up (moved)',
          'DTSTART:20261028T053000Z',
          'DTEND:20261028T054500Z',
        ]),
      ),
      utc(2026, 10, 26),
      utc(2026, 11, 2),
    );
    expect(events.map((e) => [e.title, new Date(e.start).toISOString()])).toEqual([
      ['Stand-up', '2026-10-26T04:30:00.000Z'],
      ['Stand-up (moved)', '2026-10-28T05:30:00.000Z'],
    ]);
  });

  it('stops a series at UNTIL or COUNT and skips cancelled events', () => {
    const events = parseCalendar(
      cal(
        vevent(['UID:d', 'SUMMARY:Daily', 'DTSTART:20261027T060000Z', 'RRULE:FREQ=DAILY;COUNT=2']),
        vevent([
          'UID:u',
          'SUMMARY:Until',
          'DTSTART:20261028T070000Z',
          'RRULE:FREQ=DAILY;INTERVAL=1;UNTIL=20261028T235959Z',
        ]),
        vevent(['UID:x', 'SUMMARY:Gone', 'STATUS:CANCELLED', 'DTSTART:20261028T080000Z']),
        vevent(['UID:m', 'SUMMARY:Monthly', 'DTSTART:20260929T090000Z', 'RRULE:FREQ=MONTHLY']),
      ),
      from,
      to,
    );
    expect(events.map((e) => e.title)).toEqual(['Daily', 'Until', 'Monthly']);
    expect(events.find((e) => e.title === 'Monthly')?.start).toBe(utc(2026, 10, 29, 9));
  });
});

describe('meetingNow', () => {
  const event = {
    key: 'k',
    title: 'Pricing',
    start: 10 * HOUR,
    end: 11 * HOUR,
    allDay: false,
    attendees: [],
    hasAgenda: false,
  };

  it('offers a meeting from ten minutes before it starts until it ends', () => {
    expect(meetingNow([event], 10 * HOUR - 11 * 60_000)).toBeNull();
    expect(meetingNow([event], 10 * HOUR - 3 * 60_000)).toEqual({ event, startsInMs: 180_000 });
    expect(meetingNow([event], 11 * HOUR)).toBeNull();
    expect(meetingNow([{ ...event, allDay: true }], 10 * HOUR)).toBeNull();
  });

  it('says when it starts', () => {
    expect(startsInLabel(180_000)).toBe('starts in 3 min');
    expect(startsInLabel(-20_000)).toBe('starting now');
    expect(startsInLabel(-5 * 60_000)).toBe('started 5 min ago');
  });
});

describe('meetingNow with dismissed meetings', () => {
  it('offers the next meeting when the first was waved away', () => {
    const base = { title: '', allDay: false, attendees: [], hasAgenda: false };
    const a = { ...base, key: 'a', start: 0, end: 30 * 60_000 };
    const b = { ...base, key: 'b', start: 5 * 60_000, end: 60 * 60_000 };
    expect(meetingNow([a, b], 60_000)?.event.key).toBe('a');
    expect(meetingNow([a, b], 60_000, new Set(['a']))?.event.key).toBe('b');
  });
});
