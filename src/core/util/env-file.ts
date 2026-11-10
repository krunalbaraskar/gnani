/**
 * Editing the user's .env from the app (Settings → AI & speech, first-run setup).
 * Only these names can be written; everything else in the file is kept as it was.
 */
export const EDITABLE_ENV_KEYS = [
  'GNANI_API_KEY',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'LLM_API_KEY',
  'LLM_REASONING_EFFORT',
] as const;

export type EditableEnvKey = (typeof EDITABLE_ENV_KEYS)[number];
export type EnvPatch = Partial<Record<EditableEnvKey, string>>;

/**
 * Keeps only allowed names with plain single-token values. Keys, URLs and model names never
 * contain spaces, quotes or `#`, and refusing them means the file needs no quoting rules.
 */
export function sanitizeEnvPatch(input: unknown): { patch: EnvPatch; error?: string } {
  const patch: EnvPatch = {};
  if (!input || typeof input !== 'object') return { patch, error: 'Nothing to save.' };
  for (const [name, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!(EDITABLE_ENV_KEYS as readonly string[]).includes(name)) continue;
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value.length > 4000 || /[\s"'#`\\]/.test(value))
      return { patch: {}, error: `${name} has spaces or characters that are not allowed.` };
    patch[name as EditableEnvKey] = value;
  }
  return { patch };
}

/**
 * Applies the patch to .env text: an existing `NAME=` line is replaced in place, a new
 * name is appended, and an empty value removes the line.
 */
export function applyEnvPatch(text: string, patch: EnvPatch): string {
  const todo = new Map(Object.entries(patch));
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    const name = m?.[1];
    if (name && todo.has(name)) {
      const value = todo.get(name)!;
      todo.delete(name);
      if (value) out.push(`${name}=${value}`);
      continue;
    }
    // A later duplicate of a name already written would win when parsed; drop it.
    if (name && name in patch) continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  for (const [name, value] of todo) if (value) out.push(`${name}=${value}`);
  return out.length ? `${out.join('\n')}\n` : '';
}
