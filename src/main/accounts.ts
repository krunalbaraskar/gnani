import { safeStorage, shell } from 'electron';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CalendarEvent } from '../core/calendar/ics.ts';
import {
  GRAPH_HEADERS,
  googleEventsUrl,
  graphEventsUrl,
  mapGoogleEvents,
  mapGraphEvents,
} from '../core/integrations/events.ts';
import {
  authorizeUrl,
  callbackPage,
  codeExchangeBody,
  identityFromIdToken,
  parseTokens,
  pkcePair,
  randomState,
  refreshBody,
  type ProviderConfig,
  type TokenSet,
} from '../core/integrations/oauth.ts';
import type { Logger } from '../core/util/logger.ts';
import type {
  AccountProvider,
  AccountView,
  ConnectResult,
  IntegrationsView,
} from '../shared/integrations.ts';

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

interface StoredAccount {
  id: string;
  provider: AccountProvider;
  email: string;
  name?: string;
  tokens: TokenSet;
  error?: string;
}

export interface AccountsOptions {
  /** Encrypted (Windows DPAPI via safeStorage) account file in userData. */
  file: string;
  /** Provider settings for a provider whose client id is set, else null. */
  config: (provider: AccountProvider) => ProviderConfig | null;
  /** Called when accounts change (connect, disconnect, an error), to update the windows. */
  onChange: (view: IntegrationsView) => void;
  log: Logger;
  /**
   * Development and tests only: instead of opening the browser, request the sign-in URL
   * directly (a local mock provider redirects straight back).
   */
  followAuthUrlDirectly?: boolean;
}

/**
 * Google and Microsoft calendar accounts. Sign-in happens in the user's browser; Bolo only
 * receives an authorization code on a one-time 127.0.0.1 listener. Refresh tokens are
 * encrypted at rest and never leave this process.
 */
export class AccountsService {
  private accounts: StoredAccount[] = [];
  private loaded = false;
  private pending: { server: Server; done: (r: ConnectResult) => void } | null = null;
  private readonly o: AccountsOptions;

  constructor(opts: AccountsOptions) {
    this.o = opts;
  }

