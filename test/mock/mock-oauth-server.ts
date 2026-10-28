/**
 * A stand-in for Google's sign-in and Calendar API, for the end-to-end test: the
 * authorize endpoint redirects straight back with a code, the token endpoint checks the
 * PKCE verifier, and the events endpoint checks the access token. Synthetic data only.
 */
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockOAuthOptions {
  email: string;
  name: string;
  /** Events returned by the Calendar API, as Google items. */
  events: () => unknown[];
}

const b64url = (s: string) => Buffer.from(s).toString('base64url');

export class MockOAuthServer {
  readonly log: string[] = [];
  private server: Server | null = null;
  private challenge = '';
  private readonly o: MockOAuthOptions;

  constructor(o: MockOAuthOptions) {
    this.o = o;
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        this.log.push(`${req.method} ${url.pathname}`);
        if (url.pathname === '/google/auth') {
          this.challenge = url.searchParams.get('code_challenge') ?? '';
          const back = new URL(url.searchParams.get('redirect_uri') ?? '');
          back.searchParams.set('code', 'mock-code');
          back.searchParams.set('state', url.searchParams.get('state') ?? '');
          res.writeHead(302, { Location: back.toString() }).end();
          return;
        }
        if (url.pathname === '/google/token') {
          const p = new URLSearchParams(body);
          const verifier = p.get('code_verifier') ?? '';
          const ok =
            p.get('grant_type') === 'refresh_token' ||
            (p.get('code') === 'mock-code' &&
              createHash('sha256').update(verifier).digest('base64url') === this.challenge);
          res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify(
              ok
                ? {
                    access_token: 'mock-access',
                    refresh_token: 'mock-refresh',
                    expires_in: 3600,
                    id_token: `h.${b64url(JSON.stringify({ email: this.o.email, name: this.o.name }))}.s`,
                  }
                : { error: 'invalid_grant' },
            ),
          );
          return;
        }
        if (url.pathname === '/google/calendar/v3/calendars/primary/events') {
          const authed = req.headers.authorization === 'Bearer mock-access';
          res.writeHead(authed ? 200 : 401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(authed ? { items: this.o.events() } : { error: 'unauthorized' }));
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }
}
