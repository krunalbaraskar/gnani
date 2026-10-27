/**
 * Turns a raw model reply into an answer the overlay can label honestly: where it says
 * the facts came from, and whether its numbers really appear in what was sent.
 */

export type Verdict =
  | 'files'
  | 'call'
  | 'reply'
  | 'missing'
  | 'unverified'
  | 'screen'
  // A "Catch me up" recap whose figures all appear in the transcript.
  | 'recap';

// The tag ends a line. Models also put it after the reply on the same line, or in bold.
const SOURCE_TAG = /[*_`]*\[\s*sources?\s*:\s*([^\]]*)\][*_`.]*\s*$/i;

/** Splits off the last "[source: a.csv, transcript]" tag. `cited` is null if absent. */
export function splitSource(raw: string): { text: string; cited: string[] | null } {
  const lines = raw.trimEnd().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = SOURCE_TAG.exec(lines[i]!);
    if (!m) continue;
    const before = lines[i]!.slice(0, m.index).trimEnd();
    lines.splice(i, 1, ...(before ? [before] : []));
    const cited = m[1]!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return { text: lines.join('\n').trimEnd(), cited };
  }
  return { text: raw, cited: null };
}

/** While streaming: hide a trailing source tag that has arrived or is still arriving. */
export function visibleWhileStreaming(raw: string): string {
  const open = raw.lastIndexOf('[');
  if (open < 0) return raw;
  const tail = raw
    .slice(open + 1)
    .trimStart()
    .toLowerCase();
  // "[", "[sou" and "[source: a.csv]" are the tag; "[per unit]" is not.
  const isTag = 'source'.startsWith(tail.slice(0, 6)) && !/\][^\n]*\S/.test(tail);
  return isTag ? raw.slice(0, open).replace(/[\s*_`]+$/, '') : raw;
}

// First digit of each Indian-script digit block (Devanagari … Malayalam).
const DIGIT_ZEROS = [0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66];

function asciiDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (ch) => {
    const cp = ch.codePointAt(0)!;
    const zero = DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9);
    return zero === undefined ? ch : String(cp - zero);
  });
}

/** Numbers as comparable tokens: "₹1,180.50" → "1180.5", "०५" → "5". */
export function numbersIn(text: string): string[] {
  // Only a comma that groups digits (1,180 or 1,20,000) is dropped; "3,4" stays two numbers.
  const plain = asciiDigits(text).replace(/(?<=\d),(?=\d{2,3}(?!\d))/g, '');
  return (plain.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => {
    const [int = '0', frac = ''] = n.split('.');
    const f = frac.replace(/0+$/, '');
    return (int.replace(/^0+(?=\d)/, '') || '0') + (f ? `.${f}` : '');
  });
}

/** Every number in the answer must appear, as a whole number, in one of the sources. */
export function numbersGrounded(answer: string, sources: readonly string[]): boolean {
  const known = new Set(sources.flatMap(numbersIn));
  return numbersIn(answer).every((n) => known.has(n));
}

const baseName = (s: string) => s.trim().split(/[\\/]/).pop()!.toLowerCase();

export interface VerdictInput {
  /** Answer text with the source line already removed. */
  text: string;
  cited: string[] | null;
  /** Files whose chunks were actually in the prompt. */
  sentFiles: readonly string[];
  contextLoaded: boolean;
  usedScreen: boolean;
  /** Texts a number may legitimately come from: chunks, note, transcript, typed question. */
  groundTexts: readonly string[];
}

/** One ordered rule; the first match wins. */
export function decideVerdict(v: VerdictInput): { verdict: Verdict; sources: string[] } {
  const cited = (v.cited ?? []).map((c) => c.toLowerCase());
  // "inventory" counts as inventory.csv: models often drop the extension.
  const names = (f: string) => [f.toLowerCase(), f.toLowerCase().replace(/\.[^.]+$/, '')];
  const files = v.sentFiles.filter((f) => cited.some((c) => names(f).includes(baseName(c))));
  const call = cited.filter((c) => c === 'transcript' || c === 'note');

  if (cited.includes('missing')) return { verdict: 'missing', sources: [] };
  if (v.usedScreen) return { verdict: 'screen', sources: files };
  if (!v.contextLoaded) return { verdict: 'reply', sources: [] };
  if (cited.length === 0 || cited.every((c) => c === 'none')) {
    return { verdict: 'reply', sources: [] };
  }
  if (!numbersGrounded(v.text, v.groundTexts)) return { verdict: 'unverified', sources: [] };
  if (files.length) return { verdict: 'files', sources: files };
  if (call.length) return { verdict: 'call', sources: call };
  // File names were cited, but none of them was in the prompt.
  return { verdict: 'unverified', sources: [] };
}
