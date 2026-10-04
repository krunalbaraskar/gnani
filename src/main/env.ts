import { app } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeEnv, parseDotEnv } from '../core/util/dotenv.ts';
import { GNANI_DEFAULT_STT_URL } from '../core/stt/gnani-protocol.ts';

export interface BoloEnv {
  gnaniApiKey: string;
  gnaniSttUrl: string;
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
  opaqueWindow: boolean;
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

export function loadEnv(): BoloEnv {
  const env = mergeEnv(process.env, ...envFilePaths().map(readEnvFile));
  return {
    gnaniApiKey: env['GNANI_API_KEY'] ?? '',
    gnaniSttUrl: env['GNANI_STT_URL'] || GNANI_DEFAULT_STT_URL,
    llmBaseUrl: env['LLM_BASE_URL'] ?? '',
    llmModel: env['LLM_MODEL'] ?? '',
    llmApiKey: env['LLM_API_KEY'] ?? '',
    opaqueWindow: env['BOLO_OPAQUE_WINDOW'] === '1',
  };
}
