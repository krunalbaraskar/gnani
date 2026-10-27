/**
 * Alerts when they say the user's name or a watch word. Plain text matching, no AI, so it
 * works in every mode. Speech-to-text may write a name in another script (Hindi writes
 * "Krunal" as "क्रुणाल"), so the user can add those spellings as watch words.
 */

/** My name (and its first word), then the comma-separated watch words; no duplicates. */
export function watchTerms(myName: string, watchWords: string): string[] {
  const name = myName.trim();
  const first = name.split(/\s+/)[0] ?? '';
  const words = watchWords.split(',').map((w) => w.trim());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [name, first, ...words]) {
    const key = t.toLowerCase();
    // One or two letters would match inside ordinary speech.
    if ([...t].length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Terms said in `text`, as whole words (not "Ravi" inside "Ravindra"), ignoring case.
 * A Hindi postposition or English possessive may follow: "Krunal ji", "Krunal's".
 */
export function findMentions(text: string, terms: readonly string[]): string[] {
  const found: string[] = [];
  for (const term of terms) {
    const words = term.trim().split(/\s+/).map(escape).join('\\s+');
    const re = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${words}(?![\\p{L}\\p{M}\\p{N}])`, 'iu');
    if (re.test(text)) found.push(term);
  }
  // "Krunal Baraskar" already covers "Krunal".
  return found.filter(
    (t) => !found.some((o) => o !== t && o.toLowerCase().startsWith(`${t.toLowerCase()} `)),
  );
}
