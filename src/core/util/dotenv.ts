/**
 * Tiny .env parser (KEY=value, # comments, optional quotes, `export ` prefix).
 * Avoids a dependency for something this small.
 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2]!;
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) {
      value = value.slice(1, value.lastIndexOf(quote));
      if (quote === '"') value = value.replace(/\\n/g, '\n');
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[m[1]!] = value;
  }
  return out;
}

/** Later sources only fill keys that are still missing; real env vars always win. */
export function mergeEnv(
  processEnv: Record<string, string | undefined>,
  ...files: Record<string, string>[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [...files].reverse()) Object.assign(out, f);
  for (const [k, v] of Object.entries(processEnv)) if (v !== undefined && v !== '') out[k] = v;
  return out;
}
