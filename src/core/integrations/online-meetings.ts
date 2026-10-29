/**
 * New video meetings on the user's own account: a Google Meet space (Meet REST API) or a
 * Teams meeting (Microsoft Graph). Pure: the main process does the requests.
 */
import type { AccountProvider } from '../../shared/integrations.ts';

export interface MeetingRequest {
  url: string;
  body: unknown;
}

/** `api` is the Meet API base for Google, the Graph base for Microsoft. */
export function newMeetingRequest(
  provider: AccountProvider,
  api: string,
  now: number,
): MeetingRequest {
  if (provider === 'google') return { url: `${api}/spaces`, body: {} };
  return {
    url: `${api}/me/onlineMeetings`,
    body: {
      subject: 'Meeting',
      startDateTime: new Date(now).toISOString(),
      endDateTime: new Date(now + 60 * 60_000).toISOString(),
    },
  };
}

/** The join link from the create response, or null if it has none. */
export function meetingLink(provider: AccountProvider, json: unknown): string | null {
  const j = json as { meetingUri?: unknown; joinWebUrl?: unknown; joinUrl?: unknown } | null;
  const link = provider === 'google' ? j?.meetingUri : (j?.joinWebUrl ?? j?.joinUrl);
  return typeof link === 'string' && link.startsWith('https://') ? link : null;
}
