/**
 * Sign-in to Google and Microsoft calendars for a desktop app: OAuth 2.0 authorization
 * code flow with PKCE and a loopback redirect (RFC 8252). Pure helpers; the main process
 * runs the browser round trip and stores the tokens.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { AccountProvider } from '../../shared/integrations.ts';

export interface ProviderConfig {
  provider: AccountProvider;
  clientId: string;
  /** Google's "Desktop app" clients have one (it is not secret for installed apps). */
  clientSecret?: string;
  authUrl: string;
  tokenUrl: string;
  /** Calendar API base, e.g. https://www.googleapis.com/calendar/v3. */
  apiBase: string;
  scopes: string[];
  extraAuthParams: Record<string, string>;
  /** Where the redirect lands: Google takes 127.0.0.1, Microsoft wants "localhost". */
  loopbackHost: '127.0.0.1' | 'localhost';
}

/** `base` replaces the real endpoints in development and tests (a local mock). */
export function googleConfig(
  clientId: string,
  clientSecret: string,
  base?: string,
): ProviderConfig {
  return {
    provider: 'google',
    clientId,
    clientSecret,
    authUrl: base ? `${base}/google/auth` : 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: base ? `${base}/google/token` : 'https://oauth2.googleapis.com/token',
    apiBase: base ? `${base}/google/calendar/v3` : 'https://www.googleapis.com/calendar/v3',
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/calendar.events.readonly',
    ],
    // A refresh token, every time, so the user does not have to sign in again tomorrow.
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    loopbackHost: '127.0.0.1',
  };
}

export function microsoftConfig(
  clientId: string,
  tenant = 'common',
  base?: string,
): ProviderConfig {
  const login = base
    ? `${base}/microsoft`
    : `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  return {
    provider: 'microsoft',
    clientId,
    authUrl: `${login}/authorize`,
    tokenUrl: `${login}/token`,
    apiBase: base ? `${base}/microsoft/graph/v1.0` : 'https://graph.microsoft.com/v1.0',
    scopes: ['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Calendars.Read'],
    extraAuthParams: { prompt: 'select_account' },
    loopbackHost: 'localhost',
  };
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

export function randomState(): string {
  return base64url(randomBytes(24));
}

export function authorizeUrl(
  cfg: ProviderConfig,
  redirectUri: string,
  state: string,
  challenge: string,
): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: cfg.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...cfg.extraAuthParams,
  });
  return `${cfg.authUrl}?${params}`;
}

export function codeExchangeBody(
  cfg: ProviderConfig,
  code: string,
  verifier: string,
  redirectUri: string,
): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cfg.clientId,
    ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    ...(cfg.provider === 'microsoft' ? { scope: cfg.scopes.join(' ') } : {}),
  });
}

export function refreshBody(cfg: ProviderConfig, refreshToken: string): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: cfg.clientId,
    ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
    refresh_token: refreshToken,
    ...(cfg.provider === 'microsoft' ? { scope: cfg.scopes.join(' ') } : {}),
  });
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
}

/**
 * A token endpoint reply. A refresh reply may leave out the refresh token (Google), so
 * the previous one is kept.
 */
export function parseTokens(json: unknown, now: number, previousRefresh = ''): TokenSet {
  const j = (json ?? {}) as Record<string, unknown>;
  if (typeof j['error'] === 'string') {
    const detail = typeof j['error_description'] === 'string' ? `: ${j['error_description']}` : '';
    throw new Error(`Sign-in was refused (${j['error']}${detail})`);
  }
  const accessToken = typeof j['access_token'] === 'string' ? j['access_token'] : '';
  const refreshToken =
    typeof j['refresh_token'] === 'string' ? j['refresh_token'] : previousRefresh;
  if (!accessToken) throw new Error('Sign-in reply had no access token');
  if (!refreshToken) throw new Error('Sign-in reply had no refresh token; please try again');
  const expiresIn = Number(j['expires_in']) || 3600;
  return { accessToken, refreshToken, expiresAt: now + expiresIn * 1000 };
}

/**
 * Who signed in, from the ID token the token endpoint just sent over TLS. Read, not
 * verified: it only labels the account in the UI and is never used to grant anything.
 */
export function identityFromIdToken(idToken: unknown): { email: string; name?: string } | null {
  if (typeof idToken !== 'string') return null;
  const payload = idToken.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const email = [claims['email'], claims['preferred_username'], claims['upn']].find(
      (v): v is string => typeof v === 'string' && v.includes('@'),
    );
    if (!email) return null;
    const name = typeof claims['name'] === 'string' ? claims['name'] : undefined;
    return { email: email.toLowerCase(), name };
  } catch {
    return null;
  }
}

/** The page the browser shows after the redirect. No script; nothing from the URL is echoed. */
export function callbackPage(ok: boolean): string {
  const title = ok ? 'Bolo is connected' : 'Sign-in did not finish';
  const body = ok
    ? 'Your calendar is connected. You can close this tab and go back to Bolo.'
    : 'Bolo could not finish signing in. Close this tab and try again from Bolo.';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f7f7f5;color:#1b1d22}
main{max-width:420px;text-align:center}h1{font-size:22px}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}
