import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CONTEXT_LIMITS,
  decodeText,
  loadContext,
  wantsBytes,
  type LoadedContext,
  type RawFile,
} from '../core/context/context.ts';
import type { ContextView } from '../shared/ipc.ts';

const EMPTY: LoadedContext = { files: [], skipped: [], chunks: [] };

/** Reads the top level of the context folder. Never throws: problems come back as `error`. */
export async function readContextDir(
  dir: string,
): Promise<{ context: LoadedContext; error?: string }> {
  if (!dir) return { context: EMPTY };
  try {
    const context = loadContext(
      await withTimeout(readFiles(dir), 8000, 'the folder took too long to read'),
    );
    return context.files.length
      ? { context }
      : { context, error: 'No readable files in this folder' };
  } catch (err) {
    return {
      context: EMPTY,
      error: `Context folder could not be read: ${(err as Error).message}`,
    };
  }
}

/** Same order and limits as loadContext, so nothing past them is read into memory. */
async function readFiles(dir: string): Promise<RawFile[]> {
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isFile()) // subfolders are ignored
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  const raw: RawFile[] = [];
  let read = 0;
  let total = 0;
  for (const name of names) {
    const path = join(dir, name);
    // A file that vanished or is locked is skipped; it must not fail the whole folder.
    const size = (await stat(path).catch(() => undefined))?.size ?? 0;
    const fits =
      wantsBytes(name, size) &&
      read < CONTEXT_LIMITS.files &&
      total + size <= CONTEXT_LIMITS.totalBytes;
    const bytes = fits ? await readFile(path).catch(() => undefined) : undefined;
    // Only files loadContext will accept count, or a rejected one takes a good one's room.
    if (bytes && decodeText(bytes) !== null) {
      read++;
      total += size;
    }
    raw.push({ name, size, bytes });
  }
  return raw;
}

/** A dead network share must not stop a call from starting, nor a stuck capture hide the overlay. */
export function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms).unref();
    }),
  ]);
}

export function contextView(
  dir: string,
  loaded: { context: LoadedContext; error?: string },
): ContextView {
  return {
    dir,
    files: loaded.context.files,
    skipped: loaded.context.skipped,
    error: loaded.error,
  };
}
