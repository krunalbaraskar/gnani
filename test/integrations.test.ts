import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  googleCalendarIds,
  googleEventsUrl,
  graphEventsUrl,
  mapGoogleEvents,
  mapGraphEvents,
  plainText,
} from '../src/core/integrations/events.ts';
import { parseMicUsage } from '../src/core/integrations/mic-usage.ts';
import {
  authorizeUrl,
  callbackPage,
  codeExchangeBody,
  googleConfig,
  identityFromIdToken,
  microsoftConfig,
  parseTokens,
  pkcePair,
  refreshBody,
} from '../src/core/integrations/oauth.ts';
import { listActionItems, setActionItemDone } from '../src/core/meetings/actions.ts';
import { newMeeting } from '../src/core/meetings/store.ts';
import { mergeEvents } from '../src/main/calendar.ts';

const jwt = (claims: object) =>
  `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

describe('OAuth helpers', () => {
  it('makes a PKCE pair whose challenge is the SHA-256 of the verifier', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[\w-]{43,128}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(pkcePair().verifier).not.toBe(verifier);
  });

  it('builds Google and Microsoft sign-in URLs for a loopback redirect', () => {
    const g = new URL(
      authorizeUrl(googleConfig('gid', 'gsecret'), 'http://127.0.0.1:5000', 'st', 'ch'),
    );
    expect(g.origin + g.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(g.searchParams)).toMatchObject({
      client_id: 'gid',
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:5000',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      access_type: 'offline',
    });
    expect(g.searchParams.get('scope')).toContain('calendar.events.readonly');
    expect(g.toString()).not.toContain('gsecret');

    const ms = microsoftConfig('mid');
    expect(ms.loopbackHost).toBe('localhost');
    const m = new URL(authorizeUrl(ms, 'http://localhost:5000', 'st', 'ch'));
    expect(m.origin + m.pathname).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    );
    expect(m.searchParams.get('scope')).toContain('Calendars.Read');
    expect(m.searchParams.get('scope')).toContain('offline_access');
  });

  it('sends the verifier with the code, and the secret only to Google', () => {
    const g = codeExchangeBody(googleConfig('gid', 'gsecret'), 'c0de', 'ver', 'http://127.0.0.1:1');
    expect(Object.fromEntries(g)).toMatchObject({
      grant_type: 'authorization_code',
      code: 'c0de',
      code_verifier: 'ver',
      client_secret: 'gsecret',
    });
    expect(refreshBody(microsoftConfig('mid'), 'r1').has('client_secret')).toBe(false);
  });

  it('reads token replies, keeping the old refresh token when a refresh omits it', () => {
    expect(parseTokens({ access_token: 'a', refresh_token: 'r', expires_in: 60 }, 1000)).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 61_000,
    });
    expect(parseTokens({ access_token: 'b' }, 0, 'r').refreshToken).toBe('r');
    expect(() => parseTokens({ error: 'invalid_grant', error_description: 'expired' }, 0)).toThrow(
      'Sign-in was refused (invalid_grant: expired)',
    );
    expect(() => parseTokens({ access_token: 'a' }, 0)).toThrow(/no refresh token/);
  });

  it('labels the account from the ID token', () => {
    expect(identityFromIdToken(jwt({ email: 'Asha@Example.com', name: 'Asha' }))).toEqual({
      email: 'asha@example.com',
      name: 'Asha',
    });
    expect(identityFromIdToken(jwt({ preferred_username: 'r@contoso.com' }))?.email).toBe(
      'r@contoso.com',
    );
    expect(identityFromIdToken(jwt({ sub: '1' }))).toBeNull();
    expect(identityFromIdToken('garbage')).toBeNull();
  });

  it('shows a plain page after the redirect, with no script', () => {
    expect(callbackPage(true)).toContain('Echo is connected');
    expect(callbackPage(false)).not.toMatch(/<script/i);
  });
});

describe('calendar events from accounts', () => {
  it('maps Google events: people, join link, all-day, cancelled', () => {
    const events = mapGoogleEvents(
      {
        items: [
          {
            id: 'e1',
            summary: 'Mehta follow-up',
            start: { dateTime: '2026-10-28T15:00:00+05:30' },
            end: { dateTime: '2026-10-28T15:30:00+05:30' },
            description: 'Agenda:<br>confirm &amp; close',
            organizer: { email: 'krunal@x.com', displayName: 'Krunal' },
            attendees: [
              { email: 'rohan.mehta@mehta.com', responseStatus: 'accepted' },
              { email: 'room@x.com', resource: true },
              { email: 'no@x.com', displayName: 'Declined', responseStatus: 'declined' },
              { email: 'krunal@x.com', displayName: 'Krunal' },
            ],
            hangoutLink: 'https://meet.google.com/abc-defg-hij',
          },
          { id: 'e2', status: 'cancelled', start: { dateTime: '2026-10-28T16:00:00Z' } },
          {
            id: 'e3',
            summary: 'Holiday',
            start: { date: '2026-10-29' },
            end: { date: '2026-10-30' },
          },
        ],
      },
      'google:krunal@x.com',
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      key: 'google:krunal@x.com:e1',
      uid: 'e1',
      title: 'Mehta follow-up',
      start: Date.UTC(2026, 9, 28, 9, 30),
      end: Date.UTC(2026, 9, 28, 10),
      allDay: false,
      description: 'Agenda:\nconfirm & close',
      attendees: ['Krunal', 'Rohan Mehta'],
      joinUrl: 'https://meet.google.com/abc-defg-hij',
    });
    expect(events[1]).toMatchObject({ allDay: true, start: new Date(2026, 9, 29).getTime() });
  });

  it('maps Microsoft Graph events given in UTC without a zone suffix', () => {
    const [e] = mapGraphEvents(
      {
        value: [
          {
            id: 'AAMk1',
            subject: 'Weekly sync',
            start: { dateTime: '2026-10-28T09:30:00.0000000', timeZone: 'UTC' },
            end: { dateTime: '2026-10-28T10:00:00.0000000', timeZone: 'UTC' },
            organizer: { emailAddress: { name: 'Priya Shah', address: 'priya@contoso.com' } },
            attendees: [
              { type: 'required', emailAddress: { address: 'rohan@contoso.com' } },
              { type: 'resource', emailAddress: { name: 'Room 4' } },
            ],
            bodyPreview: 'Numbers for Q4',
            onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' },
          },
          {
            id: 'x',
            subject: 'Gone',
            isCancelled: true,
            start: { dateTime: '2026-10-28T11:00:00' },
          },
        ],
      },
      'microsoft:priya@contoso.com',
    );
    expect(e).toMatchObject({
      key: 'microsoft:priya@contoso.com:AAMk1',
      start: Date.UTC(2026, 9, 28, 9, 30),
      end: Date.UTC(2026, 9, 28, 10),
      attendees: ['Priya Shah', 'Rohan'],
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
    });
  });

  it('asks for single occurrences in the window', () => {
    const g = new URL(googleEventsUrl('https://api/cal', 0, 86_400_000));
    expect(g.searchParams.get('singleEvents')).toBe('true');
    expect(g.searchParams.get('timeMax')).toBe('1970-01-02T00:00:00.000Z');
    expect(new URL(graphEventsUrl('https://graph/v1.0', 0, 1)).pathname).toBe(
      '/v1.0/me/calendarView',
    );
  });

  it('reads every calendar ticked in Google Calendar, not just the primary', () => {
    const ids = googleCalendarIds({
      items: [
        { id: 'me@x.com', primary: true },
        { id: 'skyeasy@group.calendar.google.com', selected: true },
        { id: 'holidays@group.v.calendar.google.com' },
        { id: 'en.indian#holiday@group.v.calendar.google.com', selected: true },
        { id: 'old@group.calendar.google.com', selected: true, hidden: true },
      ],
    });
    expect(ids).toEqual(['me@x.com', 'skyeasy@group.calendar.google.com']);
    expect(googleCalendarIds({})).toEqual(['primary']);
    expect(new URL(googleEventsUrl('https://api/cal', 0, 1, 'a#b@x.com')).pathname).toBe(
      '/cal/calendars/a%23b%40x.com/events',
    );
  });

  it('strips HTML from descriptions', () => {
    expect(plainText('<p>Hi</p><p>there&nbsp;<b>you</b></p>')).toBe('Hi\nthere you');
  });

  it('merges sources by time and lists a meeting seen twice once', () => {
    const base = { uid: '', end: 0, allDay: false, description: '', attendees: [] };
    const merged = mergeEvents([
      [{ ...base, key: 'google:a:1', title: 'Sync', start: 2 }],
      [
        { ...base, key: 'ics1', title: 'sync ', start: 2 },
        { ...base, key: 'ics2', title: 'Early', start: 1 },
      ],
    ]);
    expect(merged.map((e) => e.key)).toEqual(['ics2', 'google:a:1']);
  });
});

describe('meetings detected from microphone use', () => {
  // Captured from `reg query …\microphone /s` on Windows 11, shortened.
  const reg = (zoomStop: string, chromeStop: string) =>
    [
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\5319275A.WhatsAppDesktop_cv1g1gvanyjgm',
      '    LastUsedTimeStart    REG_QWORD    0x1dd6574ea1945cf',
      '    LastUsedTimeStop    REG_QWORD    0x1dd65792e39b9db',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Program Files#Google#Chrome#Application#chrome.exe',
      '    LastUsedTimeStart    REG_QWORD    0x1dd66426f69034e',
      `    LastUsedTimeStop    REG_QWORD    ${chromeStop}`,
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Users#a#AppData#Roaming#Zoom#bin#Zoom.exe',
      '    LastUsedTimeStart    REG_QWORD    0x1dd66426f69034e',
      `    LastUsedTimeStop    REG_QWORD    ${zoomStop}`,
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\E:#gnani#node_modules#electron#dist#electron.exe',
      '    LastUsedTimeStart    REG_QWORD    0x1dd66426f69034e',
      '    LastUsedTimeStop    REG_QWORD    0x0',
    ].join('\r\n');

  it('reports apps using the mic now, meeting apps first, never Echo itself', () => {
    const users = parseMicUsage(reg('0x0', '0x0'), [
      'E:\\gnani\\node_modules\\electron\\dist\\electron.exe',
    ]);
    expect(users.map((u) => u.app)).toEqual(['Zoom', 'Google Chrome']);
  });

  it('reports nothing when every app has let go of the mic', () => {
    expect(
      parseMicUsage(reg('0x1dd66', '0x1dd67'), [
        'E:\\gnani\\node_modules\\electron\\dist\\electron.exe',
      ]),
    ).toEqual([]);
  });
});

describe('action items across meetings', () => {
  const MD =
    '# T\n## Key points\n- [ ] not one\n## Action items\n- [ ] **Me** — send quote\n- [x] **Rohan** — share rates\n## Next steps\n- call';
  const meeting = (startedAt: number) => ({
    ...newMeeting({
      startedAt,
      sttLanguage: 'hi-IN',
      outputLanguage: 'same',
      contextNote: '',
      audioMode: 'live',
      segments: [],
      suggestions: [],
      echoesRemoved: 0,
    }),
    title: `M${startedAt}`,
    minutes: { markdown: MD, generatedAt: 0, edited: false, unverifiedFigures: [] },
  });

  it('lists open items first, newest meeting first', () => {
    const items = listActionItems([meeting(1_790_000_000_000), meeting(1_790_000_100_000)]);
    expect(items.map((i) => [i.meetingTitle, i.index, i.done])).toEqual([
      ['M1790000100000', 0, false],
      ['M1790000000000', 0, false],
      ['M1790000100000', 1, true],
      ['M1790000000000', 1, true],
    ]);
    expect(items[0]).toMatchObject({ owner: 'Me', text: 'send quote' });
  });

  it('ticks only the chosen box inside the Action items section', () => {
    expect(setActionItemDone(MD, 0, true)).toBe(MD.replace('- [ ] **Me**', '- [x] **Me**'));
    expect(setActionItemDone(MD, 1, false)).toBe(MD.replace('- [x] **Rohan**', '- [ ] **Rohan**'));
    expect(setActionItemDone(MD, 2, true)).toBeNull();
  });
});
