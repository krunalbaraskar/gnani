import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exportBaseName, sessionToJson, sessionToMarkdown } from '../core/session/export.ts';
import type { SessionRecord } from '../core/session/types.ts';

export async function writeSessionExport(
  dir: string,
  record: SessionRecord,
): Promise<{ markdown: string; json: string }> {
  await mkdir(dir, { recursive: true });
  const base = join(dir, exportBaseName(record.startedAt));
  const markdown = `${base}.md`;
  const json = `${base}.json`;
  await writeFile(markdown, sessionToMarkdown(record), 'utf8');
  await writeFile(json, sessionToJson(record), 'utf8');
  return { markdown, json };
}
