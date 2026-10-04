/** Minimal OpenAI-compatible /chat/completions server that streams scripted tokens. */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockLlmOptions {
  tokens?: string[];
  /** Delay between streamed chunks. */
  tokenDelayMs?: number;
  status?: number;
  errorBody?: string;
  /** Reply with a single non-streamed JSON body. */
  json?: boolean;
  /** Use \r\n line endings and split SSE lines across writes. */
  awkwardFraming?: boolean;
}

export interface RecordedRequest {
  path: string;
  headers: IncomingHttpHeaders;
  body: {
    model: string;
    stream: boolean;
    messages: { role: string; content: string }[];
    max_tokens?: number;
  };
}

export class MockLlmServer {
  readonly requests: RecordedRequest[] = [];
  opts: MockLlmOptions;
  private server: Server | null = null;

  constructor(opts: MockLlmOptions = {}) {
    this.opts = opts;
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', async () => {
        this.requests.push({
          path: req.url ?? '',
          headers: req.headers,
          body: JSON.parse(raw || '{}'),
        });
        const o = this.opts;
        if (o.status && o.status !== 200) {
          res.writeHead(o.status, { 'Content-Type': 'application/json' });
          res.end(o.errorBody ?? JSON.stringify({ error: { message: 'mock failure' } }));
          return;
        }
        const tokens = o.tokens ?? ['Ji', ' bilkul', '!'];
        if (o.json) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: tokens.join('') } }] }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const nl = o.awkwardFraming ? '\r\n' : '\n';
        res.write(`: keep-alive comment${nl}${nl}`);
        for (const t of tokens) {
          if (res.destroyed) return;
          const line = `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}${nl}${nl}`;
          if (o.awkwardFraming) {
            const mid = Math.floor(line.length / 2);
            res.write(line.slice(0, mid));
            await sleep(1);
            res.write(line.slice(mid));
          } else {
            res.write(line);
          }
          if (o.tokenDelayMs) await sleep(o.tokenDelayMs);
        }
        res.end(`data: [DONE]${nl}${nl}`);
      });
    });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/v1`;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
