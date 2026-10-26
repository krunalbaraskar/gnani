/**
 * The user's reference files (inventory, price list, project notes): decoding, chunking
 * and picking what goes into an answer prompt. Pure; the main process does the file I/O.
 */

export interface RawFile {
  name: string;
  size: number;
  /** Omitted when the caller didn't read the file (see wantsBytes). */
  bytes?: Uint8Array;
}

export interface ContextFile {
  name: string;
  /** Shown in the Context tab, e.g. "212 rows" or "3 KB". */
  info: string;
}

export interface SkippedFile {
  name: string;
  reason: string;
}

export interface Chunk {
  file: string;
  text: string;
}

export interface LoadedContext {
  files: ContextFile[];
  skipped: SkippedFile[];
  chunks: Chunk[];
}

export const CONTEXT_LIMITS = { files: 50, fileBytes: 1_000_000, totalBytes: 4_000_000 };
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'tsv', 'json']);
const CSV_ROWS_PER_CHUNK = 20;
const CSV_CHUNK_CHARS = 2000;
const TEXT_CHUNK_CHARS = 800;

const ext = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
const isTable = (name: string) => ext(name) === 'csv' || ext(name) === 'tsv';

/** Whether a file is worth reading from disk at all. */
export function wantsBytes(name: string, size: number): boolean {
  return TEXT_EXTENSIONS.has(ext(name)) && size <= CONTEXT_LIMITS.fileBytes;
}

/** UTF-8 (BOM stripped) or UTF-16 with a BOM. Anything else is null, never garbled text. */
export function decodeText(bytes: Uint8Array): string | null {
  const utf16 =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : null;
  try {
    // TextDecoder drops a leading BOM by default.
    const text = new TextDecoder(utf16 ?? 'utf-8', { fatal: true }).decode(bytes);
    // NUL bytes are valid UTF-8 but mean UTF-16 without a BOM, or a binary file.
    return text.includes('\u0000') ? null : text;
  } catch {
    return null;
  }
}

/**
 * Walks CSV/TSV text, saying for each character whether it is inside a quoted cell.
 * A quote only opens a cell at the start of a field, so a stray one (2" pipe) is text.
 */
function* cells(text: string): Generator<[ch: string, quoted: boolean]> {
  let quoted = false;
  let fieldStart = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        yield ['""', true]; // an escaped quote inside the cell
        i++;
      } else {
        if (ch === '"') quoted = false;
        yield [ch, true];
      }
      continue;
    }
    if (ch === '"' && fieldStart) quoted = true;
    yield [ch, quoted];
    fieldStart = ch === ',' || ch === '\t' || ch === '\n';
  }
}

/** Rows of a CSV/TSV: line breaks inside a quoted cell don't end a row. */
export function splitRows(text: string): string[] {
  const rows: string[] = [];
  let row = '';
  for (const [ch, quoted] of cells(text.replace(/\r\n?/g, '\n'))) {
    if (ch === '\n' && !quoted) {
      if (row.trim()) rows.push(row);
      row = '';
    } else {
      row += ch;
    }
  }
  if (row.trim()) rows.push(row);
  return rows;
}

/**
 * A chunk as the number check should read it. In a table a comma between cells is a
 * delimiter, not a thousands separator: "Pipe,120,450" is 120 and 450, never 120450.
 */
export function groundText(chunk: Chunk): string {
  if (ext(chunk.file) !== 'csv') return chunk.text;
  let out = '';
  for (const [ch, quoted] of cells(chunk.text)) out += ch === ',' && !quoted ? ' | ' : ch;
  return out;
}

function chunkTable(name: string, text: string): Chunk[] {
  const [header = '', ...rows] = splitRows(text);
  const chunks: Chunk[] = [];
  let body: string[] = [];
  const flush = () => {
    if (body.length) chunks.push({ file: name, text: [header, ...body].join('\n') });
    body = [];
  };
  for (const raw of rows) {
    const row = raw.slice(0, CSV_CHUNK_CHARS);
    const size = header.length + body.reduce((n, r) => n + r.length + 1, 0) + row.length + 1;
    if (body.length >= CSV_ROWS_PER_CHUNK || (body.length && size > CSV_CHUNK_CHARS)) flush();
    body.push(row);
  }
  flush();
  return chunks;
}

