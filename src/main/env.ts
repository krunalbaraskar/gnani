import { app } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeEnv, parseDotEnv } from '../core/util/dotenv.ts';
import { GNANI_DEFAULT_STT_URL } from '../core/stt/gnani-protocol.ts';
import { WHISPER_DEFAULT_BASE_URL, WHISPER_DEFAULT_MODEL } from '../core/stt/whisper-provider.ts';

export interface BoloEnv {
  /** gnani (default), or whisper: any OpenAI-compatible transcription endpoint, e.g. Groq. */
  sttProvider: 'gnani' | 'whisper';
  whisperBaseUrl: string;
  whisperModel: string;
  whisperApiKey: string;
  gnaniApiKey: string;
  gnaniSttUrl: string;
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
  /** Optional reasoning_effort for thinking models, e.g. "low" or "none". Empty = not sent. */
  llmReasoningEffort: string;
  opaqueWindow: boolean;
  /** Demo mode: content protection off, so the overlay shows up in screen recordings. */
  recordable: boolean;
}

function readEnvFile(path: string): Record<string, string> {
  try {
    return existsSync(path) ? parseDotEnv(readFileSync(path, 'utf8')) : {};
  } catch {
    return {};
  }
}

/** Real env vars, then <cwd>/.env (dev), then %APPDATA%/Bolo/.env (installed app). */
export function envFilePaths(): string[] {
  return [join(process.cwd(), '.env'), join(app.getPath('userData'), '.env')];
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** What the overlay shows about speech-to-text. Never includes a key. */
export function sttInfo(env: BoloEnv): { name: string; keyVar: string; key: boolean; url: string } {
  return env.sttProvider === 'whisper'
    ? {
        name: `Whisper (${env.whisperModel})`,
        keyVar: 'WHISPER_API_KEY',
        key: !!env.whisperApiKey,
        url: env.whisperBaseUrl,
      }
    : { name: 'Gnani', keyVar: 'GNANI_API_KEY', key: !!env.gnaniApiKey, url: env.gnaniSttUrl };
}

export function loadEnv(): BoloEnv {
  const env = mergeEnv(process.env, ...envFilePaths().map(readEnvFile));
  const llmBaseUrl = env['LLM_BASE_URL'] ?? '';
  const whisperBaseUrl = env['WHISPER_BASE_URL'] || WHISPER_DEFAULT_BASE_URL;
  return {
    sttProvider: env['STT_PROVIDER']?.toLowerCase() === 'whisper' ? 'whisper' : 'gnani',
    whisperBaseUrl,
    whisperModel: env['WHISPER_MODEL'] || WHISPER_DEFAULT_MODEL,
    // Reuse the LLM key only for the same service: never send one vendor's key to another.
    whisperApiKey:
      env['WHISPER_API_KEY'] ||
      (sameOrigin(whisperBaseUrl, llmBaseUrl) ? (env['LLM_API_KEY'] ?? '') : ''),
    gnaniApiKey: env['GNANI_API_KEY'] ?? '',
    gnaniSttUrl: env['GNANI_STT_URL'] || GNANI_DEFAULT_STT_URL,
    llmBaseUrl,
    llmModel: env['LLM_MODEL'] ?? '',
    llmApiKey: env['LLM_API_KEY'] ?? '',
    llmReasoningEffort: (env['LLM_REASONING_EFFORT'] ?? '').trim().toLowerCase(),
    opaqueWindow: env['BOLO_OPAQUE_WINDOW'] === '1',
    recordable: env['BOLO_RECORDABLE'] === '1',
  };
}
