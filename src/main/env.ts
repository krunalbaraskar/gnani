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
  /** Google Calendar sign-in: a "Desktop app" OAuth client (see README). */
  googleClientId: string;
  googleClientSecret: string;
  /** Outlook / Microsoft 365 sign-in: an app registration with a localhost redirect. */
  microsoftClientId: string;
  microsoftTenant: string;
  /** Development and tests only: a local mock instead of the real sign-in endpoints. */
  oauthMockBase: string;
  /** Development and tests only: a file read instead of the microphone registry key. */
  detectFile: string;
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
    googleClientId: env['GOOGLE_CLIENT_ID'] ?? '',
    googleClientSecret: env['GOOGLE_CLIENT_SECRET'] ?? '',
    microsoftClientId: env['MICROSOFT_CLIENT_ID'] ?? '',
    microsoftTenant: env['MICROSOFT_TENANT'] || 'common',
    // Never in an installed app: tokens must only ever go to the real providers.
    oauthMockBase: app.isPackaged ? '' : (env['BOLO_OAUTH_MOCK'] ?? ''),
    detectFile: app.isPackaged ? '' : (env['BOLO_DETECT_FILE'] ?? ''),
  };
}
