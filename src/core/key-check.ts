import WebSocket from 'ws';
import { OpenAiCompatibleProvider, type OpenAiCompatibleConfig } from './llm/openai-compatible.ts';
import {
  buildGnaniHeaders,
  GNANI_CONNECT_TIMEOUT_MS,
  makeRequestId,
  parseGnaniMessage,
} from './stt/gnani-protocol.ts';

export interface CheckResult {
  ok: boolean;
  message: string;
}

/**
 * Opens a Gnani stream just long enough to see the server accept it (the `connected`
 * message), then closes it. No audio is sent, so it costs no transcription.
 */
export function checkGnani(apiKey: string, url: string): Promise<CheckResult> {
  if (!apiKey) return Promise.resolve({ ok: false, message: 'No Gnani API key yet.' });
  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket;
    const done = (r: CheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        // already closed
      }
      resolve(r);
    };
    const timer = setTimeout(
      () => done({ ok: false, message: 'Gnani did not answer within 10 seconds.' }),
      GNANI_CONNECT_TIMEOUT_MS,
    );
    try {
      ws = new WebSocket(url, {
        headers: buildGnaniHeaders({ apiKey, language: 'hi-IN', requestId: makeRequestId() }),
        handshakeTimeout: GNANI_CONNECT_TIMEOUT_MS,
      });
    } catch (err) {
      done({ ok: false, message: `Bad Gnani URL: ${(err as Error).message}` });
      return;
    }
    ws.on('unexpected-response', (_req, res) => {
      const status = res.statusCode ?? 0;
      res.resume();
      done({
        ok: false,
        message:
          status === 401 || status === 403
            ? `Gnani refused this key (HTTP ${status}). Check it and try again.`
            : `Gnani refused the connection (HTTP ${status}).`,
      });
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const e = parseGnaniMessage(data.toString());
      if (e.kind === 'connected') done({ ok: true, message: 'Gnani accepted the key.' });
      else if (e.kind === 'error') done({ ok: false, message: `Gnani: ${e.message}` });
    });
    ws.on('error', (err) => done({ ok: false, message: `Could not reach Gnani: ${err.message}` }));
    ws.on('close', () => done({ ok: false, message: 'Gnani closed the connection.' }));
  });
}

/** One tiny request to the AI model: proves the URL, model name and key all work. */
export async function checkLlm(
  cfg: Omit<OpenAiCompatibleConfig, 'fetch'> & { fetch?: typeof fetch },
): Promise<CheckResult> {
  if (!cfg.baseUrl || !cfg.model)
    return { ok: false, message: 'Choose an AI service and model first.' };
  try {
    const llm = new OpenAiCompatibleProvider(cfg);
    const started = Date.now();
    let text = '';
    for await (const chunk of llm.streamChat({
      messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
      // Thinking models spend part of this on reasoning; keep room for the answer.
      maxTokens: 400,
      timeoutMs: 30_000,
    }))
      text += chunk;
    const ms = Date.now() - started;
    return {
      ok: true,
      message: `${cfg.model} answered in ${(ms / 1000).toFixed(1)} s${text.trim() ? '' : ' (empty reply)'}.`,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
