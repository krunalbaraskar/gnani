/**
 * Lowercases, removes punctuation (any script) and collapses whitespace.
 * Devanagari/Tamil combining marks are letters/marks, not punctuation, so they stay.
 */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  const n = normalizeForMatch(text);
  return n ? n.split(' ') : [];
}