function chunkText(name: string, text: string): Chunk[] {
  const pieces: string[] = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    let piece = '';
    for (const line of block.split('\n')) {
      // A single line longer than a chunk is cut at the chunk size.
      for (let i = 0; i < Math.max(1, line.length); i += TEXT_CHUNK_CHARS) {
        const part = line.slice(i, i + TEXT_CHUNK_CHARS);
        if (piece && piece.length + part.length + 1 > TEXT_CHUNK_CHARS) {
          pieces.push(piece);
          piece = '';
        }
        piece = piece ? `${piece}\n${part}` : part;
      }
    }
    if (piece.trim()) pieces.push(piece);
  }
  return pieces.map((p) => ({ file: name, text: p }));
}

/** Applies the type, size and count limits in file-name order and chunks what is left. */
export function loadContext(raw: readonly RawFile[]): LoadedContext {
  const out: LoadedContext = { files: [], skipped: [], chunks: [] };
  let total = 0;
  const skip = (name: string, reason: string) => out.skipped.push({ name, reason });
  for (const f of [...raw].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!TEXT_EXTENSIONS.has(ext(f.name))) {
      skip(f.name, `${ext(f.name).toUpperCase() || 'this type'} not supported`);
    } else if (f.size > CONTEXT_LIMITS.fileBytes) {
      skip(f.name, 'too large (over 1 MB)');
    } else if (out.files.length >= CONTEXT_LIMITS.files) {
      skip(f.name, 'over the 50-file limit');
    } else if (total + f.size > CONTEXT_LIMITS.totalBytes) {
      skip(f.name, 'folder over 4 MB');
    } else {
      const text = f.bytes ? decodeText(f.bytes) : null;
      if (text === null) {
        skip(f.name, f.bytes ? 'not UTF-8: save as CSV UTF-8' : 'could not be read');
        continue;
      }
      total += f.size;
      const chunks = isTable(f.name) ? chunkTable(f.name, text) : chunkText(f.name, text);
      out.chunks.push(...chunks);
      out.files.push({
        name: f.name,
        info: isTable(f.name)
          ? `${Math.max(0, splitRows(text).length - 1)} rows`
          : `${Math.max(1, Math.round(f.size / 1024))} KB`,
      });
    }
  }
  return out;
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

const cost = (c: Chunk) => c.text.length + c.file.length + 8;

/**
 * Everything if it fits the budget; otherwise the chunks sharing the most (and rarest)
 * words with the query. Words found in more than half the chunks are ignored, so filler
 * can't pull in unrelated rows; with no real match nothing is returned.
 */
// ponytail: lexical match only, so a Hindi word never finds its English column name.
// Upgrade to embeddings if large folders miss too often.
export function selectChunks(chunks: readonly Chunk[], query: string, budget: number): Chunk[] {
  if (chunks.reduce((n, c) => n + cost(c), 0) <= budget) return [...chunks];

  const words = chunks.map((c) => new Set(tokenize(c.text)));
  const df = new Map<string, number>();
  for (const set of words) for (const w of set) df.set(w, (df.get(w) ?? 0) + 1);
  const query_ = [...new Set(tokenize(query))].filter((w) => {
    const n = df.get(w) ?? 0;
    return n > 0 && n <= chunks.length / 2;
  });

  const scored = chunks
    .map((chunk, i) => ({
      chunk,
      i,
      score: query_.reduce(
        (s, w) => (words[i]!.has(w) ? s + Math.log(1 + chunks.length / df.get(w)!) : s),
        0,
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const picked: { chunk: Chunk; i: number }[] = [];
  let used = 0;
  for (const x of scored) {
    if (used + cost(x.chunk) > budget) continue;
    used += cost(x.chunk);
    picked.push(x);
  }
  // Back in file order, so rows of one table read naturally.
  return picked.sort((a, b) => a.i - b.i).map((x) => x.chunk);
}

/** Prompt text: chunks grouped under their file names. */
export function formatChunks(chunks: readonly Chunk[]): string {
  const byFile = new Map<string, string[]>();
  for (const c of chunks) byFile.set(c.file, [...(byFile.get(c.file) ?? []), c.text]);
  return [...byFile].map(([file, texts]) => `--- ${file} ---\n${texts.join('\n')}`).join('\n\n');
}