  view(): IntegrationsView {
    return {
      accounts: this.accounts.map((a): AccountView => ({
        id: a.id,
        provider: a.provider,
        email: a.email,
        name: a.name,
        error: a.error,
      })),
      available: { google: !!this.o.config('google'), microsoft: !!this.o.config('microsoft') },
    };
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.o.file);
      const text = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(raw)
        : raw.toString('utf8');
      const list = JSON.parse(text) as StoredAccount[];
      this.accounts = Array.isArray(list)
        ? list.filter((a) => a && typeof a.id === 'string' && a.tokens?.refreshToken)
        : [];
    } catch {
      this.accounts = []; // none yet, or unreadable on this machine (e.g. copied from another)
    }
  }

  private async save(): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      // Never write tokens in the clear: keep them for this run only.
      this.o.log.warn('encryption unavailable; calendar sign-in is not remembered');
      return;
    }
    await mkdir(dirname(this.o.file), { recursive: true });
    const tmp = `${this.o.file}.tmp`;
    await writeFile(tmp, safeStorage.encryptString(JSON.stringify(this.accounts)));
    await rename(tmp, this.o.file);
  }

  private changed(): void {
    this.o.onChange(this.view());
  }

  /** Runs the browser sign-in. Starting another one cancels the first. */
  async connect(provider: AccountProvider): Promise<ConnectResult> {
    const cfg = this.o.config(provider);
    if (!cfg) {
      return {
        ok: false,
        error:
          provider === 'google'
            ? 'Google sign-in is not set up: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.'
            : 'Outlook sign-in is not set up: add MICROSOFT_CLIENT_ID to .env.',
      };
    }
    await this.load();
    this.pending?.done({ ok: false, error: 'Replaced by a new sign-in.' });

    const { verifier, challenge } = pkcePair();
    const state = randomState();
    return new Promise<ConnectResult>((resolve) => {
      let finished = false;
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/' || !url.searchParams.has('state')) {
          res.writeHead(404).end();
          return;
        }
        const ok = url.searchParams.get('state') === state && url.searchParams.has('code');
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(callbackPage(ok));
        if (!ok) {
          const err = url.searchParams.get('error');
          done({
            ok: false,
            error: err === 'access_denied' ? 'Sign-in was cancelled.' : 'Sign-in did not finish.',
          });
          return;
        }
        void this.finish(cfg, url.searchParams.get('code')!, verifier, redirectUri).then(
          done,
          (e) => done({ ok: false, error: (e as Error).message }),
        );
      });
      let redirectUri = '';
      const timer = setTimeout(
        () => done({ ok: false, error: 'Sign-in timed out. Try again.' }),
        SIGN_IN_TIMEOUT_MS,
      );
      const done = (r: ConnectResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        server.close();
        if (this.pending?.server === server) this.pending = null;
        resolve(r);
      };
      this.pending = { server, done };
      server.on('error', (e) =>
        done({ ok: false, error: `Could not start sign-in: ${e.message}` }),
      );
      // Loopback only: nothing on the network can reach this listener.
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as AddressInfo).port;
        redirectUri = `http://${cfg.loopbackHost}:${port}`;
        const url = authorizeUrl(cfg, redirectUri, state, challenge);
        if (this.o.followAuthUrlDirectly) void fetch(url).catch(() => {});
        else void shell.openExternal(url);
      });
    });
  }

  private async finish(
    cfg: ProviderConfig,
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<ConnectResult> {
    const res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: codeExchangeBody(cfg, code, verifier, redirectUri),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const tokens = parseTokens(json, Date.now());
    const who = identityFromIdToken(json['id_token']);
    if (!who) throw new Error('Signed in, but the account has no email address.');
    const account: StoredAccount = {
      id: `${cfg.provider}:${who.email}`,
      provider: cfg.provider,
      email: who.email,
      name: who.name,
      tokens,
    };
    this.accounts = [...this.accounts.filter((a) => a.id !== account.id), account];
    await this.save();
    this.changed();
    return { ok: true, account: this.view().accounts.find((a) => a.id === account.id)! };
  }

  async disconnect(id: string): Promise<void> {
    await this.load();
    const a = this.accounts.find((x) => x.id === id);
    if (!a) return;
    this.accounts = this.accounts.filter((x) => x.id !== id);
    await this.save();
    this.changed();
    // Best effort: also tell Google to forget the grant (Microsoft has no such endpoint).
    if (a.provider === 'google' && !this.o.followAuthUrlDirectly) {
      void fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(a.tokens.refreshToken)}`,
        {
          method: 'POST',
        },
      ).catch(() => {});
    }
  }

  private async accessToken(a: StoredAccount, cfg: ProviderConfig): Promise<string> {
    if (a.tokens.expiresAt - 60_000 > Date.now()) return a.tokens.accessToken;
    const res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: refreshBody(cfg, a.tokens.refreshToken),
      signal: AbortSignal.timeout(20_000),
    });
    a.tokens = parseTokens(await res.json().catch(() => ({})), Date.now(), a.tokens.refreshToken);
    await this.save();
    return a.tokens.accessToken;
  }

  /** Events from every connected account in [from, to). One failing account never hides the rest. */
  async events(from: number, to: number): Promise<CalendarEvent[]> {
    await this.load();
    const all: CalendarEvent[] = [];
    let errorsChanged = false;
    for (const a of this.accounts) {
      const cfg = this.o.config(a.provider);
      if (!cfg) continue;
      const before = a.error;
      try {
        const token = await this.accessToken(a, cfg);
        const google = a.provider === 'google';
        const res = await fetch(
          google ? googleEventsUrl(cfg.apiBase, from, to) : graphEventsUrl(cfg.apiBase, from, to),
          {
            headers: { Authorization: `Bearer ${token}`, ...(google ? {} : GRAPH_HEADERS) },
            signal: AbortSignal.timeout(20_000),
          },
        );
        if (res.status === 401 || res.status === 403)
          throw new Error('Access was removed. Connect the account again.');
        if (!res.ok) throw new Error(`The calendar answered HTTP ${res.status}.`);
        const json = await res.json();
        all.push(...(google ? mapGoogleEvents(json, a.id) : mapGraphEvents(json, a.id)));
        a.error = undefined;
      } catch (err) {
        const msg = (err as Error).message;
        a.error = /refused \(invalid_grant/.test(msg)
          ? 'Access was removed. Connect the account again.'
          : msg;
        this.o.log.warn('calendar account could not be read', { account: a.id, error: a.error });
      }
      if (a.error !== before) errorsChanged = true;
    }
    if (errorsChanged) this.changed();
    return all;
  }
}
