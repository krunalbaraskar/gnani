/**
 * Calendar accounts (Google, Microsoft) and meetings noticed on this computer, as the
 * windows see them. Tokens never leave the main process. Types only.
 */

export type AccountProvider = 'google' | 'microsoft';

export interface AccountView {
  /** Stable id, e.g. "google:asha@gmail.com". */
  id: string;
  provider: AccountProvider;
  email: string;
  name?: string;
  /** Set when the last calendar read failed (e.g. access revoked); reconnect fixes it. */
  error?: string;
}

export interface IntegrationsView {
  accounts: AccountView[];
  /**
   * Which sign-ins this build can offer: a provider needs its OAuth client id in .env
   * (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET, MICROSOFT_CLIENT_ID).
   */
  available: Record<AccountProvider, boolean>;
}

export type ConnectResult = { ok: true; account: AccountView } | { ok: false; error: string };

/** A new Google Meet / Teams meeting: its join link, or why it could not be made. */
export type NewMeetingResult = { ok: true; url: string } | { ok: false; error: string };

/** A call noticed on this computer: another app is using the microphone. */
export interface DetectedMeeting {
  /** Changes when a new call starts, so a dismissed one does not hide the next. */
  key: string;
  /** e.g. "Zoom", "Microsoft Teams", "Google Chrome" (a Meet tab), "Slack". */
  app: string;
  since: number;
}

/** A to-do the user added by hand on the To do page (not from any meeting). */
export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

/** One action item from a meeting's minutes, for the dashboard's to-do list. */
export interface ActionItemView {
  meetingId: string;
  meetingTitle: string;
  meetingStartedAt: number;
  /** Position among the meeting's action items; what toggleActionItem sends back. */
  index: number;
  owner?: string;
  text: string;
  done: boolean;
}
