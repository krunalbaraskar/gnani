import { describe, expect, it } from 'vitest';
import { googleConfig, microsoftConfig } from '../src/core/integrations/oauth.ts';
import { meetingLink, newMeetingRequest } from '../src/core/integrations/online-meetings.ts';

describe('new online meetings', () => {
  it('creates a Meet space, or a one-hour Teams meeting from now', () => {
    expect(newMeetingRequest('google', 'https://meet/v2', 0)).toEqual({
      url: 'https://meet/v2/spaces',
      body: {},
    });
    const teams = newMeetingRequest('microsoft', 'https://graph/v1.0', 0);
    expect(teams.url).toBe('https://graph/v1.0/me/onlineMeetings');
    expect(teams.body).toMatchObject({
      startDateTime: '1970-01-01T00:00:00.000Z',
      endDateTime: '1970-01-01T01:00:00.000Z',
    });
  });

  it('takes only an https join link from the reply', () => {
    expect(meetingLink('google', { meetingUri: 'https://meet.google.com/abc-defg-hij' })).toBe(
      'https://meet.google.com/abc-defg-hij',
    );
    expect(meetingLink('microsoft', { joinWebUrl: 'https://teams.microsoft.com/l/x' })).toBe(
      'https://teams.microsoft.com/l/x',
    );
    expect(meetingLink('google', { meetingUri: 'javascript:alert(1)' })).toBeNull();
    expect(meetingLink('microsoft', {})).toBeNull();
  });

  it('asks only for meetings Echo creates', () => {
    expect(googleConfig('id', 'secret').scopes).toContain(
      'https://www.googleapis.com/auth/meetings.space.created',
    );
    expect(microsoftConfig('id').scopes).toContain('OnlineMeetings.ReadWrite');
  });
});
